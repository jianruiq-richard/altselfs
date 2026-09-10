import http from 'node:http';
import os from 'node:os';
import { BoundedSerialTaskQueue, QueueFullError } from './bounded-task-queue.js';
import { SemrushBrowserProvider } from './browser-provider.js';
import type { WorkerHeartbeat, WorkerQuota, WorkerResult } from './dispatcher.js';
import { bearerToken, json, readJsonBody } from './http-utils.js';
import { DailyQuotaExhaustedError, DailyQuotaUnavailableError } from './quota.js';
import { queryPaymentDestinations, type ServiceConfig } from './service.js';

export function startPoolWorker(input: {
  port: number;
  serviceToken?: string;
  workerId: string;
  dispatcherUrl: string;
  provider: SemrushBrowserProvider;
  config: ServiceConfig;
  maxWaiting: number;
  heartbeatMs: number;
  pollMs: number;
  quotaRefreshMs: number;
  version?: string;
}) {
  const queue = new BoundedSerialTaskQueue(input.maxWaiting);
  let busy = false;
  let stopped = false;
  let lastError = '';
  let lastQuotaRefreshAt = 0;

  const heartbeat = (): WorkerHeartbeat => {
    const quota = input.provider.getDailyQuotaSnapshot() as WorkerQuota;
    return {
      workerId: input.workerId,
      acceptingQueries: quota.acceptingQueries === true,
      busy,
      quota,
      hostname: os.hostname(),
      version: input.version,
      ...(lastError ? { error: lastError } : {}),
    };
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, { ok: true, role: 'pool-worker', ...heartbeat(), queue: queue.snapshot() });
      }
      if (input.serviceToken && bearerToken(req) !== input.serviceToken) return json(res, 403, { error: 'Forbidden' });
      if (req.method === 'GET' && url.pathname === '/v1/quota') {
        const quota = await queue.enqueue(() => input.provider.refreshDailyQuota());
        lastQuotaRefreshAt = Date.now();
        return json(res, 200, quota);
      }
      if (req.method === 'POST' && url.pathname === '/v1/payment-destinations') {
        const result = await runQuery(input.provider, input.config, await readJsonBody(req));
        return json(res, result.status, result.body, result.headers);
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      const result = workerErrorResult(error, queue);
      return json(res, result.status, result.body, result.headers);
    }
  });
  server.listen(input.port, '0.0.0.0', () => {
    console.log(`[semrush-worker] id=${input.workerId} listening on :${input.port}; dispatcher=${new URL(input.dispatcherUrl).origin}`);
  });

  const heartbeatTimer = setInterval(() => {
    void postJson(input, '/internal/workers/heartbeat', heartbeat(), 10_000)
      .then(() => {
        if (lastError.startsWith('dispatcher heartbeat failed:')) lastError = '';
      })
      .catch((error) => {
        lastError = `dispatcher heartbeat failed: ${message(error)}`;
      });
  }, input.heartbeatMs);
  heartbeatTimer.unref();

  void (async () => {
    await refreshQuota();
    while (!stopped) {
      try {
        if (!busy && Date.now() - lastQuotaRefreshAt >= input.quotaRefreshMs) await refreshQuota();
        const response = await postJson(input, '/internal/jobs/claim', heartbeat(), 15_000);
        if (response.status === 204) {
          await delay(input.pollMs);
          continue;
        }
        if (response.status !== 200) throw new Error(`claim returned HTTP ${response.status}`);
        const claimed = asRecord(response.body);
        const jobId = requiredString(claimed.jobId, 'jobId');
        const leaseToken = requiredString(claimed.leaseToken, 'leaseToken');
        busy = true;
        lastError = '';
        const result = await runQuery(input.provider, input.config, claimed.request);
        lastQuotaRefreshAt = Date.now();
        busy = false;
        const completionBody = {
          worker: heartbeat(),
          jobId,
          leaseToken,
          result,
        };
        await retry(
          async () => {
            const response = await postJson(input, '/internal/jobs/complete', completionBody, 15_000);
            if (response.status !== 200) throw new Error(`completion returned HTTP ${response.status}`);
            return response;
          },
          3,
          2_000,
        );
      } catch (error) {
        busy = false;
        lastError = message(error);
        console.warn(`[semrush-worker] id=${input.workerId} loop error: ${lastError}`);
        await delay(Math.max(input.pollMs, 3_000));
      }
    }
  })();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopped = true;
      clearInterval(heartbeatTimer);
    });
  }

  return { server, heartbeat };

  async function refreshQuota() {
    try {
      await input.provider.refreshDailyQuota();
      lastError = '';
    } catch (error) {
      lastError = message(error);
    } finally {
      lastQuotaRefreshAt = Date.now();
      await postJson(input, '/internal/workers/heartbeat', heartbeat(), 10_000).catch(() => undefined);
    }
  }
}

async function runQuery(provider: SemrushBrowserProvider, config: ServiceConfig, body: unknown): Promise<WorkerResult> {
  try {
    const cachedQuota = provider.getDailyQuotaSnapshot();
    if (cachedQuota.status === 'exhausted') throw new DailyQuotaExhaustedError(cachedQuota);
    const result = await queryPaymentDestinations(provider, body);
    return { status: 200, body: result };
  } catch (error) {
    return workerErrorResult(error);
  }
}

function workerErrorResult(error: unknown, queue?: BoundedSerialTaskQueue): WorkerResult {
  if (error instanceof DailyQuotaExhaustedError) {
    return { status: 429, body: { error: error.message, code: error.code, quota: error.quota } };
  }
  if (error instanceof DailyQuotaUnavailableError) {
    return { status: 503, body: { error: error.message, code: error.code, quota: error.quota } };
  }
  if (error instanceof QueueFullError) {
    return {
      status: 429,
      body: { error: 'Semrush query queue is full', code: error.code, queue: queue?.snapshot() },
      headers: { 'retry-after': '60' },
    };
  }
  const value = message(error);
  const status = /required|must be|valid hostname|country/i.test(value) ? 400 : 502;
  return { status, body: { error: value } };
}

async function postJson(
  input: { dispatcherUrl: string; serviceToken?: string },
  pathname: string,
  body: unknown,
  timeoutMs: number,
) {
  const url = new URL(pathname, ensureTrailingSlash(input.dispatcherUrl));
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(input.serviceToken ? { authorization: `Bearer ${input.serviceToken}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  return { status: response.status, body: parsed };
}

function ensureTrailingSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Dispatcher returned invalid JSON');
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Dispatcher response is missing ${field}`);
  return value.trim();
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry<T>(operation: () => Promise<T>, attempts: number, delayMs: number) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(delayMs * attempt);
    }
  }
  throw lastError;
}
