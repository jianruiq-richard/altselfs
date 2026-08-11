import type { ServerConfig } from './config.js';
import { externalFetch } from './outbound-fetch.js';
import { isRecord } from './util.js';

export type Ga4ClientContext = {
  clientId: string | null;
  sessionId: string | null;
  analyticsConsent: 'granted' | 'denied';
};

type Ga4EventParams = Record<string, unknown>;

export function normalizeGa4ClientContext(value: unknown): Ga4ClientContext {
  const record = isRecord(value) ? value : {};
  return {
    clientId: safeAnalyticsId(record.clientId),
    sessionId: safeAnalyticsId(record.sessionId),
    analyticsConsent: record.analyticsConsent === 'granted' ? 'granted' : 'denied',
  };
}

export function ga4ContextMetadata(context: Ga4ClientContext) {
  return {
    ...(context.clientId ? { gaClientId: context.clientId } : {}),
    ...(context.sessionId ? { gaSessionId: context.sessionId } : {}),
    gaAnalyticsConsent: context.analyticsConsent,
  };
}

export function ga4ContextFromMetadata(value: unknown): Ga4ClientContext {
  const record = isRecord(value) ? value : {};
  return normalizeGa4ClientContext({
    clientId: record.gaClientId,
    sessionId: record.gaSessionId,
    analyticsConsent: record.gaAnalyticsConsent,
  });
}

export async function sendGa4Event(
  config: ServerConfig,
  input: {
    name: string;
    userId: string;
    context: Ga4ClientContext;
    params: Ga4EventParams;
    includeSession?: boolean;
  },
) {
  if (
    !config.ga4MeasurementId ||
    !config.ga4ApiSecret ||
    !input.context.clientId ||
    input.context.analyticsConsent !== 'granted'
  ) {
    return { sent: false, reason: 'not_configured_or_not_consented' } as const;
  }

  const endpoint = new URL('https://www.google-analytics.com/mp/collect');
  endpoint.searchParams.set('measurement_id', config.ga4MeasurementId);
  endpoint.searchParams.set('api_secret', config.ga4ApiSecret);

  try {
    const response = await externalFetch(config, endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: input.context.clientId,
        user_id: input.userId,
        timestamp_micros: Date.now() * 1_000,
        non_personalized_ads: true,
        events: [{
          name: input.name,
          params: {
            schema_version: 1,
            engagement_time_msec: 1,
            ...(input.includeSession && input.context.sessionId
              ? { session_id: input.context.sessionId }
              : {}),
            ...input.params,
          },
        }],
      }),
      signal: AbortSignal.timeout(5_000),
    }, { networkPolicy: 'proxy' });
    if (!response.ok) {
      console.warn(`[ga4] ${input.name} returned HTTP ${response.status}`);
      return { sent: false, reason: `http_${response.status}` } as const;
    }
    return { sent: true } as const;
  } catch (error) {
    console.warn(`[ga4] ${input.name} delivery failed: ${error instanceof Error ? error.message : String(error)}`);
    return { sent: false, reason: 'request_failed' } as const;
  }
}

function safeAnalyticsId(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[a-zA-Z0-9._-]{1,160}$/.test(normalized) ? normalized : null;
}
