import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicModelRate } from './minaco-product-catalog';
import { cacheWriteNote, cacheWriteRateCaption, formatCacheWriteRate, modelRateRows } from './model-rate-display';

const base: PublicModelRate = {
  provider: 'apiyi-claude',
  model: 'claude-haiku-5-5',
  label: 'Claude Haiku 5.5',
  engines: ['claude'],
  version: 'test',
  input: 200,
  cachedInput: 20,
  output: 1_000,
  cacheWrite: 250,
  cacheWrite1h: 400,
  longContext: {
    threshold: 100_000,
    input: 1_000,
    cachedInput: 100,
    output: 5_000,
    cacheWrite: 1_250,
    cacheWrite1h: 2_000,
  },
  unit: 'credits',
};

test('tiered rates become separately priced prompt rows', () => {
  const rows = modelRateRows(base);
  assert.deepEqual(rows.map((row) => row.label), [
    'Claude Haiku 5.5 · prompt ≤ 100,000',
    'Claude Haiku 5.5 · prompt > 100,000',
  ]);
  assert.deepEqual(rows.map((row) => [row.input, row.cachedInput, row.cacheWrite, row.cacheWrite1h, row.output]), [
    [200, 20, 250, 400, 1_000],
    [1_000, 100, 1_250, 2_000, 5_000],
  ]);
});

test('cache write display covers unavailable, single-duration and dual-duration rates', () => {
  assert.equal(formatCacheWriteRate({ ...base, cacheWrite: undefined, cacheWrite1h: undefined, longContext: undefined }), '—');
  assert.equal(formatCacheWriteRate({ ...base, cacheWrite: 600, cacheWrite1h: undefined, longContext: undefined }), '600');
  assert.equal(formatCacheWriteRate(base), '250 / 400');
  assert.equal(cacheWriteRateCaption(base), '5 min / 1 hour');
  assert.equal(cacheWriteNote(base), 'Cache write: 250 / 400 (5 min / 1 hour) Credits per 1M tokens.');
});
