import { aggregatePaymentDestinations } from './aggregate.js';
import { SemrushBrowserProvider, type BrowserProviderConfig } from './browser-provider.js';
import { normalizeTargetDomain } from './domains.js';
import { lastCompletedMonthStarts } from './months.js';
import { SemrushApiProvider } from './semrush-api-provider.js';
import type { DestinationProvider, QueryInput } from './types.js';

export type ServiceConfig = {
  providerMode: 'auto' | 'api' | 'browser';
  apiKey?: string;
  browser: BrowserProviderConfig;
};

export function createProvider(config: ServiceConfig): DestinationProvider {
  if (config.providerMode === 'api' || (config.providerMode === 'auto' && config.apiKey)) {
    if (!config.apiKey) throw new Error('SEMRUSH_TRENDS_API_KEY is required in api mode');
    return new SemrushApiProvider(config.apiKey);
  }
  return new SemrushBrowserProvider(config.browser);
}

export async function queryPaymentDestinations(
  provider: DestinationProvider,
  value: unknown,
  referenceDate = new Date(),
) {
  const input = normalizeQueryInput(value);
  const displayDates = input.month
    ? [`${input.month}-01`]
    : lastCompletedMonthStarts(referenceDate, input.months);
  const providerResult = await provider.query(input, displayDates);
  return aggregatePaymentDestinations(input, displayDates, providerResult);
}

export function normalizeQueryInput(value: unknown): QueryInput {
  const record = isRecord(value) ? value : {};
  const month = normalizeRequestedMonth(record.month);
  const rangeMode = record.rangeMode === true;
  if (month && record.months !== undefined) {
    throw new Error('month cannot be combined with months');
  }
  if (month && rangeMode) {
    throw new Error('month cannot be combined with diagnostic range mode');
  }
  const months = month ? 1 : record.months === undefined ? 6 : Number(record.months);
  if (!month) {
    const validMonths = rangeMode ? [1, 3, 6] : [3, 6];
    if (!validMonths.includes(months)) {
      throw new Error(rangeMode
        ? 'months must be 1, 3, or 6 in diagnostic range mode'
        : 'months must be either 3 or 6 for this tool');
    }
  }
  const country = typeof record.country === 'string' && record.country.trim()
    ? record.country.trim().toUpperCase()
    : undefined;
  if (country && !/^[A-Z]{2}$/.test(country)) throw new Error('country must be a two-letter ISO country code');
  const paymentDomains = Array.isArray(record.paymentDomains)
    ? record.paymentDomains.map((item) => normalizeTargetDomain(item))
    : undefined;
  if (paymentDomains && paymentDomains.length > 50) throw new Error('paymentDomains supports at most 50 entries');
  return {
    domain: normalizeTargetDomain(record.domain),
    months,
    ...(month ? { month } : {}),
    rangeMode,
    country,
    paymentDomains,
  };
}

function normalizeRequestedMonth(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.trim())) {
    throw new Error('month must use YYYY-MM format');
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
