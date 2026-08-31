import type { ServerConfig } from '../config.js';
import { isRecord } from '../util.js';

export const SEMRUSH_PAYMENT_DESTINATIONS_TOOL_NAME = 'altselfs_semrush_payment_destinations';

export function createSemrushTrafficDynamictool() {
  return {
    namespace: null,
    name: SEMRUSH_PAYMENT_DESTINATIONS_TOOL_NAME,
    description:
      'Read Semrush Traffic & Market > Sources & Destinations > Destinations for one target domain. Returns each of the last six completed calendar months plus rolling six-, three-, and one-month totals of absolute outbound visits to registered payment-platform domains. Speed mode scans only the first destination-table page per month, so later-page payment destinations are omitted. The browser worker requires an active authorized Semrush web session, processes one domain at a time, permits at most three waiting requests, and rejects comparison groups containing non-target sites.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Target website hostname or URL, for example tapnow.ai.',
        },
        months: {
          type: 'integer',
          enum: [6],
          description: 'Fixed at six completed calendar months.',
        },
        paymentDomains: {
          type: 'array',
          maxItems: 50,
          items: { type: 'string' },
          description: 'Optional additional payment-platform root domains to classify.',
        },
      },
      required: ['domain'],
      additionalProperties: false,
    },
    deferLoading: false,
  };
}

export function isSemrushTraffictool(toolName: string) {
  return toolName === SEMRUSH_PAYMENT_DESTINATIONS_TOOL_NAME;
}

export async function runSemrushTraffictool(argumentsValue: unknown, config: ServerConfig) {
  const args = isRecord(argumentsValue) ? argumentsValue : {};
  const domain = typeof args.domain === 'string' ? args.domain.trim() : '';
  if (!domain) return JSON.stringify({ source: 'semrush-browser-ui', error: 'domain is required' });
  if (!config.semrushTrafficToolEnabled) {
    return JSON.stringify({ source: 'semrush-browser-ui', error: 'Semrush traffic browser tool is disabled' });
  }

  const endpoint = new URL('/v1/payment-destinations', ensureTrailingSlash(config.semrushTrafficServiceUrl));
  const token = process.env[config.semrushTrafficServiceTokenEnv]?.trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.semrushTrafficRequestTimeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        domain,
        months: 6,
        ...(Array.isArray(args.paymentDomains) ? { paymentDomains: args.paymentDomains } : {}),
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return JSON.stringify({
        source: 'semrush-browser-ui',
        error: `Semrush traffic worker returned HTTP ${response.status}`,
        details: safeResponseBody(text),
      }, null, 2);
    }
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return JSON.stringify({ source: 'semrush-browser-ui', error: 'Worker returned invalid JSON' });
    }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? `Semrush traffic worker timed out after ${config.semrushTrafficRequestTimeoutMs}ms`
      : error instanceof Error ? error.message : String(error);
    return JSON.stringify({ source: 'semrush-browser-ui', error: message }, null, 2);
  } finally {
    clearTimeout(timeout);
  }
}

function ensureTrailingSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`;
}

function safeResponseBody(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value.replace(/[\r\n]+/g, ' ').slice(0, 500);
  }
}
