import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerConfig } from './config.js';
import { id, nowIso, truncate } from './util.js';

export type MemoryReviewJobStatus = 'queued' | 'running' | 'success' | 'error';

export type MemoryReviewJob = {
  id: string;
  status: MemoryReviewJobStatus;
  userId: string;
  threadId: string;
  userMessage: string;
  assistantReply: string;
  hermesHome: string;
  workspace: string;
  attempts: number;
  error?: string;
  stdout?: string;
  stderr?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

type JobDatabase = {
  jobs: MemoryReviewJob[];
};

export type EnqueueMemoryReviewJobInput = Omit<
  MemoryReviewJob,
  'id' | 'status' | 'attempts' | 'createdAt' | 'updatedAt'
>;

export interface MemoryReviewJobStore {
  enqueue(input: EnqueueMemoryReviewJobInput): Promise<MemoryReviewJob>;
  claimNext(): Promise<MemoryReviewJob | null>;
  complete(jobId: string, output: { stdout: string; stderr: string }): Promise<MemoryReviewJob | null>;
  fail(jobId: string, error: unknown, output?: { stdout?: string; stderr?: string }): Promise<MemoryReviewJob | null>;
  listRecent(limit?: number): Promise<MemoryReviewJob[]>;
}

export class FileMemoryReviewQueue implements MemoryReviewJobStore {
  private lock = Promise.resolve();

  constructor(private config: ServerConfig) {}

  async enqueue(input: EnqueueMemoryReviewJobInput) {
    return this.withLock(async () => {
      const timestamp = nowIso();
      const database = await this.readDatabase();
      const job: MemoryReviewJob = {
        ...input,
        id: id('memrev'),
        status: 'queued',
        attempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      database.jobs.push(job);
      await this.writeDatabase(database);
      return job;
    });
  }

  async claimNext() {
    return this.withLock(async () => {
      const database = await this.readDatabase();
      const job = database.jobs.find((item) => item.status === 'queued');
      if (!job) return null;
      const timestamp = nowIso();
      job.status = 'running';
      job.attempts += 1;
      job.startedAt = timestamp;
      job.updatedAt = timestamp;
      await this.writeDatabase(database);
      return { ...job };
    });
  }

  async complete(jobId: string, output: { stdout: string; stderr: string }) {
    return this.update(jobId, (job) => {
      job.status = 'success';
      job.stdout = truncate(output.stdout, 8000);
      job.stderr = truncate(output.stderr, 8000);
      job.completedAt = nowIso();
    });
  }

  async fail(jobId: string, error: unknown, output?: { stdout?: string; stderr?: string }) {
    return this.update(jobId, (job) => {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : String(error);
      job.stdout = truncate(output?.stdout || job.stdout || '', 8000);
      job.stderr = truncate(output?.stderr || job.stderr || '', 8000);
      job.completedAt = nowIso();
    });
  }

  async listRecent(limit = 50) {
    const database = await this.readDatabase();
    return database.jobs.slice(-limit).reverse();
  }

  private async update(jobId: string, update: (job: MemoryReviewJob) => void) {
    return this.withLock(async () => {
      const database = await this.readDatabase();
      const job = database.jobs.find((item) => item.id === jobId);
      if (!job) return null;
      update(job);
      job.updatedAt = nowIso();
      await this.writeDatabase(database);
      return { ...job };
    });
  }

  private async readDatabase(): Promise<JobDatabase> {
    try {
      const raw = await fs.readFile(this.config.memoryReviewJobStorePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { jobs?: unknown }).jobs)) {
        return { jobs: [] };
      }
      return parsed as JobDatabase;
    } catch {
      return { jobs: [] };
    }
  }

  private async writeDatabase(database: JobDatabase) {
    await fs.mkdir(path.dirname(this.config.memoryReviewJobStorePath), { recursive: true });
    await fs.writeFile(this.config.memoryReviewJobStorePath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
  }

  private withLock<T>(fn: () => Promise<T>) {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

export class MemoryReviewWorker {
  private timer: NodeJS.Timeout | null = null;
  private processing = false;

  constructor(
    private config: ServerConfig,
    private queue: MemoryReviewJobStore
  ) {}

  start() {
    if (this.config.memoryReviewMode !== 'async') return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.memoryReviewPollMs);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.processing) return;
    this.processing = true;
    try {
      const job = await this.queue.claimNext();
      if (!job) return;
      console.log(`[memory-review-worker] started job=${job.id} user=${job.userId} thread=${job.threadId}`);
      try {
        const output = await this.runReview(job);
        await this.queue.complete(job.id, output);
        console.log(`[memory-review-worker] completed job=${job.id}`);
      } catch (error) {
        await this.queue.fail(job.id, error);
        console.warn(`[memory-review-worker] failed job=${job.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      this.processing = false;
    }
  }

  private async runReview(job: MemoryReviewJob) {
    const reviewHome = await this.prepareReviewHome(job);
    const reviewCodexHome = path.join(this.config.codexHomeRoot, '_memory-review', sanitizePathSegment(job.userId));
    await fs.mkdir(reviewCodexHome, { recursive: true });
    const args = [
      'run',
      '--extra',
      'acp',
      'python',
      '-m',
      'hermes_cli.main',
      'chat',
      '-Q',
      '--source',
      'tool',
      '--max-turns',
      String(this.config.memoryReviewMaxTurns),
      '-q',
      buildReviewPrompt(job),
    ];
    return this.spawnHermes(args, {
      hermesHome: reviewHome,
      codexHome: reviewCodexHome,
      workspace: job.workspace,
    });
  }

  private async prepareReviewHome(job: MemoryReviewJob) {
    const reviewHome = path.join(this.config.hermesHomeRoot, '_memory-review', sanitizePathSegment(job.userId));
    const sharedMemories = path.join(job.hermesHome, 'memories');
    const linkedMemories = path.join(reviewHome, 'memories');
    await fs.mkdir(reviewHome, { recursive: true });
    await fs.mkdir(sharedMemories, { recursive: true });
    await ensureSymlink(linkedMemories, sharedMemories);
    await fs.writeFile(
      path.join(reviewHome, 'config.yaml'),
      [
        'model:',
        '  provider: openrouter',
        `  default: ${yamlString(this.config.hermesModel)}`,
        '  api_mode: chat_completions',
        '',
        'terminal:',
        `  cwd: ${yamlString(job.workspace)}`,
        '',
        'display:',
        '  tool_activity: compact',
        '',
        'memory:',
        '  memory_enabled: true',
        '  user_profile_enabled: true',
        '  nudge_interval: 0',
        '',
      ].join('\n'),
      'utf8'
    );
    return reviewHome;
  }

  private spawnHermes(args: string[], paths: { hermesHome: string; codexHome: string; workspace: string }) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const codexBinDir = path.dirname(this.config.codexBin);
      const child = spawn(this.config.uvBin, args, {
        cwd: this.config.hermesSourceRoot,
        env: {
          ...process.env,
          HERMES_HOME: paths.hermesHome,
          CODEX_HOME: paths.codexHome,
          PATH: [codexBinDir, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
          HERMES_BACKGROUND_REVIEW_INLINE: '0',
          NO_PROXY: mergeNoProxy(process.env.NO_PROXY || process.env.no_proxy || ''),
          no_proxy: mergeNoProxy(process.env.NO_PROXY || process.env.no_proxy || ''),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Hermes memory review timed out after 5 minutes'));
      }, 300_000);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(`Hermes memory review exited with code ${code}: ${stderr || stdout}`));
      });
    });
  }
}

function buildReviewPrompt(job: MemoryReviewJob) {
  return [
    'Review the completed turn below for durable user profile or preference information.',
    'If the turn reveals a stable user preference, communication style, recurring requirement, or durable user fact, save it with the memory tool using target="user".',
    'Do not save temporary task progress, one-off task details, stale facts, or anything that will not help future conversations.',
    'Write compact declarative facts, not instructions.',
    'If nothing durable should be saved, do not call the memory tool and briefly say no durable memory needed.',
    '',
    '<completed_turn>',
    `User: ${job.userMessage}`,
    `Assistant: ${job.assistantReply}`,
    '</completed_turn>',
  ].join('\n');
}

async function ensureSymlink(linkPath: string, targetPath: string) {
  try {
    const stat = await fs.lstat(linkPath);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      throw new Error(`${linkPath} exists as a directory; expected symlink to ${targetPath}`);
    }
    throw new Error(`${linkPath} exists and is not a symlink`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fs.symlink(targetPath, linkPath, 'dir');
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'anonymous';
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function mergeNoProxy(value: string) {
  const entries = new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  entries.add('127.0.0.1');
  entries.add('localhost');
  entries.add('::1');
  return Array.from(entries).join(',');
}
