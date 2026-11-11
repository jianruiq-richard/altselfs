export const ATTRIBUTION_MAX_AGE_MS = 90 * 86_400_000;
const fields = ['gclid','gbraid','wbraid','utm_source','utm_medium','utm_campaign','utm_id','utm_term','utm_content','utm_source_platform','utm_creative_format','utm_marketing_tactic'] as const;

export function normalizeTouch(value: unknown, now = Date.now()) {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const at = Number(input.at);
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > ATTRIBUTION_MAX_AGE_MS) return null;
  const touch: Record<string, string | number> = { at };
  for (const key of fields) {
    const raw = input[key];
    if (typeof raw === 'string' && raw.length > 0 && raw.length <= 200 && !/[<>\x00-\x1f]/.test(raw)) touch[key] = raw;
  }
  return Object.keys(touch).length > 1 ? touch : null;
}

export function normalizeAccountAnalytics(value: unknown) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const analytics = input.analytics && typeof input.analytics === 'object' ? input.analytics as Record<string, unknown> : {};
  const granted = analytics.analyticsConsent === 'granted';
  const ads = granted && analytics.adUserDataConsent === 'granted';
  const safeId = (v: unknown) => granted && typeof v === 'string' && /^[a-zA-Z0-9._-]{1,160}$/.test(v) ? v : null;
  const source = ads && input.attribution && typeof input.attribution === 'object' ? input.attribution as Record<string, unknown> : {};
  const clientId = safeId(analytics.clientId);
  const withClient = (touch: ReturnType<typeof normalizeTouch>) => touch && clientId ? {...touch, clientId} : touch;
  return {
    context: {clientId: safeId(analytics.clientId), sessionId: safeId(analytics.sessionId), analyticsConsent: granted ? 'granted' : 'denied', adUserDataConsent: ads ? 'granted' : 'denied'},
    first: withClient(normalizeTouch(source.first)), last: withClient(normalizeTouch(source.last)), ads,
  };
}

// Caller derives userId exclusively from the authenticated server session.
export async function saveAccountAnalytics(db: { $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown> }, userId: string, value: unknown) {
  const data = normalizeAccountAnalytics(value);
  await db.$executeRawUnsafe(`
    insert into account_attribution (user_id, first_touch, last_touch, analytics_context)
    values ($1, $2::jsonb, $3::jsonb, $4::jsonb)
    on conflict (user_id) do update set
      first_touch = case when not $5 then null
        when account_attribution.first_touch is null or (account_attribution.first_touch->>'at')::numeric < extract(epoch from now() - interval '90 days') * 1000 then excluded.first_touch
        when account_attribution.first_touch->>'at' = excluded.first_touch->>'at'
          and account_attribution.first_touch->>'clientId' is null then excluded.first_touch
        else account_attribution.first_touch end,
      last_touch = case when not $5 then null
        when excluded.last_touch is null then case when (account_attribution.last_touch->>'at')::numeric >= extract(epoch from now() - interval '90 days') * 1000 then account_attribution.last_touch else null end
        when account_attribution.last_touch is null or (excluded.last_touch->>'at')::numeric > (account_attribution.last_touch->>'at')::numeric then excluded.last_touch
        when account_attribution.last_touch->>'at' = excluded.last_touch->>'at'
          and account_attribution.last_touch->>'clientId' is null then excluded.last_touch
        else account_attribution.last_touch end,
      analytics_context = case when excluded.analytics_context->>'analyticsConsent' = 'granted'
        and excluded.analytics_context->>'clientId' is null
        and account_attribution.analytics_context->>'analyticsConsent' = 'granted'
        and account_attribution.context_updated_at > now() - interval '60 days'
        then account_attribution.analytics_context || jsonb_build_object('sessionId', null, 'adUserDataConsent', excluded.analytics_context->>'adUserDataConsent')
        else excluded.analytics_context end,
      context_updated_at = case when excluded.analytics_context->>'clientId' is null
        then account_attribution.context_updated_at else now() end,
      updated_at = now()
  `, userId, data.first ? JSON.stringify(data.first) : null, data.last ? JSON.stringify(data.last) : null, JSON.stringify(data.context), data.ads);
}
