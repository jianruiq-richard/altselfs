import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';

type PendingRequest = {
  method: string;
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class JsonRpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
  }
}

export class CodexJsonRpcClient extends EventEmitter {
  private process: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private stderrLines: string[] = [];
  private initialized = false;

  constructor(params: {
    codexBin: string;
    codexHome?: string;
    extraArgs?: string[];
    env?: Record<string, string>;
  }) {
    super();
    const env = {
      ...process.env,
      RUST_LOG: process.env.RUST_LOG || 'warn',
      ...(params.env || {}),
      ...(params.codexHome ? { CODEX_HOME: params.codexHome } : {}),
    };
    this.process = spawn(params.codexBin, ['app-server', ...(params.extraArgs || [])], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.on('exit', (code, signal) => {
      this.emit('exit', { code, signal });
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`codex app-server exited before ${pending.method} response`));
        this.pending.delete(id);
      }
    });
    this.attachStdout();
    this.attachStderr();
  }

  async initialize(params?: { clientName?: string; clientTitle?: string; clientVersion?: string }) {
    if (this.initialized) return;
    await this.request(
      'initialize',
      {
        clientInfo: {
          name: params?.clientName || 'altselfs',
          title: params?.clientTitle || 'Altselfs Personal Agent',
          version: params?.clientVersion || '0.1.0',
        },
        capabilities: { experimentalApi: true },
      },
      10_000
    );
    this.notify('initialized');
    this.initialized = true;
  }

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000) {
    const requestId = this.nextId++;
    const payload = { id: requestId, method, params };
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`codex app-server method ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(requestId, { method, resolve, reject, timeout });
      this.send(payload);
    });
  }

  notify(method: string, params: Record<string, unknown> = {}) {
    this.send({ method, params });
  }

  respond(requestId: unknown, result: Record<string, unknown>) {
    this.send({ id: requestId, result });
  }

  respondError(requestId: unknown, code: number, message: string, data?: unknown) {
    this.send({ id: requestId, error: { code, message, data } });
  }

  close() {
    this.process.stdin.end();
    this.process.kill('SIGTERM');
  }

  isAlive() {
    return this.process.exitCode === null && !this.process.killed;
  }

  stderrTail(lines = 20) {
    return this.stderrLines.slice(-lines);
  }

  private send(payload: unknown) {
    if (!this.process.stdin.writable) {
      throw new Error('codex app-server stdin is not writable');
    }
    this.process.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8');
  }

  private attachStdout() {
    const reader = readline.createInterface({ input: this.process.stdout });
    reader.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        this.pushStderr(`<non-json stdout> ${trimmed.slice(0, 200)}`);
        return;
      }
      this.dispatch(message);
    });
  }

  private attachStderr() {
    const reader = readline.createInterface({ input: this.process.stderr });
    reader.on('line', (line) => this.pushStderr(line));
  }

  private pushStderr(line: string) {
    this.stderrLines.push(line);
    if (this.stderrLines.length > 500) {
      this.stderrLines = this.stderrLines.slice(-500);
    }
  }

  private dispatch(message: Record<string, unknown>) {
    if ('id' in message && ('result' in message || 'error' in message) && !('method' in message)) {
      const requestId = Number(message.id);
      const pending = this.pending.get(requestId);
      if (!pending) return;
      this.pending.delete(requestId);
      clearTimeout(pending.timeout);
      if (message.error && typeof message.error === 'object') {
        const error = message.error as { code?: number; message?: string; data?: unknown };
        pending.reject(new JsonRpcError(error.code || -1, error.message || 'codex app-server error', error.data));
      } else {
        pending.resolve((message.result || {}) as Record<string, unknown>);
      }
      return;
    }

    if ('id' in message && 'method' in message) {
      this.emit('serverRequest', message);
      return;
    }

    if ('method' in message) {
      this.emit('notification', message);
    }
  }
}
