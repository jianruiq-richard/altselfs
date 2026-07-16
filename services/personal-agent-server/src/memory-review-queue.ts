import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerConfig } from './config.js';
import { LocalProfileStore, type UserProfileStore } from './profile-store.js';
import { id, isRecord, nowIso, truncate } from './util.js';
import {
  hermesChatCompletionsUrl,
  hermesChatHeaders,
  resolveHermesApiKey,
  resolveHermesModelSelection,
  type HermesModelSelection,
} from './hermes/llm-provider.js';

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
    const selection = resolveHermesModelSelection(this.config);
    const apiKey = resolveHermesApiKey(selection);
    const result = apiKey
      ? await this.reviewWithHermesModel(job, selection)
      : {
          memories: [],
          skipReason: `${selection.apiKeyEnv} is missing; skipped LLM memory review.`,
        };
    let savedCount = 0;
    for (const memory of result.memories) {
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
          skipReason: result.skipReason,
          memories: result.memories,
        },
        null,
        2
      ),
      stderr: '',
    };
  }

  private async reviewWithHermesModel(job: MemoryReviewJob, selection: HermesModelSelection): Promise<MemoryReviewResult> {
    const profile = await this.profileStore.getSnapshot(job.userId);
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
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
      const response = await fetch(hermesChatCompletionsUrl(selection), {
        method: 'POST',
        signal: controller.signal,
        headers: hermesChatHeaders(this.config, selection),
        body: JSON.stringify({
          model: selection.model,
          messages,
          temperature: 0,
          max_tokens: 1200,
        }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Hermes memory review failed ${response.status}: ${truncate(text, 2000)}`);
      const completion = JSON.parse(text) as unknown;
      const content = extractCompletionContent(completion);
      return normalizeMemoryReviewResult(parseReviewJson(content));
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

function extractCompletionContent(rawCompletion: unknown) {
  if (!isRecord(rawCompletion)) return '';
  const choices = rawCompletion.choices;
  if (!Array.isArray(choices)) return '';
  const first = choices[0];
  if (!isRecord(first)) return '';
  const message = first.message;
  if (!isRecord(message)) return '';
  return typeof message.content === 'string' ? message.content : '';
}
