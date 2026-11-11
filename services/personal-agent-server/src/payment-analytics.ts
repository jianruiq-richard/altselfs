import { randomUUID } from 'node:crypto';
import type { ServerConfig } from './config.js';
import { getBillingPool } from './billing-database.js';
import { normalizeGa4ClientContext, sendGa4Event } from './google-analytics.js';

type Db = { query: (sql: string, values?: unknown[]) => Promise<{rows: Record<string, any>[]}> };
type Event = Parameters<typeof sendGa4Event>[1];

// Prefer the current browser. Account fallback never revives an old session ID,
// and never overrides an explicit consent denial from this browser.
export function paymentContext(current: unknown, saved: Record<string, any> | undefined, now = Date.now()) {
  const context = normalizeGa4ClientContext(current);
  if (context.analyticsConsent !== 'granted') return context;
  const touch = saved?.last_touch;
  const touchClient = normalizeGa4ClientContext({clientId:touch?.clientId}).clientId;
  if (context.adUserDataConsent === 'granted' && saved?.analytics_context?.adUserDataConsent === 'granted'
    && touchClient && Number(touch.at) <= now && now - Number(touch.at) < 60 * 86400000
    && touchClient !== context.clientId) {
    // This client was captured when the campaign was bound to this account.
    // Do not replace its advertising identity with a later direct-visit cookie.
    return {...context,clientId:touchClient,sessionId:null};
  }
  if (context.clientId) return context;
  if (!saved || now - new Date(saved.context_updated_at).getTime() > 60 * 86400000) return context;
  const previous = normalizeGa4ClientContext(saved.analytics_context);
  if (previous.analyticsConsent !== 'granted') return context;
  return {...context, clientId: previous.clientId, sessionId: null};
}

export async function resolvePaymentContext(config: ServerConfig, userId: string, current: unknown) {
  const pool = getBillingPool(config);
  if (!pool) return normalizeGa4ClientContext(current);
  const result = await pool.query('select analytics_context, context_updated_at, last_touch from account_attribution where user_id = $1', [userId]);
  return paymentContext(current, result.rows[0]);
}

// Must be called inside the SAME transaction as the corresponding payment.
export async function enqueuePaymentAnalytics(db: Db, eventId: string, input: Event) {
  const context = normalizeGa4ClientContext(input.context);
  const eligible = context.analyticsConsent === 'granted' && Boolean(context.clientId);
  await db.query(`insert into conversion_analytics_outbox
    (event_id, user_id, event_name, context, params, attribution, include_session, occurred_at, delivery_status, last_error)
    values ($1,$2,$3,$4::jsonb,$5::jsonb,
      (select jsonb_build_object('first', first_touch, 'last', last_touch) from account_attribution
        where user_id = $2 and analytics_context->>'adUserDataConsent' = 'granted'),
      $6, to_timestamp($7::double precision / 1000000), $8, $9)
    on conflict (event_id) do nothing`, [eventId, input.userId, input.name,
      JSON.stringify(context), JSON.stringify(input.params), Boolean(input.includeSession),
      input.timestampMicros ?? Date.now() * 1000, eligible ? 'PENDING' : context.analyticsConsent === 'granted' ? 'WAITING_CONTEXT' : 'SKIPPED',
      eligible ? null : context.analyticsConsent !== 'granted' ? 'analytics_consent_denied' : 'missing_client_id']);
}

export async function deliverPaymentAnalytics(config: ServerConfig, db: Db, send = sendGa4Event) {
  // Expire even when configuration is missing: retain a visible audit record,
  // rather than changing old purchase timestamps to make them appear recent.
  await db.query(`update conversion_analytics_outbox set delivery_status = 'EXPIRED', last_error = 'event_older_than_70_hours'
    where delivery_status in ('PENDING','WAITING_CONTEXT') and occurred_at < now() - interval '70 hours'
      and (lease_until is null or lease_until < now())`);
  // Login/attribution binding may complete after the desktop reports readiness.
  // Wait durably for that context, without manufacturing a GA client identity.
  await db.query(`update conversion_analytics_outbox p set
    context = a.analytics_context || jsonb_build_object('sessionId', null, 'clientId',
      case when a.analytics_context->>'adUserDataConsent'='granted'
        and a.last_touch->>'clientId' ~ '^[a-zA-Z0-9._-]{1,160}$'
        and (a.last_touch->>'at')::numeric > extract(epoch from now()-interval '60 days')*1000
      then a.last_touch->>'clientId' else a.analytics_context->>'clientId' end),
    attribution = case when a.analytics_context->>'adUserDataConsent' = 'granted'
      then jsonb_build_object('first',a.first_touch,'last',a.last_touch) else null end,
    delivery_status = case when a.analytics_context->>'analyticsConsent' = 'denied' then 'SKIPPED' else 'PENDING' end,
    last_error = case when a.analytics_context->>'analyticsConsent' = 'denied' then 'analytics_consent_denied' else null end
    from account_attribution a where p.user_id=a.user_id and p.delivery_status='WAITING_CONTEXT'
      and a.context_updated_at > now() - interval '60 days'
      and (a.analytics_context->>'analyticsConsent' = 'denied' or a.analytics_context->>'clientId' ~ '^[a-zA-Z0-9._-]{1,160}$')`);
  if (!config.ga4MeasurementId || !config.ga4ApiSecret) return;
  const token = randomUUID();
  const claimed = await db.query(`with batch as (
    select event_id from conversion_analytics_outbox where delivery_status = 'PENDING' and available_at <= now()
      and (lease_until is null or lease_until < now()) order by available_at limit 10 for update skip locked
    ) update conversion_analytics_outbox p set lease_token=$1, lease_until=now()+interval '2 minutes', attempts=attempts+1
      from batch b where p.event_id=b.event_id returning p.*`, [token]);
  for (const row of claimed.rows) {
    // Honour a later account consent withdrawal, including already queued events.
    const account = await db.query('select analytics_context from account_attribution where user_id=$1', [row.user_id]);
    const latest = account.rows[0]?.analytics_context;
    const context = normalizeGa4ClientContext(row.context);
    if (latest?.analyticsConsent === 'denied') context.analyticsConsent = 'denied';
    if (latest?.adUserDataConsent === 'denied') context.adUserDataConsent = 'denied';
    let result: Awaited<ReturnType<typeof sendGa4Event>>;
    if (context.analyticsConsent !== 'granted') {
      result = {sent:false, reason:'not_configured_or_not_consented'};
    } else {
      try {
        // GA4 session attribution only accepts events within the session window.
        const sessionStart = Number(context.sessionId) * 1000;
        const includeSession = Boolean(row.include_session) && Number.isFinite(sessionStart) && sessionStart > 0 && Date.now() - sessionStart < 23 * 3600000;
        result = await send(config, {name:row.event_name, userId:row.user_id, context,
          params:row.params, includeSession, timestampMicros:new Date(row.occurred_at).getTime()*1000});
      } catch { result = {sent:false, reason:'request_failed'}; }
    }
    const status = result.sent ? 'SENT' : result.reason === 'not_configured_or_not_consented' ? 'SKIPPED' : 'PENDING';
    const delay = Math.min(3600, 15 * 2 ** Math.min(8, Number(row.attempts)-1));
    await db.query(`update conversion_analytics_outbox set delivery_status=$3, lease_token=null, lease_until=null,
      last_error=$4, available_at=now()+($5*interval '1 second'), delivered_at=case when $3='SENT' then now() else null end,
      attribution=case when $6 then attribution else null end
      where event_id=$1 and lease_token=$2`, [row.event_id, token, status, result.sent ? null : result.reason, delay, context.adUserDataConsent === 'granted']);
  }
}

export async function processPaymentAnalyticsOutbox(config: ServerConfig) {
  const pool = getBillingPool(config);
  if (pool) await deliverPaymentAnalytics(config, pool);
}
