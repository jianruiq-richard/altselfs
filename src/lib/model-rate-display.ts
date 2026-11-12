import type { PublicModelRate } from './minaco-product-catalog';

export function modelRateRows(model: PublicModelRate): PublicModelRate[] {
  if (!model.longContext) return [model];
  const { longContext, ...base } = model;
  const threshold = new Intl.NumberFormat('en-US').format(longContext.threshold);
  return [
    { ...base, label: `${model.label} (≤ ${threshold} prompt tokens)` },
    { ...base, ...longContext, label: `${model.label} (> ${threshold} prompt tokens)` },
  ];
}

export function cacheWriteNote(model: PublicModelRate): string | undefined {
  if (model.cacheWrite1h === undefined || model.cacheWrite === undefined) return undefined;
  const format = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n);
  return `Cache write: ${format(model.cacheWrite)} (5 min) / ${format(model.cacheWrite1h)} (1 hour) Credits per 1M tokens.`;
}
