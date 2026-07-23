import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerConfig } from './config.js';
import { settleMemoryReviewCredits } from './credit-settlement.js';
import { LocalProfileStore, type UserProfileStore } from './profile-store.js';
import { buildMemoryReviewUsage, type AgentRunUsage } from './usage-meter.js';
import { id, isRecord, nowIso, truncate } from './util.js';
import {
  callHermesText,
  resolveHermesApiKey,
  resolveHermesModelSelection,
  type HermesTextMessage,
  type HermesModelSelection,
} from './hermes/llm-provider.js';

export type MemoryReviewJobStatus = 'queued' | 'running' | 'success' | 'error';
export type MemoryReviewBillingStatus =
  | 'waiting'
  | 'pending'
  | 'processing'
  | 'billed'
  | 'observed'
  | 'skipped'
  | 'error';

export type MemoryReviewJob = {
  id: string;
  status: MemoryReviewJobStatus;
  runId: string;
  investorId: string;
  hermesModel: string;
  userId: string;
  threadId: string;
  userMessage: string;
  assistantReply: string;
  hermesHome: string;
  workspace: string;
  attempts: number;
  usage?: AgentRunUsage;
  billingStatus: MemoryReviewBillingStatus;
  billingAttempts: number;
  billedCredits: number;
  billingError?: string;
  billingUpdatedAt?: string;
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
  | 'id'
  | 'status'
  | 'attempts'
  | 'usage'
  | 'billingStatus'
  | 'billingAttempts'
  | 'billedCredits'
  | 'billingError'
  | 'billingUpdatedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export interface MemoryReviewJobStore {
  enqueue(input: EnqueueMemoryReviewJobInput): Promise<MemoryReviewJob>;
  claimNext(): Promise<MemoryReviewJob | null>;
  complete(
    jobId: string,
    output: { stdout: string; stderr: string; usage?: AgentRunUsage },
  ): Promise<MemoryReviewJob | null>;
  fail(jobId: string, error: unknown, output?: { stdout?: string; stderr?: string }): Promise<MemoryReviewJob | null>;
  claimNextBilling(): Promise<MemoryReviewJob | null>;
  completeBilling(
    jobId: string,
    output: { status: 'billed' | 'observed'; billedCredits: number },
  ): Promise<MemoryReviewJob | null>;
  retryBilling(jobId: string, error: unknown): Promise<MemoryReviewJob | null>;
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
        billingStatus: 'waiting',
        billingAttempts: 0,
        billedCredits: 0,
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

  async complete(jobId: string, output: { stdout: string; stderr: string; usage?: AgentRunUsage }) {
    return this.update(jobId, (job) => {
      job.status = 'success';
      job.stdout = truncate(output.stdout, 8000);
      job.stderr = truncate(output.stderr, 8000);
      job.usage = output.usage;
      job.billingStatus = output.usage ? 'pending' : 'skipped';
      job.billingUpdatedAt = nowIso();
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

  async claimNextBilling() {
    return this.withLock(async () => {
      const database = await this.readDatabase();
      const job = database.jobs.find((item) => (
        item.status === 'success' &&
        item.usage &&
        (item.billingStatus === 'pending' || item.billingStatus === 'processing') &&
        (item.billingAttempts || 0) < 20 &&
        (
          (item.billingAttempts || 0) === 0 ||
          Date.now() - Date.parse(item.billingUpdatedAt || item.updatedAt) >= 30_000
        )
      ));
      if (!job) return null;
      job.billingStatus = 'processing';
      job.billingAttempts = (job.billingAttempts || 0) + 1;
      job.billingUpdatedAt = nowIso();
      job.updatedAt = nowIso();
      await this.writeDatabase(database);
      return { ...job };
    });
  }

  async completeBilling(
    jobId: string,
    output: { status: 'billed' | 'observed'; billedCredits: number },
  ) {
    return this.update(jobId, (job) => {
      job.billingStatus = output.status;
      job.billedCredits = Math.max(0, Math.round(output.billedCredits));
      job.billingError = undefined;
      job.billingUpdatedAt = nowIso();
    });
  }

  async retryBilling(jobId: string, error: unknown) {
    return this.update(jobId, (job) => {
      job.billingError = error instanceof Error ? error.message : String(error);
      job.billingStatus = job.billingAttempts >= 20 ? 'error' : 'pending';
      job.billingUpdatedAt = nowIso();
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
      const database = parsed as JobDatabase;
      database.jobs = database.jobs.map((job) => ({
        ...job,
        runId: job.runId || '',
        investorId: job.investorId || job.userId,
        hermesModel: job.hermesModel || '',
        billingStatus: job.billingStatus || 'skipped',
        billingAttempts: job.billingAttempts || 0,
        billedCredits: job.billedCredits || 0,
      }));
      return database;
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
    private queue: MemoryReviewJobStore,
    private profileStore: UserProfileStore = new LocalProfileStore(config.profileStorePath)
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
      const reviewJob = await this.queue.claimNext();
      if (reviewJob) {
        console.log(`[memory-review-worker] started job=${reviewJob.id} user=${reviewJob.userId} thread=${reviewJob.threadId}`);
        try {
          const output = await this.runReview(reviewJob);
          await this.queue.complete(reviewJob.id, output);
          console.log(`[memory-review-worker] completed job=${reviewJob.id}`);
        } catch (error) {
          await this.queue.fail(reviewJob.id, error);
          console.warn(`[memory-review-worker] failed job=${reviewJob.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const billingJob = await this.queue.claimNextBilling();
      if (billingJob?.usage) {
        try {
          const settled = await settleMemoryReviewCredits(this.config, {
            jobId: billingJob.id,
            sourceRunId: billingJob.runId,
            usage: billingJob.usage,
          });
          if (!settled.settled) {
            throw new Error(`Memory review settlement deferred: ${settled.reason}`);
          }
          await this.queue.completeBilling(billingJob.id, {
            status: settled.mode === 'ENFORCE' ? 'billed' : 'observed',
            billedCredits: settled.billedCredits,
          });
          console.log(
            `[memory-review-worker] billed job=${billingJob.id} run=${billingJob.runId} credits=${settled.billedCredits}`,
          );
        } catch (error) {
          await this.queue.retryBilling(billingJob.id, error);
          console.warn(
            `[memory-review-worker] billing deferred job=${billingJob.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async runReview(job: MemoryReviewJob) {
    const selection = resolveHermesModelSelection(this.config, job.hermesModel);
    const apiKey = resolveHermesApiKey(selection);
    const reviewed = apiKey
      ? await this.reviewWithHermesModel(job, selection)
      : {
          result: {
            memories: [],
            skipReason: `${selection.apiKeyEnv} is missing; skipped LLM memory review.`,
          },
          usage: undefined,
        };
    let savedCount = 0;
    for (const memory of reviewed.result.memories) {
      const saved = await this.profileStore.saveReviewedUserProfile(
        job.userId,
        memory.content,
        job.threadId,
        memory.reason || 'Post-turn memory review'
      );
      if (saved) savedCount += 1;
    }
    return {
      stdout: JSON.stringify(
        {
          mode: apiKey ? 'llm' : 'skipped',
          savedCount,
          skipReason: reviewed.result.skipReason,
          memories: reviewed.result.memories,
        },
        null,
        2
      ),
      stderr: '',
      usage: reviewed.usage,
    };
  }

  private async reviewWithHermesModel(job: MemoryReviewJob, selection: HermesModelSelection) {
    const profile = await this.profileStore.getSnapshot(job.userId);
    const messages: HermesTextMessage[] = [
      {
        role: 'system',
        content: [
          'You are a post-turn memory reviewer for a personal AI agent.',
          'Extract only durable user profile facts, stable preferences, recurring requirements, communication style, or long-lived constraints.',
          'Do not save temporary tasks, current progress, news, one-off instructions, implementation details, tool results, or facts useful only for this turn.',
          'Do not save facts about the assistant, source code, infrastructure, or cloud deployment unless they are explicitly a stable user preference.',
          'Return only valid JSON with this shape:',
          '{"memories":[{"content":"string","reason":"string","confidence":0.0}],"skipReason":string|null}',
          'confidence must be from 0 to 1. Keep each memory compact and declarative. Use the same language as the user when possible.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          existingUserProfile: profile.rendered,
          completedTurn: {
            user: truncate(job.userMessage, 8000),
            assistant: truncate(job.assistantReply, 8000),
          },
        }),
      },
    ];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const completion = await callHermesText(this.config, selection, {
        messages,
        temperature: 0,
        maxTokens: 1200,
        signal: controller.signal,
      });
      return {
        result: normalizeMemoryReviewResult(parseReviewJson(completion.content)),
        usage: buildMemoryReviewUsage({
          config: this.config,
          sourceRunId: job.runId,
          memoryReviewJobId: job.id,
          taskLabel: job.userMessage,
          hermesModel: selection.model,
          hermesProvider: selection.provider,
          rawCompletion: completion.rawCompletion,
        }),
      };
    } catch (error) {
      throw new Error(`Hermes memory review failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

type MemoryReviewResult = {
  memories: Array<{
    content: string;
    reason: string;
    confidence: number;
  }>;
  skipReason: string | null;
};

function normalizeMemoryReviewResult(value: unknown): MemoryReviewResult {
  if (!isRecord(value)) return { memories: [], skipReason: 'Memory reviewer returned invalid JSON.' };
  const memories = Array.isArray(value.memories)
    ? value.memories
        .map((item) => normalizeMemoryCandidate(item))
        .filter((item): item is MemoryReviewResult['memories'][number] => Boolean(item))
        .filter((item) => item.confidence >= 0.65)
        .slice(0, 8)
    : [];
  return {
    memories,
    skipReason: typeof value.skipReason === 'string' && value.skipReason.trim() ? value.skipReason.trim() : null,
  };
}

function normalizeMemoryCandidate(value: unknown): MemoryReviewResult['memories'][number] | null {
  if (!isRecord(value)) return null;
  const content = typeof value.content === 'string' ? value.content.trim() : '';
  if (!content) return null;
  const reason = typeof value.reason === 'string' && value.reason.trim() ? value.reason.trim() : 'Post-turn memory review';
  const confidenceRaw = typeof value.confidence === 'number' ? value.confidence : Number(value.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.75;
  return { content, reason, confidence };
}

function parseReviewJson(content: string) {
  const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}
