import crypto from 'node:crypto';
import http from 'node:http';
import { bearerToken, json, readJsonBody } from './http-utils.js';

export type WorkerQuota = {
  status?: string;
  usedPercent?: number | null;
  remainingPercent?: number | null;
  acceptingQueries?: boolean;
  observedAt?: string;
  source?: string;
  stopAtUsedPercent?: number;
  error?: string;
};

export type WorkerHeartbeat = {
  workerId: string;
  acceptingQueries: boolean;
  busy: boolean;
  quota?: WorkerQuota;
  version?: string;
  hostname?: string;
  error?: string;
};

export type WorkerResult = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

type WorkerRecord = WorkerHeartbeat & {
  firstSeenAt: string;
  lastHeartbeatAt: string;
  completedJobs: number;
  failedJobs: number;
};

type PendingJob = {
  id: string;
  request: unknown;
  createdAt: string;
  state: 'queued' | 'running';
  workerId?: string;
  leaseToken?: string;
  attemptedWorkerIds: Set<string>;
  resolve: (result: WorkerResult) => void;
  timer: NodeJS.Timeout;
};

type ClaimedJob = {
  jobId: string;
  leaseToken: string;
  request: unknown;
  createdAt: string;
};

export class NoAvailableWorkersError extends Error {
  readonly code = 'NO_AVAILABLE_SEMRUSH_WORKERS';
}

export class DispatcherQueueFullError extends Error {
  readonly code = 'SEMRUSH_DISPATCH_QUEUE_FULL';
}

export class SemrushDispatcher {
  private readonly workers = new Map<string, WorkerRecord>();
  private readonly jobs = new Map<string, PendingJob>();
  private readonly queue: string[] = [];

  constructor(private readonly options: {
    heartbeatStaleMs: number;
    jobTimeoutMs: number;
    maxQueued: number;
    now?: () => number;
  }) {}

  heartbeat(input: WorkerHeartbeat) {
    const workerId = normalizeWorkerId(input.workerId);
    const now = this.nowIso();
    const previous = this.workers.get(workerId);
    const record: WorkerRecord = {
      workerId,
      acceptingQueries: input.acceptingQueries === true,
      busy: input.busy === true,
      ...(input.quota ? { quota: input.quota } : {}),
      ...(input.version ? { version: String(input.version).slice(0, 200) } : {}),
      ...(input.hostname ? { hostname: String(input.hostname).slice(0, 200) } : {}),
      ...(input.error ? { error: String(input.error).slice(0, 1000) } : {}),
      firstSeenAt: previous?.firstSeenAt || now,
      lastHeartbeatAt: now,
      completedJobs: previous?.completedJobs || 0,
      failedJobs: previous?.failedJobs || 0,
    };
    this.workers.set(workerId, record);
    return this.publicWorker(record);
  }

  snapshot() {
    this.requeueOfflineWorkerJobs();
    const workers = [...this.workers.values()]
      .map((worker) => this.publicWorker(worker))
      .sort((a, b) => a.workerId.localeCompare(b.workerId));
    const online = workers.filter((worker) => worker.online);
    const accepting = online.filter((worker) => worker.acceptingQueries);
    return {
      ok: true,
      role: 'dispatcher',
      acceptingQueries: accepting.length > 0,
      capacity: {
        registeredWorkers: workers.length,
        onlineWorkers: online.length,
        acceptingWorkers: accepting.length,
        busyWorkers: online.filter((worker) => worker.busy).length,
        queuedJobs: this.queue.filter((id) => this.jobs.get(id)?.state === 'queued').length,
        runningJobs: [...this.jobs.values()].filter((job) => job.state === 'running').length,
        maxQueued: this.options.maxQueued,
      },
      workers,
    };
  }

  submit(request: unknown) {
    if (!this.hasAcceptingWorker()) throw new NoAvailableWorkersError('No online Semrush worker currently accepts queries');
    const queuedCount = this.queue.filter((id) => this.jobs.get(id)?.state === 'queued').length;
    if (queuedCount >= this.options.maxQueued) throw new DispatcherQueueFullError('Semrush dispatcher queue is full');

    return new Promise<WorkerResult>((resolve) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        const job = this.jobs.get(id);
        if (!job) return;
        this.jobs.delete(id);
        resolve({
          status: 504,
          body: { error: 'Semrush dispatcher job timed out', code: 'SEMRUSH_DISPATCH_TIMEOUT', jobId: id },
        });
      }, this.options.jobTimeoutMs);
      timer.unref();
      this.jobs.set(id, {
        id,
        request,
        createdAt: this.nowIso(),
        state: 'queued',
        attemptedWorkerIds: new Set(),
        resolve,
        timer,
      });
      this.queue.push(id);
    });
  }

  claim(heartbeat: WorkerHeartbeat): ClaimedJob | null {
    const worker = this.heartbeat({ ...heartbeat, busy: false });
    if (!worker.online || !worker.acceptingQueries) return null;
    this.requeueOfflineWorkerJobs();

    for (let index = 0; index < this.queue.length; index += 1) {
      const id = this.queue[index];
      const job = this.jobs.get(id);
      if (!job || job.state !== 'queued') {
        this.queue.splice(index, 1);
        index -= 1;
        continue;
      }
      if (job.attemptedWorkerIds.has(worker.workerId)) continue;
      this.queue.splice(index, 1);
      const leaseToken = crypto.randomUUID();
      job.state = 'running';
      job.workerId = worker.workerId;
      job.leaseToken = leaseToken;
      job.attemptedWorkerIds.add(worker.workerId);
      const record = this.workers.get(worker.workerId);
      if (record) record.busy = true;
      return { jobId: id, leaseToken, request: job.request, createdAt: job.createdAt };
    }
    return null;
  }

  complete(input: {
    worker: WorkerHeartbeat;
    jobId: string;
    leaseToken: string;
    result: WorkerResult;
  }) {
    const worker = this.heartbeat({ ...input.worker, busy: false });
    const job = this.jobs.get(input.jobId);
    if (!job || job.state !== 'running') return { accepted: false, reason: 'job_not_running' };
    if (job.workerId !== worker.workerId || job.leaseToken !== input.leaseToken) {
      return { accepted: false, reason: 'lease_mismatch' };
    }

    const workerRecord = this.workers.get(worker.workerId);
    const retryable = isSafeWorkerRejection(input.result);
    const hasAlternative = [...this.workers.values()].some((candidate) => (
      candidate.workerId !== worker.workerId
      && !job.attemptedWorkerIds.has(candidate.workerId)
      && candidate.acceptingQueries
      && this.isOnline(candidate)
    ));
    if (retryable && hasAlternative) {
      if (workerRecord) workerRecord.failedJobs += 1;
      job.state = 'queued';
      delete job.workerId;
      delete job.leaseToken;
      this.queue.push(job.id);
      return { accepted: true, requeued: true };
    }

    if (workerRecord) {
      if (input.result.status >= 200 && input.result.status < 300) workerRecord.completedJobs += 1;
      else workerRecord.failedJobs += 1;
    }
    clearTimeout(job.timer);
    this.jobs.delete(job.id);
    job.resolve(input.result);
    return { accepted: true, requeued: false };
  }

  private hasAcceptingWorker() {
    return [...this.workers.values()].some((worker) => worker.acceptingQueries && this.isOnline(worker));
  }

  private requeueOfflineWorkerJobs() {
    for (const job of this.jobs.values()) {
      if (job.state !== 'running' || !job.workerId) continue;
      const worker = this.workers.get(job.workerId);
      if (worker && this.isOnline(worker)) continue;
      job.state = 'queued';
      delete job.workerId;
      delete job.leaseToken;
      if (!this.queue.includes(job.id)) this.queue.push(job.id);
    }
  }

  private publicWorker(worker: WorkerRecord) {
    return {
      workerId: worker.workerId,
      online: this.isOnline(worker),
      acceptingQueries: worker.acceptingQueries,
      busy: worker.busy,
      quota: worker.quota,
      version: worker.version,
      hostname: worker.hostname,
      error: worker.error,
      firstSeenAt: worker.firstSeenAt,
      lastHeartbeatAt: worker.lastHeartbeatAt,
      completedJobs: worker.completedJobs,
      failedJobs: worker.failedJobs,
    };
  }

  private isOnline(worker: WorkerRecord) {
    return this.now() - Date.parse(worker.lastHeartbeatAt) <= this.options.heartbeatStaleMs;
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private nowIso() {
    return new Date(this.now()).toISOString();
  }
}

export function startDispatcherServer(input: {
  port: number;
  serviceToken?: string;
  heartbeatStaleMs: number;
  jobTimeoutMs: number;
  maxQueued: number;
}) {
  const dispatcher = new SemrushDispatcher(input);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, dispatcher.snapshot());
      if (input.serviceToken && bearerToken(req) !== input.serviceToken) return json(res, 403, { error: 'Forbidden' });
      if (req.method === 'GET' && (url.pathname === '/v1/quota' || url.pathname === '/v1/workers')) {
        return json(res, 200, dispatcher.snapshot());
      }
      if (req.method === 'POST' && url.pathname === '/v1/payment-destinations') {
        const result = await dispatcher.submit(await readJsonBody(req));
        return json(res, result.status, result.body, result.headers);
      }
      if (req.method === 'POST' && url.pathname === '/internal/workers/heartbeat') {
        return json(res, 200, dispatcher.heartbeat(parseHeartbeat(await readJsonBody(req))));
      }
      if (req.method === 'POST' && url.pathname === '/internal/jobs/claim') {
        const claimed = dispatcher.claim(parseHeartbeat(await readJsonBody(req)));
        return claimed ? json(res, 200, claimed) : json(res, 204, null);
      }
      if (req.method === 'POST' && url.pathname === '/internal/jobs/complete') {
        const body = asRecord(await readJsonBody(req));
        const resultValue = asRecord(body.result);
        const result: WorkerResult = {
          status: positiveInteger(resultValue.status, 502),
          body: resultValue.body,
          ...(isStringRecord(resultValue.headers) ? { headers: resultValue.headers } : {}),
        };
        return json(res, 200, dispatcher.complete({
          worker: parseHeartbeat(body.worker),
          jobId: requiredString(body.jobId, 'jobId'),
          leaseToken: requiredString(body.leaseToken, 'leaseToken'),
          result,
        }));
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      if (error instanceof NoAvailableWorkersError) {
        return json(res, 503, { error: error.message, code: error.code, pool: dispatcher.snapshot() });
      }
      if (error instanceof DispatcherQueueFullError) {
        return json(res, 429, { error: error.message, code: error.code, pool: dispatcher.snapshot() }, { 'retry-after': '60' });
      }
      return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  server.listen(input.port, '0.0.0.0', () => {
    console.log(`[semrush-dispatcher] listening on :${input.port}; maxQueued=${input.maxQueued}`);
  });
  return { server, dispatcher };
}

function parseHeartbeat(value: unknown): WorkerHeartbeat {
  const body = asRecord(value);
  const quota = body.quota === undefined ? undefined : asRecord(body.quota) as WorkerQuota;
  return {
    workerId: requiredString(body.workerId, 'workerId'),
    acceptingQueries: body.acceptingQueries === true,
    busy: body.busy === true,
    ...(quota ? { quota } : {}),
    ...(typeof body.version === 'string' ? { version: body.version } : {}),
    ...(typeof body.hostname === 'string' ? { hostname: body.hostname } : {}),
    ...(typeof body.error === 'string' ? { error: body.error } : {}),
  };
}

function isSafeWorkerRejection(result: WorkerResult) {
  if (result.status !== 429 && result.status !== 503) return false;
  const body = asRecordOrUndefined(result.body);
  return ['DAILY_QUOTA_EXHAUSTED', 'DAILY_QUOTA_UNAVAILABLE', 'SEMRUSH_QUEUE_FULL'].includes(String(body?.code || ''));
}

function normalizeWorkerId(value: string) {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(normalized)) throw new Error('workerId is invalid');
  return normalized;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object is required');
  return value as Record<string, unknown>;
}

function asRecordOrUndefined(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string'));
}
