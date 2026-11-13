import type { PublicModelRate } from './minaco-product-catalog';

export function modelRateRows(model: PublicModelRate): PublicModelRate[] {
  if (!model.longContext) return [model];
  const { longContext, cacheWrite, cacheWrite1h, ...base } = model;
  const threshold = new Intl.NumberFormat('en-US').format(longContext.threshold);
  return [
    {
      ...base,
      ...(cacheWrite === undefined ? {} : { cacheWrite }),
      ...(cacheWrite1h === undefined ? {} : { cacheWrite1h }),
      label: `${model.label} · prompt ≤ ${threshold}`,
    },
    {
      ...base,
      input: longContext.input,
      cachedInput: longContext.cachedInput,
      output: longContext.output,
      ...(longContext.cacheWrite === undefined ? {} : { cacheWrite: longContext.cacheWrite }),
      ...(longContext.cacheWrite1h === undefined ? {} : { cacheWrite1h: longContext.cacheWrite1h }),
      label: `${model.label} · prompt > ${threshold}`,
    },
  ];
}

export function formatCacheWriteRate(model: PublicModelRate): string {
  if (model.cacheWrite === undefined) return '—';
  if (model.cacheWrite1h === undefined) return formatRate(model.cacheWrite);
  return `${formatRate(model.cacheWrite)} / ${formatRate(model.cacheWrite1h)}`;
}

export function cacheWriteRateCaption(model: PublicModelRate): string | undefined {
  return model.cacheWrite !== undefined && model.cacheWrite1h !== undefined
    ? '5 min / 1 hour'
    : undefined;
}

export function cacheWriteNote(model: PublicModelRate): string | undefined {
  if (model.cacheWrite === undefined || model.cacheWrite1h === undefined) return undefined;
  return `Cache write: ${formatCacheWriteRate(model)} (5 min / 1 hour) Credits per 1M tokens.`;
}

function formatRate(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
}
