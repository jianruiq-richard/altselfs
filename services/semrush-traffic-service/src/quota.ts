export type DailyQuotaStatus = 'unknown' | 'available' | 'exhausted' | 'unavailable' | 'disabled';

export type DailyQuotaSnapshot = {
  status: DailyQuotaStatus;
  usedPercent: number | null;
  remainingPercent: number | null;
  acceptingQueries: boolean;
  observedAt: string | null;
  source: '3ue-dashboard';
  stopAtUsedPercent: number;
  error?: string;
};

export type ThreeUeSubscriptionCardProbe = {
  text: string;
  buttonTexts: string[];
  progressText: string;
};

export function initialDailyQuotaSnapshot(enabled: boolean, stopAtUsedPercent: number): DailyQuotaSnapshot {
  return {
    status: enabled ? 'unknown' : 'disabled',
    usedPercent: null,
    remainingPercent: null,
    acceptingQueries: !enabled,
    observedAt: null,
    source: '3ue-dashboard',
    stopAtUsedPercent,
  };
}

export function parseThreeUeSemrushDailyQuota(
  cards: ThreeUeSubscriptionCardProbe[],
  stopAtUsedPercent: number,
  observedAt = new Date().toISOString(),
): DailyQuotaSnapshot | null {
  const card = cards.find((candidate) => {
    const buttons = candidate.buttonTexts.map(normalizeText);
    const hasOpenButton = buttons.some((text) => /^打开$/i.test(text));
    const hasSemrushRegionalNode = buttons.some((text) => (
      /节点\d+/i.test(text) && /地区数据库/i.test(text)
    ));
    return hasOpenButton && hasSemrushRegionalNode;
  });
  if (!card) return null;

  const progressMatch = normalizeText(card.progressText).match(/^(\d{1,3}(?:\.\d+)?)%$/);
  const fallbackMatch = normalizeText(card.text).match(/API\s*今日配额\s*(\d{1,3}(?:\.\d+)?)%/i);
  const rawPercent = progressMatch?.[1] || fallbackMatch?.[1];
  if (!rawPercent) return null;
  const usedPercent = Number(rawPercent);
  if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return null;

  const exhausted = usedPercent >= stopAtUsedPercent;
  return {
    status: exhausted ? 'exhausted' : 'available',
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    acceptingQueries: !exhausted,
    observedAt,
    source: '3ue-dashboard',
    stopAtUsedPercent,
  };
}

export function unavailableDailyQuotaSnapshot(
  stopAtUsedPercent: number,
  error: string,
): DailyQuotaSnapshot {
  return {
    status: 'unavailable',
    usedPercent: null,
    remainingPercent: null,
    acceptingQueries: false,
    observedAt: new Date().toISOString(),
    source: '3ue-dashboard',
    stopAtUsedPercent,
    error,
  };
}

export class DailyQuotaExhaustedError extends Error {
  readonly code = 'DAILY_QUOTA_EXHAUSTED';

  constructor(readonly quota: DailyQuotaSnapshot) {
    super(`3ue Semrush daily quota is exhausted (${quota.usedPercent}% used)`);
    this.name = 'DailyQuotaExhaustedError';
  }
}

export class DailyQuotaUnavailableError extends Error {
  readonly code = 'DAILY_QUOTA_UNAVAILABLE';

  constructor(readonly quota: DailyQuotaSnapshot) {
    super(`3ue Semrush daily quota could not be verified: ${quota.error || quota.status}`);
    this.name = 'DailyQuotaUnavailableError';
  }
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
