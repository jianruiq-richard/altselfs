import { id, nowIso, truncate } from './util.js';
let sharedPool = null;
export async function getPostgresPool(config) {
    if (sharedPool)
        return sharedPool;
    if (!config.databaseUrl) {
        throw new Error('DATABASE_URL is required when STORAGE_BACKEND=postgres');
    }
    let pg;
    try {
        pg = (await import('pg'));
    }
    catch (error) {
        throw new Error(`STORAGE_BACKEND=postgres requires the "pg" package. Run npm install in services/personal-agent-server. Original error: ${error instanceof Error ? error.message : String(error)}`);
    }
    sharedPool = new pg.Pool({ connectionString: config.databaseUrl });
    return sharedPool;
}
export class PostgresUserProfileStore {
    config;
    constructor(config) {
        this.config = config;
    }
    async getSnapshot(userId) {
        const pool = await getPostgresPool(this.config);
        const result = await pool.query([
            'select id, user_id, content, source_thread_id, confidence, created_at, updated_at',
            'from agent_memory_entries',
            "where user_id = $1 and scope = 'user' and status = 'active'",
            'order by created_at asc',
            'limit 50',
        ].join(' '), [userId]);
        const entries = result.rows.map(rowToProfileEntry);
        return {
            userId,
            entries,
            rendered: entries.map((entry) => `- ${entry.content}`).join('\n'),
        };
    }
    async saveReviewedUserProfile(userId, content, threadId, reason) {
        const normalized = content.trim();
        if (!normalized)
            return null;
        return this.saveProfileEntry(userId, normalized, threadId, reason || 'Long-term user profile or preference identified by Hermes memory review', 0.8);
    }
    async saveProfileEntry(userId, content, threadId, reason, confidence) {
        const pool = await getPostgresPool(this.config);
        const existing = await pool.query([
            'select id, user_id, content, source_thread_id, confidence, created_at, updated_at',
            'from agent_memory_entries',
            "where user_id = $1 and scope = 'user' and status = 'active' and lower(content) = lower($2)",
            'order by created_at asc',
            'limit 1',
        ].join(' '), [userId, content]);
        if (existing.rows[0]) {
            const updated = await pool.query([
                'update agent_memory_entries',
                'set updated_at = now(), source_thread_id = coalesce($2, source_thread_id)',
                'where id = $1',
                'returning id, user_id, content, source_thread_id, confidence, created_at, updated_at',
            ].join(' '), [String(existing.rows[0].id), threadId || null]);
            return rowToProfileEntry(updated.rows[0]);
        }
        const entryId = id('profile');
        const inserted = await pool.query([
            'insert into agent_memory_entries',
            '(id, user_id, scope, content, status, source_thread_id, confidence, created_at, updated_at)',
            "values ($1, $2, 'user', $3, 'active', $4, $5, now(), now())",
            'returning id, user_id, content, source_thread_id, confidence, created_at, updated_at',
        ].join(' '), [entryId, userId, content, threadId || null, confidence]);
        await pool.query([
            'insert into agent_memory_events',
            '(id, memory_id, user_id, action, after_content, reason, created_at)',
            "values ($1, $2, $3, 'add', $4, $5, now())",
        ].join(' '), [id('memevt'), entryId, userId, content, reason]);
        return rowToProfileEntry(inserted.rows[0]);
    }
}
export class PostgresMemoryReviewJobStore {
    config;
    constructor(config) {
        this.config = config;
    }
    async enqueue(input) {
        const pool = await getPostgresPool(this.config);
        const result = await pool.query([
            'insert into agent_memory_review_jobs',
            '(id, user_id, thread_id, status, user_message, assistant_reply, hermes_home, workspace, attempts, created_at, updated_at)',
            "values ($1, $2, $3, 'queued', $4, $5, $6, $7, 0, now(), now())",
            'returning *',
        ].join(' '), [
            id('memrev'),
            input.userId,
            input.threadId,
            input.userMessage,
            input.assistantReply,
            input.hermesHome,
            input.workspace,
        ]);
        return rowToMemoryReviewJob(result.rows[0]);
    }
    async claimNext() {
        const pool = await getPostgresPool(this.config);
        const client = await pool.connect();
        try {
            await client.query('begin');
            const result = await client.query([
                'select * from agent_memory_review_jobs',
                "where status = 'queued'",
                'order by created_at asc',
                'for update skip locked',
                'limit 1',
            ].join(' '));
            const row = result.rows[0];
            if (!row) {
                await client.query('commit');
                return null;
            }
            const updated = await client.query([
                'update agent_memory_review_jobs',
                "set status = 'running', attempts = attempts + 1, started_at = now(), updated_at = now()",
                'where id = $1',
                'returning *',
            ].join(' '), [String(row.id)]);
            await client.query('commit');
            return rowToMemoryReviewJob(updated.rows[0]);
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async complete(jobId, output) {
        const pool = await getPostgresPool(this.config);
        const result = await pool.query([
            'update agent_memory_review_jobs',
            "set status = 'success', stdout = $2, stderr = $3, completed_at = now(), updated_at = now()",
            'where id = $1',
            'returning *',
        ].join(' '), [jobId, truncate(output.stdout, 8000), truncate(output.stderr, 8000)]);
        return result.rows[0] ? rowToMemoryReviewJob(result.rows[0]) : null;
    }
    async fail(jobId, error, output) {
        const pool = await getPostgresPool(this.config);
        const message = error instanceof Error ? error.message : String(error);
        const result = await pool.query([
            'update agent_memory_review_jobs',
            "set status = 'error', error = $2, stdout = coalesce($3, stdout), stderr = coalesce($4, stderr),",
            'completed_at = now(), updated_at = now()',
            'where id = $1',
            'returning *',
        ].join(' '), [jobId, message, output?.stdout ? truncate(output.stdout, 8000) : null, output?.stderr ? truncate(output.stderr, 8000) : null]);
        return result.rows[0] ? rowToMemoryReviewJob(result.rows[0]) : null;
    }
    async listRecent(limit = 50) {
        const pool = await getPostgresPool(this.config);
        const result = await pool.query('select * from agent_memory_review_jobs order by created_at desc limit $1', [Math.max(1, Math.min(200, Math.round(limit)))]);
        return result.rows.map(rowToMemoryReviewJob);
    }
}
function rowToProfileEntry(row) {
    return {
        id: String(row.id || ''),
        userId: String(row.user_id || ''),
        content: String(row.content || ''),
        reason: 'From PostgreSQL user profile storage',
        sourceThreadId: typeof row.source_thread_id === 'string' ? row.source_thread_id : undefined,
        createdAt: dateishToIso(row.created_at),
        updatedAt: dateishToIso(row.updated_at),
    };
}
function rowToMemoryReviewJob(row) {
    return {
        id: String(row.id || ''),
        status: String(row.status || 'queued'),
        userId: String(row.user_id || ''),
        threadId: String(row.thread_id || ''),
        userMessage: String(row.user_message || ''),
        assistantReply: String(row.assistant_reply || ''),
        hermesHome: String(row.hermes_home || ''),
        workspace: String(row.workspace || ''),
        attempts: Number(row.attempts || 0),
        error: typeof row.error === 'string' ? row.error : undefined,
        stdout: typeof row.stdout === 'string' ? row.stdout : undefined,
        stderr: typeof row.stderr === 'string' ? row.stderr : undefined,
        createdAt: dateishToIso(row.created_at),
        updatedAt: dateishToIso(row.updated_at),
        startedAt: row.started_at ? dateishToIso(row.started_at) : undefined,
        completedAt: row.completed_at ? dateishToIso(row.completed_at) : undefined,
    };
}
function dateishToIso(value) {
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === 'string')
        return new Date(value).toISOString();
    return nowIso();
}
