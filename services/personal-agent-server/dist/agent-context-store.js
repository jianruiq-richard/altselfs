import { id, isRecord, truncate } from './util.js';
import { resolveHermesModelSelection } from './hermes/llm-provider.js';
let sharedContextPool = null;
let sharedContextUrl = '';
export async function loadCleanTurnContext(config, request) {
    const databaseUrl = config.contextDatabaseUrl;
    const threadId = request.threadId || '';
    const currentMessage = currentUserMessage(request);
    if (!databaseUrl || !threadId) {
        return emptyContext(currentMessage, databaseUrl ? [] : ['AGENT_CONTEXT_DATABASE_URL is not configured']);
    }
    const pool = await getContextPostgresPool(databaseUrl);
    await ensureAgentContextSchema(pool);
    const investorId = typeof request.metadata?.investorId === 'string' ? request.metadata.investorId : '';
    const warnings = [];
    const artifactsResult = await pool.query([
        'select id, kind, name, mime_type as "mimeType", size_bytes as "sizeBytes", content_text as "contentText", metadata, created_at as "createdAt"',
        'from agent_context_artifacts',
        'where thread_id = $1',
        investorId ? 'and investor_id = $2' : '',
        'order by created_at desc, id desc',
        'limit 12',
    ].join(' '), investorId ? [threadId, investorId] : [threadId]).catch((error) => {
        warnings.push(`artifacts unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return { rows: [] };
    });
    const artifacts = artifactsResult.rows;
    const artifactContext = buildArtifactContextMessage({ artifacts });
    return {
        message: currentMessage,
        artifactContext,
        loaded: true,
        summaryChars: 0,
        messageCount: 0,
        artifactCount: artifacts.length,
        warnings,
    };
}
export async function persistAgentTurnInput(config, request, options = {}) {
    const pool = await getRequiredContextPool(config);
    const investorId = metadataString(request, 'investorId') || request.userId;
    const threadId = request.threadId || '';
    if (!threadId)
        throw new Error('threadId is required for agent context persistence');
    const runId = metadataString(request, 'runId') || id('run');
    const userMessageId = metadataString(request, 'currentMessageId') || id('msg');
    const message = currentUserMessage(request);
    const displayMessage = metadataString(request, 'displayUserMessage') || message;
    const messageMetadata = isRecord(request.metadata?.currentMessageMetadata)
        ? request.metadata.currentMessageMetadata
        : {};
    const warnings = [];
    const status = options.status || 'RUNNING';
    const modelSelection = resolveRunModelSelection(config, request);
    const timeoutAt = status === 'RUNNING' && options.timeoutMs
        ? new Date(Date.now() + options.timeoutMs).toISOString()
        : null;
    const runResult = await pool.query([
        'insert into agent_context_runs',
        '(',
        'id, investor_id, thread_id, status, queued_at, started_at, request, execution_request,',
        'model_provider, model, timeout_at',
        ')',
        'values ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::jsonb, $8::jsonb, $9, $10, $11::timestamptz)',
        'on conflict (id) do update set',
        'request = excluded.request,',
        "execution_request = case when agent_context_runs.status in ('QUEUED', 'ERROR', 'CANCELLED', 'TIMEOUT') then excluded.execution_request else agent_context_runs.execution_request end,",
        "status = case when agent_context_runs.status in ('ERROR', 'CANCELLED', 'TIMEOUT') then excluded.status else agent_context_runs.status end,",
        "queued_at = case when agent_context_runs.status in ('ERROR', 'CANCELLED', 'TIMEOUT') then excluded.queued_at else agent_context_runs.queued_at end,",
        "started_at = case when agent_context_runs.status in ('ERROR', 'CANCELLED', 'TIMEOUT') then excluded.started_at else agent_context_runs.started_at end,",
        "completed_at = case when agent_context_runs.status in ('ERROR', 'CANCELLED', 'TIMEOUT') then null else agent_context_runs.completed_at end,",
        "result = case when agent_context_runs.status in ('ERROR', 'CANCELLED', 'TIMEOUT') then null else agent_context_runs.result end,",
        "error = case when agent_context_runs.status in ('ERROR', 'CANCELLED', 'TIMEOUT') then null else agent_context_runs.error end,",
        "worker_id = case when agent_context_runs.status in ('ERROR', 'CANCELLED', 'TIMEOUT') then null else agent_context_runs.worker_id end,",
        "worker_heartbeat_at = case when agent_context_runs.status in ('ERROR', 'CANCELLED', 'TIMEOUT') then null else agent_context_runs.worker_heartbeat_at end,",
        "attempt_count = case when agent_context_runs.status in ('ERROR', 'CANCELLED', 'TIMEOUT') then 0 else agent_context_runs.attempt_count end,",
        "next_attempt_at = case when agent_context_runs.status in ('ERROR', 'CANCELLED', 'TIMEOUT') then null else agent_context_runs.next_attempt_at end,",
        "timeout_at = case when agent_context_runs.status in ('ERROR', 'CANCELLED', 'TIMEOUT') then null else agent_context_runs.timeout_at end,",
        'model_provider = excluded.model_provider, model = excluded.model, updated_at = now()',
        'returning status',
    ].join(' '), [
        runId,
        investorId,
        threadId,
        status,
        status === 'QUEUED' ? new Date().toISOString() : null,
        status === 'RUNNING' ? new Date().toISOString() : null,
        stringifyJson({
            userId: request.userId,
            threadId,
            message: request.message,
            allowedAgents: request.allowedAgents,
            metadata: requestMetadataForStorage(request.metadata),
        }),
        options.storeExecutionRequest ? stringifyJson(requestForExecutionStorage(request)) : null,
        modelSelection.provider || null,
        modelSelection.model || null,
        timeoutAt,
    ]);
    await pool.query([
        'insert into agent_context_messages',
        '(id, investor_id, thread_id, role, content, metadata)',
        'values ($1, $2, $3, $4, $5, $6::jsonb)',
        'on conflict (id) do update set',
        'content = excluded.content, metadata = excluded.metadata',
    ].join(' '), [userMessageId, investorId, threadId, 'USER', displayMessage, stringifyJson(messageMetadata)]);
    const parsedAttachment = isRecord(request.metadata?.parsedAttachment) ? request.metadata.parsedAttachment : null;
    const parsedAttachmentText = typeof parsedAttachment?.contentText === 'string' ? parsedAttachment.contentText.trim() : '';
    if (parsedAttachment && parsedAttachmentText) {
        await pool.query([
            'insert into agent_context_artifacts',
            '(id, investor_id, thread_id, run_id, kind, name, mime_type, size_bytes, content_text, metadata)',
            'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)',
        ].join(' '), [
            id('art'),
            investorId,
            threadId,
            runId,
            typeof parsedAttachment.kind === 'string' ? parsedAttachment.kind : 'parsed_attachment_text',
            typeof parsedAttachment.name === 'string' ? parsedAttachment.name : 'parsed attachments',
            typeof parsedAttachment.mimeType === 'string' ? parsedAttachment.mimeType : null,
            typeof parsedAttachment.sizeBytes === 'number' ? Math.floor(parsedAttachment.sizeBytes) : parsedAttachmentText.length,
            parsedAttachmentText,
            stringifyJson(isRecord(parsedAttachment.metadata) ? parsedAttachment.metadata : {}),
        ]).catch((error) => {
            warnings.push(`parsed attachment persistence failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
    return {
        runId,
        userMessageId,
        investorId,
        currentUserMessage: message,
        warnings,
        status: typeof runResult.rows[0]?.status === 'string' ? String(runResult.rows[0].status) : status,
    };
}
export async function claimNextQueuedAgentTurn(config, input) {
    const pool = await getRequiredContextPool(config);
    const result = await pool.query([
        'with candidate as (',
        'select r.*',
        'from agent_context_runs r',
        "where r.status = 'QUEUED'",
        "and pg_try_advisory_xact_lock(hashtext('altselfs_agent_turn_queue_claim'))",
        'and (r.next_attempt_at is null or r.next_attempt_at <= now())',
        'and (select count(*) from agent_context_runs g where g.status = $2) < $3',
        'and (',
        '  coalesce(r.model_provider, $11) <> $4',
        '  or (select count(*) from agent_context_runs o where o.status = $2 and o.model_provider = $4) < $5',
        ')',
        'and (',
        '  coalesce(r.model_provider, $11) <> $6',
        '  or (select count(*) from agent_context_runs o where o.status = $2 and o.model_provider = $6) < $7',
        ')',
        'and (',
        '  $8 <= 0',
        '  or (select count(*) from agent_context_runs u where u.status = $2 and u.investor_id = r.investor_id) < $8',
        ')',
        'and (',
        '  $9 <= 0',
        '  or (select count(*) from agent_context_runs t where t.status = $2 and t.thread_id = r.thread_id) < $9',
        ')',
        'and not exists (',
        '  select 1 from agent_context_runs e',
        '  where e.thread_id = r.thread_id',
        "  and e.status = 'QUEUED'",
        '  and (e.created_at, e.id) < (r.created_at, r.id)',
        ')',
        'order by r.created_at asc, r.id asc',
        'for update skip locked',
        'limit 1',
        ')',
        'update agent_context_runs r',
        'set status = $2,',
        'started_at = now(),',
        'worker_id = $1,',
        'worker_heartbeat_at = now(),',
        'attempt_count = coalesce(r.attempt_count, 0) + 1,',
        'timeout_at = now() + ($10::bigint * interval \'1 millisecond\'),',
        'updated_at = now()',
        'from candidate c',
        'where r.id = c.id',
        'returning r.*',
    ].join(' '), [
        input.workerId,
        'RUNNING',
        Math.max(1, input.limits.maxConcurrency),
        'openai',
        Math.max(1, input.limits.maxOpenAi),
        'openrouter',
        Math.max(1, input.limits.maxOpenRouter),
        Math.max(0, input.limits.maxPerUser),
        Math.max(0, input.limits.maxPerThread),
        Math.max(1_000, input.timeoutMs),
        '',
    ]);
    const row = result.rows[0];
    if (!row)
        return null;
    try {
        return rowToQueuedAgentTurn(row);
    }
    catch (error) {
        await pool.query([
            'update agent_context_runs',
            "set status = 'ERROR', error = $2, execution_request = null, completed_at = now(), updated_at = now()",
            'where id = $1',
        ].join(' '), [String(row.id || ''), error instanceof Error ? error.message : String(error)]).catch(() => null);
        return null;
    }
}
export async function expireStaleAgentTurns(config, input) {
    const pool = await getRequiredContextPool(config);
    const result = await pool.query([
        'update agent_context_runs',
        "set status = 'TIMEOUT',",
        "error = coalesce(error, 'agent worker timeout'),",
        'execution_request = null, completed_at = now(), updated_at = now()',
        "where status = 'RUNNING'",
        'and (',
        '  timeout_at < now()',
        '  or (worker_heartbeat_at is not null and worker_heartbeat_at < now() - ($1::bigint * interval \'1 millisecond\'))',
        ')',
        'returning id',
    ].join(' '), [Math.max(1_000, input.staleHeartbeatMs)]);
    return result.rows.length;
}
export async function markQueuedAgentTurnWaiting(config, input) {
    const pool = await getRequiredContextPool(config);
    await pool.query([
        'update agent_context_runs',
        'set next_attempt_at = now() + ($3::bigint * interval \'1 millisecond\'),',
        "error = case when status = 'QUEUED' then $2 else error end,",
        'updated_at = now()',
        "where id = $1 and status = 'QUEUED'",
    ].join(' '), [input.runId, input.reason, Math.max(1_000, input.delayMs)]);
}
export async function persistAgentArtifacts(config, artifacts) {
    if (artifacts.length === 0)
        return;
    const pool = await getRequiredContextPool(config);
    for (const artifact of artifacts) {
        await pool.query([
            'insert into agent_context_artifacts',
            '(id, investor_id, thread_id, run_id, kind, name, mime_type, size_bytes, content_text, metadata)',
            'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)',
            'on conflict (id) do update set',
            'run_id = excluded.run_id, kind = excluded.kind, name = excluded.name,',
            'mime_type = excluded.mime_type, size_bytes = excluded.size_bytes,',
            'content_text = excluded.content_text, metadata = excluded.metadata, updated_at = now()',
        ].join(' '), [
            artifact.id || id('art'),
            artifact.investorId,
            artifact.threadId,
            artifact.runId || null,
            artifact.kind,
            artifact.name,
            artifact.mimeType || null,
            typeof artifact.sizeBytes === 'number' ? Math.floor(artifact.sizeBytes) : null,
            artifact.contentText || null,
            stringifyJson(artifact.metadata || {}),
        ]);
    }
}
export async function getAgentContextArtifactsByIds(config, input) {
    const artifactIds = Array.from(new Set(input.artifactIds.map((item) => item.trim()).filter(Boolean)));
    if (artifactIds.length === 0)
        return [];
    const pool = await getRequiredContextPool(config);
    const values = [input.investorId, artifactIds];
    const where = ['investor_id = $1', 'id = any($2::text[])'];
    if (input.threadId) {
        values.push(input.threadId);
        where.push(`thread_id = $${values.length}`);
    }
    const result = await pool.query([
        'select id, investor_id as "investorId", thread_id as "threadId", run_id as "runId",',
        'kind, name, mime_type as "mimeType", size_bytes as "sizeBytes", content_text as "contentText",',
        'metadata, created_at as "createdAt", updated_at as "updatedAt"',
        'from agent_context_artifacts',
        `where ${where.join(' and ')}`,
        'order by created_at asc, id asc',
    ].join(' '), values);
    return result.rows.map(rowToAgentContextArtifactRecord);
}
export async function patchAgentContextArtifactMetadata(config, input) {
    const pool = await getRequiredContextPool(config);
    const values = [
        input.artifactId,
        input.investorId,
        stringifyJson(input.metadata),
    ];
    const setClauses = ["metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb", 'updated_at = now()'];
    if (input.runId !== undefined) {
        values.push(input.runId);
        setClauses.push(`run_id = $${values.length}`);
    }
    if (input.kind !== undefined) {
        values.push(input.kind);
        setClauses.push(`kind = $${values.length}`);
    }
    if (input.mimeType !== undefined) {
        values.push(input.mimeType);
        setClauses.push(`mime_type = $${values.length}`);
    }
    if (input.sizeBytes !== undefined) {
        values.push(typeof input.sizeBytes === 'number' ? Math.floor(input.sizeBytes) : null);
        setClauses.push(`size_bytes = $${values.length}`);
    }
    if (input.contentText !== undefined) {
        values.push(input.contentText);
        setClauses.push(`content_text = $${values.length}`);
    }
    const where = ['id = $1', 'investor_id = $2'];
    if (input.threadId) {
        values.push(input.threadId);
        where.push(`thread_id = $${values.length}`);
    }
    await pool.query([
        'update agent_context_artifacts',
        `set ${setClauses.join(', ')}`,
        `where ${where.join(' and ')}`,
    ].join(' '), values);
}
export async function upsertAgentSandboxControlPlane(config, input) {
    if (!config.contextDatabaseUrl)
        return;
    const pool = await getContextPostgresPool(config.contextDatabaseUrl);
    await ensureAgentContextSchema(pool);
    const sandboxPath = input.paths.threadRoot || input.paths.workspace;
    const activeRunId = input.status === 'ACTIVE' ? input.runId : null;
    const metadata = stringifyJson({
        ...(input.metadata || {}),
        mode: input.paths.mode,
        userSegment: input.paths.userSegment,
        threadSegment: input.paths.threadSegment,
        error: input.error || null,
    });
    await pool.query([
        'insert into agent_context_threads',
        '(thread_id, user_id, investor_id, status, sandbox_path, active_session_id, last_active_at, metadata)',
        'values ($1, $2, $3, $4, $5, $6, now(), $7::jsonb)',
        'on conflict (thread_id) do update set',
        'user_id = excluded.user_id, investor_id = excluded.investor_id,',
        'status = excluded.status, sandbox_path = excluded.sandbox_path,',
        'active_session_id = excluded.active_session_id, last_active_at = now(),',
        'metadata = excluded.metadata, updated_at = now()',
    ].join(' '), [
        input.threadId,
        input.userId,
        input.investorId,
        input.status,
        sandboxPath,
        input.activeSessionId || null,
        metadata,
    ]);
    await pool.query([
        'insert into agent_context_sandbox_state',
        '(',
        'thread_id, user_id, investor_id, status, sandbox_path, user_root, thread_root,',
        'hermes_home, codex_home, workspace, active_run_id, active_session_id,',
        'last_heartbeat, disk_bytes, metadata',
        ')',
        'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13, $14::jsonb)',
        'on conflict (thread_id) do update set',
        'user_id = excluded.user_id, investor_id = excluded.investor_id,',
        'status = excluded.status, sandbox_path = excluded.sandbox_path,',
        'user_root = excluded.user_root, thread_root = excluded.thread_root,',
        'hermes_home = excluded.hermes_home, codex_home = excluded.codex_home, workspace = excluded.workspace,',
        'active_run_id = excluded.active_run_id, active_session_id = excluded.active_session_id,',
        'last_heartbeat = now(), disk_bytes = excluded.disk_bytes,',
        'metadata = excluded.metadata, updated_at = now()',
    ].join(' '), [
        input.threadId,
        input.userId,
        input.investorId,
        input.status,
        sandboxPath,
        input.paths.userRoot || null,
        input.paths.threadRoot || null,
        input.paths.hermesHome,
        input.paths.codexHome,
        input.paths.workspace,
        activeRunId,
        input.activeSessionId || null,
        typeof input.diskBytes === 'number' ? Math.max(0, Math.floor(input.diskBytes)) : null,
        metadata,
    ]);
}
export async function getAgentThreadRuntimeStatus(config, input) {
    const pool = await getRequiredContextPool(config);
    const threadValues = [input.threadId];
    const threadWhere = ['thread_id = $1'];
    if (input.investorId) {
        threadValues.push(input.investorId);
        threadWhere.push(`investor_id = $${threadValues.length}`);
    }
    if (input.userId) {
        threadValues.push(input.userId);
        threadWhere.push(`user_id = $${threadValues.length}`);
    }
    const [threadResult, sandboxResult, runsResult] = await Promise.all([
        pool.query([
            'select thread_id, user_id, investor_id, status, sandbox_path, active_session_id,',
            'last_active_at, metadata, created_at, updated_at',
            'from agent_context_threads',
            `where ${threadWhere.join(' and ')}`,
            'limit 1',
        ].join(' '), threadValues),
        pool.query([
            'select thread_id, user_id, investor_id, status, sandbox_path, user_root, thread_root,',
            'hermes_home, codex_home, workspace, active_run_id, active_session_id,',
            'last_heartbeat, disk_bytes, metadata, created_at, updated_at',
            'from agent_context_sandbox_state',
            `where ${threadWhere.join(' and ')}`,
            'limit 1',
        ].join(' '), threadValues),
        pool.query([
            'select id, investor_id, thread_id, status, route, result, error, queued_at, started_at, completed_at,',
            'worker_id, worker_heartbeat_at, attempt_count, model_provider, model, created_at, updated_at',
            'from agent_context_runs',
            'where thread_id = $1',
            input.investorId ? 'and investor_id = $2' : '',
            'order by created_at desc',
            'limit 5',
        ].join(' '), input.investorId ? [input.threadId, input.investorId] : [input.threadId]),
    ]);
    const sandbox = sandboxResult.rows[0] || null;
    const activeRunId = typeof sandbox?.active_run_id === 'string' ? sandbox.active_run_id : '';
    const activeRun = activeRunId
        ? runsResult.rows.find((run) => run.id === activeRunId) || null
        : runsResult.rows.find((run) => run.status === 'RUNNING' || run.status === 'QUEUED') || null;
    const runIds = activeRunId
        ? [activeRunId]
        : runsResult.rows
            .map((run) => (typeof run.id === 'string' ? run.id : ''))
            .filter(Boolean)
            .slice(0, 3);
    let recentEvents = [];
    if (runIds.length > 0) {
        const placeholders = runIds.map((_, index) => `$${index + 1}`).join(', ');
        const eventLimit = Math.min(Math.max(input.recentEventLimit || 20, 1), 100);
        const eventsResult = await pool.query([
            'select id, run_id, type, payload, created_at',
            'from agent_context_run_events',
            `where run_id in (${placeholders})`,
            'order by created_at desc',
            `limit ${eventLimit}`,
        ].join(' '), runIds);
        recentEvents = eventsResult.rows.reverse();
    }
    return {
        thread: threadResult.rows[0] || null,
        sandbox,
        activeRun,
        recentRuns: runsResult.rows,
        recentEvents,
    };
}
export async function getAgentContextOpsUserUsage(config) {
    if (!config.contextDatabaseUrl)
        return [];
    const pool = await getRequiredContextPool(config);
    const result = await pool.query(`
    with usage_rows as (
      select
        investor_id,
        thread_id,
        octet_length(content) + coalesce(octet_length(metadata::text), 0) as bytes,
        1 as messages,
        0 as artifacts,
        0 as runs
      from agent_context_messages

      union all

      select
        investor_id,
        thread_id,
        coalesce(size_bytes, 0)
          + coalesce(octet_length(content_text), 0)
          + coalesce(octet_length(metadata::text), 0) as bytes,
        0 as messages,
        1 as artifacts,
        0 as runs
      from agent_context_artifacts

      union all

      select
        investor_id,
        thread_id,
        coalesce(octet_length(request::text), 0)
          + coalesce(octet_length(result::text), 0)
          + coalesce(octet_length(error), 0) as bytes,
        0 as messages,
        0 as artifacts,
        1 as runs
      from agent_context_runs

      union all

      select
        t.investor_id,
        s.thread_id,
        octet_length(s.summary) as bytes,
        0 as messages,
        0 as artifacts,
        0 as runs
      from agent_context_thread_summaries s
      join agent_context_threads t on t.thread_id = s.thread_id
    ),
    investor_users as (
      select investor_id, max(user_id) as user_id
      from agent_context_threads
      group by investor_id
    ),
    disk_usage as (
      select
        investor_id,
        max(user_id) as user_id,
        coalesce(sum(disk_bytes), 0) as disk_bytes
      from agent_context_sandbox_state
      group by investor_id
    )
    select
      coalesce(max(t.user_id), max(d.user_id), coalesce(u.investor_id, d.investor_id)) as user_id,
      coalesce(u.investor_id, d.investor_id) as investor_id,
      coalesce(max(d.disk_bytes), 0) as disk_bytes,
      coalesce(sum(u.bytes), 0) as rds_bytes,
      coalesce(sum(u.messages), 0) as messages,
      coalesce(sum(u.artifacts), 0) as artifacts,
      coalesce(sum(u.runs), 0) as runs,
      count(distinct u.thread_id) as threads
    from usage_rows u
    full outer join disk_usage d on d.investor_id = u.investor_id
    left join investor_users t on t.investor_id = coalesce(u.investor_id, d.investor_id)
    group by coalesce(u.investor_id, d.investor_id)
    order by disk_bytes desc, rds_bytes desc
    limit 200
  `);
    return result.rows.map((row) => ({
        userId: String(row.user_id || ''),
        investorId: String(row.investor_id || ''),
        diskBytes: readRowNumber(row.disk_bytes),
        rdsBytes: readRowNumber(row.rds_bytes),
        messages: readRowNumber(row.messages),
        artifacts: readRowNumber(row.artifacts),
        runs: readRowNumber(row.runs),
        threads: readRowNumber(row.threads),
    }));
}
export async function touchAgentRunHeartbeat(config, input) {
    if (!config.contextDatabaseUrl)
        return;
    const pool = await getContextPostgresPool(config.contextDatabaseUrl);
    await ensureAgentContextSchema(pool);
    await pool.query([
        'update agent_context_sandbox_state',
        'set last_heartbeat = now(), updated_at = now()',
        input.runId ? ', active_run_id = $2' : '',
        'where thread_id = $1',
    ].join(' '), input.runId ? [input.threadId, input.runId] : [input.threadId]);
    await pool.query('update agent_context_threads set last_active_at = now(), updated_at = now() where thread_id = $1', [input.threadId]);
    if (input.runId) {
        await pool.query('update agent_context_runs set worker_heartbeat_at = now(), updated_at = now() where id = $1 and status = $2', [input.runId, 'RUNNING']);
    }
}
export async function persistAgentTurnCancelled(config, input) {
    const pool = await getRequiredContextPool(config);
    await pool.query([
        'update agent_context_runs',
        'set status = $2, error = $3, execution_request = null, completed_at = now(), updated_at = now()',
        'where id = $1',
    ].join(' '), [input.runId, 'CANCELLED', input.reason || 'cancelled by user']);
    if (input.threadId) {
        await pool.query([
            'update agent_context_sandbox_state',
            'set status = $2, active_run_id = null, last_heartbeat = now(),',
            "metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb, updated_at = now()",
            'where thread_id = $1',
        ].join(' '), [
            input.threadId,
            'IDLE',
            stringifyJson({
                phase: 'cancelled',
                cancelledAt: new Date().toISOString(),
                cancelledRunId: input.runId,
                reason: input.reason || 'cancelled by user',
            }),
        ]);
        await pool.query([
            'update agent_context_threads',
            'set status = $2, last_active_at = now(),',
            "metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb, updated_at = now()",
            'where thread_id = $1',
        ].join(' '), [
            input.threadId,
            'IDLE',
            stringifyJson({
                cancelledRunId: input.runId,
                cancelledAt: new Date().toISOString(),
            }),
        ]);
    }
}
export async function persistAgentTurnTimeout(config, input) {
    const pool = await getRequiredContextPool(config);
    await pool.query([
        'update agent_context_runs',
        'set status = $2, error = $3, execution_request = null, completed_at = now(), updated_at = now()',
        'where id = $1',
    ].join(' '), [input.runId, 'TIMEOUT', input.reason || 'agent run timed out']);
    if (input.threadId) {
        await pool.query([
            'update agent_context_sandbox_state',
            'set status = $2, active_run_id = null, last_heartbeat = now(),',
            "metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb, updated_at = now()",
            'where thread_id = $1',
        ].join(' '), [
            input.threadId,
            'ERROR',
            stringifyJson({
                phase: 'timeout',
                timedOutAt: new Date().toISOString(),
                timeoutRunId: input.runId,
                reason: input.reason || 'agent run timed out',
            }),
        ]);
    }
}
export async function persistAgentRunEvent(config, input) {
    if (!config.contextDatabaseUrl)
        return;
    const pool = await getContextPostgresPool(config.contextDatabaseUrl);
    await ensureAgentContextSchema(pool);
    await persistAgentRunEvents(pool, input.runId, [input.event], { startIndex: input.index });
}
export async function persistAgentTurnSuccess(config, input, params) {
    const pool = await getRequiredContextPool(config);
    const assistantMessageId = id('msg');
    await pool.query([
        'insert into agent_context_messages',
        '(id, investor_id, thread_id, role, content, metadata)',
        'values ($1, $2, $3, $4, $5, $6::jsonb)',
    ].join(' '), [
        assistantMessageId,
        input.investorId,
        params.threadId,
        'ASSISTANT',
        params.reply,
        stringifyJson({ route: params.route, raw: params.raw ?? null, runId: input.runId }),
    ]);
    await pool.query([
        'insert into agent_context_tool_calls',
        '(id, investor_id, thread_id, run_id, message_id, tool_name, status, tool_args, tool_result)',
        'values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)',
    ].join(' '), [
        id('tool'),
        input.investorId,
        params.threadId,
        input.runId,
        assistantMessageId,
        'personal_agent_server.turn',
        params.reply.trim() ? 'SUCCESS' : 'UNKNOWN',
        stringifyJson({ messageId: input.userMessageId }),
        stringifyJson({
            route: params.route,
            eventCount: params.events.length,
            raw: params.raw ?? null,
        }),
    ]);
    await persistAgentRunEvents(pool, input.runId, params.events, { startIndex: 0 });
    await upsertThreadSummary(pool, params.threadId, input.currentUserMessage, params.reply);
    await pool.query([
        'update agent_context_runs',
        'set status = $2, route = $3, result = $4::jsonb, execution_request = null, completed_at = now(), updated_at = now()',
        'where id = $1',
    ].join(' '), [
        input.runId,
        'SUCCESS',
        params.route,
        stringifyJson({
            reply: params.reply,
            route: params.route,
            raw: params.raw ?? null,
            assistantMessageId,
        }),
    ]);
}
export async function persistAgentTurnError(config, input, params) {
    if (!input)
        return;
    const pool = await getRequiredContextPool(config);
    await pool.query([
        'update agent_context_runs',
        'set status = $2, error = $3, result = $4::jsonb, execution_request = null, completed_at = now(), updated_at = now()',
        'where id = $1',
    ].join(' '), [input.runId, 'ERROR', params.error, stringifyJson(params.result ?? null)]);
}
function rowToQueuedAgentTurn(row) {
    const runId = String(row.id || '');
    const request = storedTurnRequest(row.execution_request) || storedTurnRequest(row.request);
    if (!request)
        throw new Error(`Queued agent run ${runId || '(unknown)'} is missing an executable request`);
    const requestMetadata = isRecord(request.metadata) ? request.metadata : {};
    const currentUserMessage = typeof requestMetadata.currentUserMessage === 'string'
        ? requestMetadata.currentUserMessage
        : request.message;
    const userMessageId = typeof requestMetadata.currentMessageId === 'string' && requestMetadata.currentMessageId
        ? requestMetadata.currentMessageId
        : id('msg');
    return {
        persisted: {
            runId,
            userMessageId,
            investorId: String(row.investor_id || request.userId),
            currentUserMessage,
            warnings: [],
            status: 'RUNNING',
        },
        request: {
            ...request,
            metadata: {
                ...requestMetadata,
                runId,
            },
        },
        eventIndexStart: 2,
        model: typeof row.model === 'string' ? row.model : undefined,
        modelProvider: typeof row.model_provider === 'string' ? row.model_provider : undefined,
        attemptCount: readRowNumber(row.attempt_count),
    };
}
function rowToAgentContextArtifactRecord(row) {
    return {
        id: String(row.id || ''),
        investorId: String(row.investorId || row.investor_id || ''),
        threadId: String(row.threadId || row.thread_id || ''),
        runId: typeof row.runId === 'string'
            ? row.runId
            : typeof row.run_id === 'string'
                ? row.run_id
                : null,
        kind: String(row.kind || 'artifact'),
        name: String(row.name || 'artifact'),
        mimeType: typeof row.mimeType === 'string'
            ? row.mimeType
            : typeof row.mime_type === 'string'
                ? row.mime_type
                : null,
        sizeBytes: readNullableRowNumber(row.sizeBytes ?? row.size_bytes),
        contentText: typeof row.contentText === 'string'
            ? row.contentText
            : typeof row.content_text === 'string'
                ? row.content_text
                : null,
        metadata: isRecord(row.metadata) ? row.metadata : {},
        createdAt: rowDateIso(row.createdAt ?? row.created_at),
        updatedAt: rowDateIso(row.updatedAt ?? row.updated_at),
    };
}
async function getContextPostgresPool(connectionString) {
    if (sharedContextPool && sharedContextUrl === connectionString)
        return sharedContextPool;
    let pg;
    try {
        pg = (await import('pg'));
    }
    catch (error) {
        throw new Error(`Context DB requires the "pg" package: ${error instanceof Error ? error.message : String(error)}`);
    }
    sharedContextUrl = connectionString;
    sharedContextPool = new pg.Pool({ connectionString });
    return sharedContextPool;
}
async function getRequiredContextPool(config) {
    if (!config.contextDatabaseUrl) {
        throw new Error('AGENT_CONTEXT_DATABASE_URL is required for agent context persistence');
    }
    const pool = await getContextPostgresPool(config.contextDatabaseUrl);
    await ensureAgentContextSchema(pool);
    return pool;
}
let schemaReady = null;
async function ensureAgentContextSchema(pool) {
    if (!schemaReady)
        schemaReady = createAgentContextSchema(pool);
    return schemaReady;
}
async function createAgentContextSchema(pool) {
    await pool.query(`
    create table if not exists agent_context_threads (
      thread_id text primary key,
      user_id text not null,
      investor_id text not null,
      status text not null default 'IDLE',
      sandbox_path text,
      active_session_id text,
      last_active_at timestamptz,
      metadata jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
    await pool.query('create index if not exists agent_context_threads_user_active_idx on agent_context_threads(user_id, status, last_active_at desc)');
    await pool.query('create index if not exists agent_context_threads_investor_active_idx on agent_context_threads(investor_id, status, last_active_at desc)');
    await pool.query(`
    create table if not exists agent_context_sandbox_state (
      thread_id text primary key,
      user_id text not null,
      investor_id text not null,
      status text not null default 'IDLE',
      sandbox_path text,
      user_root text,
      thread_root text,
      hermes_home text,
      codex_home text,
      workspace text,
      active_run_id text,
      active_session_id text,
      pid integer,
      container_id text,
      last_heartbeat timestamptz,
      disk_bytes bigint,
      metadata jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
    await pool.query('create index if not exists agent_context_sandbox_state_user_status_idx on agent_context_sandbox_state(user_id, status, updated_at desc)');
    await pool.query('create index if not exists agent_context_sandbox_state_disk_idx on agent_context_sandbox_state(disk_bytes desc)');
    await pool.query(`
    create table if not exists agent_context_messages (
      id text primary key,
      investor_id text not null,
      thread_id text not null,
      role text not null,
      content text not null,
      metadata jsonb,
      created_at timestamptz not null default now()
    )
  `);
    await pool.query('create index if not exists agent_context_messages_thread_created_idx on agent_context_messages(thread_id, created_at, id)');
    await pool.query(`
	    create table if not exists agent_context_runs (
	      id text primary key,
	      investor_id text not null,
	      thread_id text not null,
	      status text not null default 'RUNNING',
	      route text,
	      request jsonb,
	      execution_request jsonb,
	      result jsonb,
	      error text,
	      queued_at timestamptz,
	      started_at timestamptz,
	      completed_at timestamptz,
	      worker_id text,
	      worker_heartbeat_at timestamptz,
	      attempt_count integer not null default 0,
	      next_attempt_at timestamptz,
	      timeout_at timestamptz,
	      cancel_requested boolean not null default false,
	      model_provider text,
	      model text,
	      created_at timestamptz not null default now(),
	      updated_at timestamptz not null default now()
	    )
	  `);
    await pool.query('alter table agent_context_runs add column if not exists execution_request jsonb');
    await pool.query('alter table agent_context_runs add column if not exists queued_at timestamptz');
    await pool.query('alter table agent_context_runs add column if not exists worker_id text');
    await pool.query('alter table agent_context_runs add column if not exists worker_heartbeat_at timestamptz');
    await pool.query('alter table agent_context_runs add column if not exists attempt_count integer not null default 0');
    await pool.query('alter table agent_context_runs add column if not exists next_attempt_at timestamptz');
    await pool.query('alter table agent_context_runs add column if not exists timeout_at timestamptz');
    await pool.query('alter table agent_context_runs add column if not exists cancel_requested boolean not null default false');
    await pool.query('alter table agent_context_runs add column if not exists model_provider text');
    await pool.query('alter table agent_context_runs add column if not exists model text');
    await pool.query('create index if not exists agent_context_runs_thread_created_idx on agent_context_runs(thread_id, created_at)');
    await pool.query('create index if not exists agent_context_runs_investor_status_updated_idx on agent_context_runs(investor_id, status, updated_at)');
    await pool.query('create index if not exists agent_context_runs_queue_idx on agent_context_runs(status, next_attempt_at, created_at, id)');
    await pool.query('create index if not exists agent_context_runs_worker_heartbeat_idx on agent_context_runs(status, worker_heartbeat_at, timeout_at)');
    await pool.query('create index if not exists agent_context_runs_provider_status_idx on agent_context_runs(model_provider, status, updated_at)');
    await pool.query(`
    create table if not exists agent_context_run_events (
      id text primary key,
      run_id text not null,
      type text not null,
      payload jsonb,
      created_at timestamptz not null default now()
    )
  `);
    await pool.query('create index if not exists agent_context_run_events_run_created_idx on agent_context_run_events(run_id, created_at)');
    await pool.query(`
    create table if not exists agent_context_thread_summaries (
      thread_id text primary key,
      summary text not null,
      source text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
    await pool.query('create index if not exists agent_context_thread_summaries_updated_idx on agent_context_thread_summaries(updated_at)');
    await pool.query(`
    create table if not exists agent_context_artifacts (
      id text primary key,
      investor_id text not null,
      thread_id text not null,
      run_id text,
      kind text not null,
      name text not null,
      mime_type text,
      size_bytes integer,
      content_text text,
      metadata jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
    await pool.query('create index if not exists agent_context_artifacts_thread_created_idx on agent_context_artifacts(thread_id, created_at)');
    await pool.query('create index if not exists agent_context_artifacts_investor_kind_created_idx on agent_context_artifacts(investor_id, kind, created_at)');
    await pool.query(`
    create table if not exists agent_context_tool_calls (
      id text primary key,
      investor_id text not null,
      thread_id text not null,
      run_id text,
      message_id text,
      tool_name text not null,
      status text not null default 'SUCCESS',
      tool_args jsonb,
      tool_result jsonb,
      created_at timestamptz not null default now()
    )
  `);
    await pool.query('create index if not exists agent_context_tool_calls_thread_created_idx on agent_context_tool_calls(thread_id, created_at)');
    await pool.query('create index if not exists agent_context_tool_calls_run_created_idx on agent_context_tool_calls(run_id, created_at)');
}
async function persistAgentRunEvents(pool, runId, events, options = {}) {
    const startIndex = typeof options.startIndex === 'number' && Number.isFinite(options.startIndex)
        ? Math.max(0, Math.floor(options.startIndex))
        : null;
    for (const [offset, event] of events.slice(0, 200).entries()) {
        const eventId = startIndex === null ? id('evt') : `${runId}:evt:${startIndex + offset}`;
        await pool.query([
            'insert into agent_context_run_events (id, run_id, type, payload, created_at)',
            'values ($1, $2, $3, $4::jsonb, $5::timestamptz)',
            'on conflict (id) do nothing',
        ].join(' '), [
            eventId,
            runId,
            event.type,
            stringifyJson({
                timestamp: event.timestamp,
                payload: event.payload,
            }),
            event.timestamp || new Date().toISOString(),
        ]);
    }
}
async function upsertThreadSummary(pool, threadId, userMessage, assistantReply) {
    const existing = await pool.query('select summary from agent_context_thread_summaries where thread_id = $1 limit 1', [threadId]);
    const previous = typeof existing.rows[0]?.summary === 'string' ? existing.rows[0].summary : '';
    const nextSummary = compactThreadSummary(previous, userMessage, assistantReply);
    await pool.query([
        'insert into agent_context_thread_summaries (thread_id, summary, source)',
        'values ($1, $2, $3)',
        'on conflict (thread_id) do update set summary = excluded.summary, source = excluded.source, updated_at = now()',
    ].join(' '), [threadId, nextSummary, 'heuristic_latest_turns']);
}
function currentUserMessage(request) {
    const value = request.metadata?.currentUserMessage;
    return typeof value === 'string' && value.trim() ? value.trim() : request.message;
}
function metadataString(request, key) {
    const value = request.metadata?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}
function requestMetadataForStorage(metadata) {
    if (!metadata)
        return null;
    const copy = { ...metadata };
    const parsedAttachment = isRecord(copy.parsedAttachment) ? { ...copy.parsedAttachment } : null;
    if (parsedAttachment && typeof parsedAttachment.contentText === 'string') {
        parsedAttachment.contentText = `[stored as artifact: ${parsedAttachment.contentText.length} chars]`;
        copy.parsedAttachment = parsedAttachment;
    }
    if (Array.isArray(copy.multimodalAttachments)) {
        copy.multimodalAttachments = copy.multimodalAttachments.map((item) => {
            if (!isRecord(item))
                return item;
            return {
                ...item,
                dataUrl: typeof item.dataUrl === 'string' ? `[omitted dataUrl: ${item.dataUrl.length} chars]` : item.dataUrl,
            };
        });
    }
    if (Array.isArray(copy.workspaceAttachments)) {
        copy.workspaceAttachments = copy.workspaceAttachments.map((item) => {
            if (!isRecord(item))
                return item;
            return {
                ...item,
                dataUrl: typeof item.dataUrl === 'string' ? `[omitted dataUrl: ${item.dataUrl.length} chars]` : item.dataUrl,
            };
        });
    }
    return copy;
}
function requestForExecutionStorage(request) {
    return {
        userId: request.userId,
        threadId: request.threadId || null,
        message: request.message,
        allowedAgents: request.allowedAgents || null,
        metadata: request.metadata || null,
    };
}
function storedTurnRequest(value) {
    if (!isRecord(value))
        return null;
    const userId = typeof value.userId === 'string' ? value.userId : '';
    const message = typeof value.message === 'string' ? value.message : '';
    if (!userId || !message)
        return null;
    return {
        userId,
        threadId: typeof value.threadId === 'string' ? value.threadId : undefined,
        message,
        allowedAgents: Array.isArray(value.allowedAgents) ? value.allowedAgents.map(String) : undefined,
        metadata: isRecord(value.metadata) ? value.metadata : undefined,
    };
}
function resolveRunModelSelection(config, request) {
    const selection = resolveHermesModelSelection(config, request.metadata?.hermesModel);
    return {
        model: selection.model,
        provider: selection.provider,
    };
}
function stringifyJson(value) {
    return JSON.stringify(value === undefined ? null : value);
}
function compactThreadSummary(previous, userMessage, assistantReply) {
    const block = [
        previous.trim(),
        [
            `User: ${truncate(userMessage, 1200)}`,
            `Assistant: ${truncate(assistantReply, 1600)}`,
        ].join('\n'),
    ].filter(Boolean).join('\n\n');
    return truncate(block, 8000);
}
function emptyContext(message, warnings) {
    return {
        message,
        artifactContext: '',
        loaded: false,
        summaryChars: 0,
        messageCount: 0,
        artifactCount: 0,
        warnings,
    };
}
function buildArtifactContextMessage(input) {
    const artifactText = input.artifacts.map(formatArtifactRow).filter(Boolean).join('\n\n');
    if (!artifactText)
        return '';
    return [
        '<artifacts>',
        'Artifacts are stored in the thread workspace. Use names and summaries as context. If full extracted text is needed, call altselfs_read_artifact with parsed_text_path; if parsed_text_path is missing, use workspace_path. If the read fails, explain the limitation.',
        artifactText,
        '</artifacts>',
    ].join('\n');
}
function formatArtifactRow(row) {
    const id = typeof row.id === 'string' ? row.id : '';
    const kind = typeof row.kind === 'string' ? row.kind : 'artifact';
    const name = typeof row.name === 'string' ? row.name : 'untitled';
    const content = typeof row.contentText === 'string' ? row.contentText.trim() : '';
    const metadata = isRecord(row.metadata) ? row.metadata : {};
    const metadataText = Object.keys(metadata).length > 0 ? ` metadata=${JSON.stringify(metadata).slice(0, 2000)}` : '';
    const mimeType = typeof row.mimeType === 'string' ? row.mimeType : '';
    const sizeBytes = typeof row.sizeBytes === 'number' ? row.sizeBytes : null;
    const workspacePath = typeof metadata.workspacePath === 'string' ? metadata.workspacePath : '';
    const relativePath = typeof metadata.relativePath === 'string' ? metadata.relativePath : '';
    const parsedTextPath = typeof metadata.parsedTextPath === 'string' ? metadata.parsedTextPath : '';
    const indexLines = [
        workspacePath ? `workspace_path: ${workspacePath}` : '',
        relativePath ? `relative_path: ${relativePath}` : '',
        parsedTextPath ? `parsed_text_path: ${parsedTextPath}` : '',
        mimeType ? `mime_type: ${mimeType}` : '',
        sizeBytes ? `size_bytes: ${sizeBytes}` : '',
        content && metadata.inlineInContext === true
            ? `inline_content:\n${truncate(content, 6000)}`
            : content
                ? `legacy_content: stored in RDS (${content.length} chars), not inlined in this prompt`
                : '',
    ].filter(Boolean);
    if (indexLines.length === 0)
        return '';
    return [
        `<artifact id="${escapeAttr(id)}" kind="${escapeAttr(kind)}" name="${escapeAttr(name)}"${metadataText}>`,
        indexLines.join('\n'),
        '</artifact>',
    ].join('\n');
}
function escapeAttr(value) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function readRowNumber(value) {
    if (typeof value === 'bigint')
        return Number(value);
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    }
    return 0;
}
function readNullableRowNumber(value) {
    if (value === null || value === undefined)
        return null;
    return readRowNumber(value);
}
function rowDateIso(value) {
    if (value instanceof Date)
        return value.toISOString();
    return typeof value === 'string' ? value : null;
}
