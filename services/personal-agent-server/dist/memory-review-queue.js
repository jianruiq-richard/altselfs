import fs from 'node:fs/promises';
import path from 'node:path';
import { LocalProfileStore } from './profile-store.js';
import { id, isRecord, nowIso, truncate } from './util.js';
export class FileMemoryReviewQueue {
    config;
    lock = Promise.resolve();
    constructor(config) {
        this.config = config;
    }
    async enqueue(input) {
        return this.withLock(async () => {
            const timestamp = nowIso();
            const database = await this.readDatabase();
            const job = {
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
            if (!job)
                return null;
            const timestamp = nowIso();
            job.status = 'running';
            job.attempts += 1;
            job.startedAt = timestamp;
            job.updatedAt = timestamp;
            await this.writeDatabase(database);
            return { ...job };
        });
    }
    async complete(jobId, output) {
        return this.update(jobId, (job) => {
            job.status = 'success';
            job.stdout = truncate(output.stdout, 8000);
            job.stderr = truncate(output.stderr, 8000);
            job.completedAt = nowIso();
        });
    }
    async fail(jobId, error, output) {
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
    async update(jobId, update) {
        return this.withLock(async () => {
            const database = await this.readDatabase();
            const job = database.jobs.find((item) => item.id === jobId);
            if (!job)
                return null;
            update(job);
            job.updatedAt = nowIso();
            await this.writeDatabase(database);
            return { ...job };
        });
    }
    async readDatabase() {
        try {
            const raw = await fs.readFile(this.config.memoryReviewJobStorePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.jobs)) {
                return { jobs: [] };
            }
            return parsed;
        }
        catch {
            return { jobs: [] };
        }
    }
    async writeDatabase(database) {
        await fs.mkdir(path.dirname(this.config.memoryReviewJobStorePath), { recursive: true });
        await fs.writeFile(this.config.memoryReviewJobStorePath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
    }
    withLock(fn) {
        const run = this.lock.then(fn, fn);
        this.lock = run.then(() => undefined, () => undefined);
        return run;
    }
}
export class MemoryReviewWorker {
    config;
    queue;
    profileStore;
    timer = null;
    processing = false;
    constructor(config, queue, profileStore = new LocalProfileStore(config.profileStorePath)) {
        this.config = config;
        this.queue = queue;
        this.profileStore = profileStore;
    }
    start() {
        if (this.config.memoryReviewMode !== 'async')
            return;
        this.timer = setInterval(() => {
            void this.tick();
        }, this.config.memoryReviewPollMs);
        void this.tick();
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    async tick() {
        if (this.processing)
            return;
        this.processing = true;
        try {
            const job = await this.queue.claimNext();
            if (!job)
                return;
            console.log(`[memory-review-worker] started job=${job.id} user=${job.userId} thread=${job.threadId}`);
            try {
                const output = await this.runReview(job);
                await this.queue.complete(job.id, output);
                console.log(`[memory-review-worker] completed job=${job.id}`);
            }
            catch (error) {
                await this.queue.fail(job.id, error);
                console.warn(`[memory-review-worker] failed job=${job.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        finally {
            this.processing = false;
        }
    }
    async runReview(job) {
        const apiKey = process.env[this.config.hermesOpenRouterApiKeyEnv]?.trim();
        const result = apiKey
            ? await this.reviewWithOpenRouter(job, apiKey)
            : fallbackReviewWithoutModel(job, `${this.config.hermesOpenRouterApiKeyEnv} is missing`);
        let savedCount = 0;
        for (const memory of result.memories) {
            const saved = await this.profileStore.saveReviewedUserProfile(job.userId, memory.content, job.threadId, memory.reason || 'Post-turn memory review');
            if (saved)
                savedCount += 1;
        }
        return {
            stdout: JSON.stringify({
                mode: apiKey ? 'llm' : 'fallback',
                savedCount,
                skipReason: result.skipReason,
                memories: result.memories,
            }, null, 2),
            stderr: '',
        };
    }
    async reviewWithOpenRouter(job, apiKey) {
        const profile = await this.profileStore.getSnapshot(job.userId);
        const messages = [
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
            const response = await fetch(`${this.config.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    authorization: `Bearer ${apiKey}`,
                    'content-type': 'application/json',
                    'x-openrouter-title': this.config.openRouterAppTitle,
                },
                body: JSON.stringify({
                    model: this.config.hermesModel,
                    messages,
                    temperature: 0,
                    max_tokens: 1200,
                }),
            });
            const text = await response.text();
            if (!response.ok)
                throw new Error(`OpenRouter memory review failed ${response.status}: ${truncate(text, 2000)}`);
            const completion = JSON.parse(text);
            const content = extractCompletionContent(completion);
            return normalizeMemoryReviewResult(parseReviewJson(content));
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
function normalizeMemoryReviewResult(value) {
    if (!isRecord(value))
        return { memories: [], skipReason: 'Memory reviewer returned invalid JSON.' };
    const memories = Array.isArray(value.memories)
        ? value.memories
            .map((item) => normalizeMemoryCandidate(item))
            .filter((item) => Boolean(item))
            .filter((item) => item.confidence >= 0.65)
            .slice(0, 8)
        : [];
    return {
        memories,
        skipReason: typeof value.skipReason === 'string' && value.skipReason.trim() ? value.skipReason.trim() : null,
    };
}
function normalizeMemoryCandidate(value) {
    if (!isRecord(value))
        return null;
    const content = typeof value.content === 'string' ? value.content.trim() : '';
    if (!content)
        return null;
    const reason = typeof value.reason === 'string' && value.reason.trim() ? value.reason.trim() : 'Post-turn memory review';
    const confidenceRaw = typeof value.confidence === 'number' ? value.confidence : Number(value.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.75;
    return { content, reason, confidence };
}
function parseReviewJson(content) {
    const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try {
        return JSON.parse(cleaned);
    }
    catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start < 0 || end <= start)
            return null;
        try {
            return JSON.parse(cleaned.slice(start, end + 1));
        }
        catch {
            return null;
        }
    }
}
function extractCompletionContent(rawCompletion) {
    if (!isRecord(rawCompletion))
        return '';
    const choices = rawCompletion.choices;
    if (!Array.isArray(choices))
        return '';
    const first = choices[0];
    if (!isRecord(first))
        return '';
    const message = first.message;
    if (!isRecord(message))
        return '';
    return typeof message.content === 'string' ? message.content : '';
}
function fallbackReviewWithoutModel(job, reason) {
    const explicit = extractExplicitMemoryRequest(job.userMessage);
    if (!explicit)
        return { memories: [], skipReason: reason };
    return {
        memories: [
            {
                content: explicit,
                reason: 'The user explicitly asked to remember this long-term preference or profile detail',
                confidence: 0.98,
            },
        ],
        skipReason: null,
    };
}
function extractExplicitMemoryRequest(message) {
    const match = message.match(/(?:^|[.!?\n]\s*)(?:please\s+)?(?:remember|save|store|note)\s+(?:that\s+)?(?<content>[\s\S]+)/iu);
    let content = match?.groups?.content?.trim();
    if (!content)
        return '';
    content = content.replace(/(?:reason|rationale|source)[:：].*$/is, '').trim();
    content = content.replace(/^(?:that|this|my preference is|my profile is)[:：\s]*/iu, '').trim();
    return content;
}
