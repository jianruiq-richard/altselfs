import assert from 'node:assert/strict';
import test from 'node:test';
import { __billingActivityTest } from '../src/credit-admission.js';

test('normalizes Desktop settlement snapshots without losing token details', () => {
  const row = __billingActivityTest.normalizeBillingActivityRow({
    id: 'desktop-row',
    source: 'desktop',
    status: 'CAPTURED',
    runId: 'desktop:run-1',
    threadId: 'thread-1',
    billedCredits: 17,
    computedCredits: 17,
    createdAt: new Date('2026-11-05T08:00:00.000Z'),
    settledAt: new Date('2026-11-05T08:01:00.000Z'),
    usage: {
      billedCredits: 17,
      threadTitle: 'Quarterly competitor review',
      usage: { input: 1200, cachedInput: 800, cacheWrite: 30, output: 90 },
      pricing: { engine: 'codex', provider: 'minaco-codex', model: 'gpt-6.1-sol', version: 'rates-v4' },
    },
  });

  assert.equal(row.source, 'desktop');
  assert.equal(row.billedCredits, 17);
  assert.deepEqual(row.totals, {
    inputTokens: 1200,
    cachedInputTokens: 800,
    cacheWriteTokens: 30,
    outputTokens: 90,
    reasoningTokens: 0,
  });
  assert.equal(row.components[0]?.model, 'gpt-6.1-sol');
  assert.equal(row.pricingVersion, 'rates-v4');
  assert.equal(row.threadTitle, 'Quarterly competitor review');
});

test('combines Intelligence model components and identifies memory review usage', () => {
  const row = __billingActivityTest.normalizeBillingActivityRow({
    id: 'intelligence-row',
    source: 'intelligence',
    status: 'BILLED',
    runId: 'run-2:memory-review:job-1',
    threadId: 'thread-2',
    threadTitle: 'Competitor review',
    billedCredits: 8,
    computedCredits: 8,
    createdAt: new Date('2026-11-05T09:00:00.000Z'),
    settledAt: new Date('2026-11-05T09:00:10.000Z'),
    usage: {
      component: 'memory_review',
      taskLabel: 'Review memory',
      pricingVersion: '2026-08-v5',
      hermes: {
        provider: 'apiyi', model: 'claude-sonnet-4-6', inputTokens: 100,
        cacheReadTokens: 40, cacheWriteTokens: 5, outputTokens: 30, reasoningTokens: 2, credits: 5,
      },
      codex: {
        provider: 'openai', model: 'gpt-6.1-sol', inputTokens: 70,
        cachedInputTokens: 20, outputTokens: 10, reasoningOutputTokens: 4, credits: 3,
      },
    },
  });

  assert.equal(row.component, 'memory_review');
  assert.equal(row.components.length, 2);
  assert.deepEqual(row.totals, {
    inputTokens: 170,
    cachedInputTokens: 60,
    cacheWriteTokens: 5,
    outputTokens: 40,
    reasoningTokens: 6,
  });
});

test('billing activity cursors round-trip and reject malformed values', () => {
  const encoded = __billingActivityTest.encodeBillingActivityCursor(
    '2026-11-05T09:00:00.000Z',
    'desktop:row-1',
  );
  assert.deepEqual(__billingActivityTest.decodeBillingActivityCursor(encoded), {
    createdAt: '2026-11-05T09:00:00.000Z',
    sortId: 'desktop:row-1',
  });
  assert.equal(__billingActivityTest.decodeBillingActivityCursor('not-a-cursor'), null);
});
