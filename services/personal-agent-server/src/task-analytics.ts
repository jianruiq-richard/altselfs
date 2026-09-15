import { randomUUID, createHash } from 'node:crypto';
import type { ServerConfig } from './config.js';
import { normalizeGa4ClientContext, sendGa4Event } from './google-analytics.js';

type AnalyticsPool = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

export type TaskMilestone = 'first_task_submitted' | 'first_task_completed';

export const TASK_ANALYTICS_SCHEMA = `
  create table if not exists agent_task_milestones (
    investor_id text not null,
    event_name text not null,
    run_id text not null,
    created_at timestamptz not null default now(),
    primary key (investor_id, event_name)
  );
  alter table agent_task_milestones
    add column if not exists delivery_status text not null default 'LEGACY',
    add column if not exists context jsonb,
    add column if not exists occurred_at timestamptz,
    add column if not exists available_at timestamptz not null default now(),
    add column if not exists lease_until timestamptz,
    add column if not exists lease_token text,
    add column if not exists attempts integer not null default 0,
    add column if not exists last_error text,
    add column if not exists delivered_at timestamptz;
  create index if not exists agent_task_milestones_pending_idx
    on agent_task_milestones (available_at) where delivery_status = 'PENDING';
`;

// Uniqueness and historical checks work across browsers, threads and workers.
// Claiming only writes to PostgreSQL; Google requests never delay task acceptance.
export async function trackTaskMilestone(
  _config: ServerConfig,
  pool: AnalyticsPool,
  runId: string,
  event: TaskMilestone,
) {
  const completed = event === 'first_task_completed';
  const eligible = completed
    ? "r.status = 'SUCCESS'"
    : "(r.queued_at is not null or r.started_at is not null)";
  const previous = completed
    ? "p.status = 'SUCCESS' and (p.completed_at, p.id) < (r.completed_at, r.id)"
    : "(p.queued_at is not null or p.started_at is not null) and (p.created_at, p.id) < (r.created_at, r.id)";
  try {
    await pool.query(`
      insert into agent_task_milestones
        (investor_id, event_name, run_id, context, occurred_at, delivery_status)
      select r.investor_id, $2, r.id,
        jsonb_build_object(
          'clientId', r.request #>> '{metadata,analytics,clientId}',
          'sessionId', r.request #>> '{metadata,analytics,sessionId}',
          'analyticsConsent', r.request #>> '{metadata,analytics,analyticsConsent}',
          'adUserDataConsent', r.request #>> '{metadata,analytics,adUserDataConsent}'
        ),
        ${completed ? 'r.completed_at' : 'coalesce(r.queued_at, r.started_at, r.created_at)'},
        case when r.request #>> '{metadata,analytics,analyticsConsent}' = 'granted'
          and (r.request #>> '{metadata,analytics,clientId}') ~ '^[a-zA-Z0-9._-]{1,160}$'
          then 'PENDING' else 'SKIPPED' end
      from agent_context_runs r
      where r.id = $1 and ${eligible}
        and not exists (
          select 1 from agent_context_runs p
          where p.investor_id = r.investor_id and p.id <> r.id and ${previous}
        )
      on conflict (investor_id, event_name) do nothing
    `, [runId, event]);
  } catch (error) {
    console.warn(`[ga4] ${event} enqueue failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function deliverTaskMilestones(
  config: ServerConfig,
  pool: AnalyticsPool,
  send = sendGa4Event,
) {
  if (!config.ga4MeasurementId || !config.ga4ApiSecret) return;
  // Keep the original event timestamp and stop before GA4's 72-hour limit.
  await pool.query(`update agent_task_milestones
    set delivery_status = 'EXPIRED', last_error = 'event_older_than_70_hours'
    where delivery_status = 'PENDING' and occurred_at < now() - interval '70 hours'
      and (lease_until is null or lease_until < now())`);
  const leaseToken = randomUUID();
  const claimed = await pool.query(`
    with batch as (
      select investor_id, event_name from agent_task_milestones
      where delivery_status = 'PENDING' and available_at <= now()
        and (lease_until is null or lease_until < now())
      order by available_at limit 10 for update skip locked
    )
    update agent_task_milestones m
    set lease_token = $1, lease_until = now() + interval '2 minutes', attempts = attempts + 1
    from batch b where m.investor_id = b.investor_id and m.event_name = b.event_name
    returning m.*
  `, [leaseToken]);
  for (const row of claimed.rows) {
    const eventId = createHash('sha256').update(`${row.investor_id}:${row.event_name}`).digest('hex');
    let result: Awaited<ReturnType<typeof sendGa4Event>>;
    try {
      result = await send(config, {
        name: String(row.event_name),
        userId: String(row.investor_id),
        context: normalizeGa4ClientContext(row.context),
        includeSession: true,
        timestampMicros: new Date(String(row.occurred_at)).getTime() * 1_000,
        params: { task_type: 'personal_agent', event_id: eventId },
      });
    } catch {
      result = { sent: false, reason: 'request_failed' };
    }
    const skipped = !result.sent && result.reason === 'not_configured_or_not_consented';
    const status = result.sent ? 'SENT' : skipped ? 'SKIPPED' : 'PENDING';
    const delaySeconds = Math.min(3600, 15 * 2 ** Math.min(8, Number(row.attempts) - 1));
    await pool.query(`update agent_task_milestones
      set delivery_status = $4, lease_token = null, lease_until = null,
        last_error = $5, available_at = now() + ($6 * interval '1 second'),
        delivered_at = case when $4 = 'SENT' then now() else null end
      where investor_id = $1 and event_name = $2 and lease_token = $3`,
    [row.investor_id, row.event_name, leaseToken, status, result.sent ? null : result.reason, delaySeconds]);
  }
}
