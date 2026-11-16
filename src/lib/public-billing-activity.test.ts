import assert from 'node:assert/strict';
import test from 'node:test';
import { publicBillingActivity } from './public-billing-activity';

test('billing activity does not expose internal model providers', () => {
  const value = publicBillingActivity({ items: [{ pricingVersion: 'apiyi-claudecode-095-cost2-2026-11-13', components: [
    { provider: 'apiyi-claude', version: 'apiyi-claudecode-095-cost2-2026-11-13', model: 'claude-sonnet-5-5' },
    { provider: 'minaco-codex', model: 'gpt-6.1-sol' },
    { provider: 'openrouter-qwen', model: 'qwen/qwen4-max' },
  ] }], nextCursor: null }) as { items: Array<{ pricingVersion: string; components: Array<{ provider: string; version?: string }> }> };
  assert.deepEqual(value.items[0].components.map((component) => component.provider),
    ['Minaco', 'Minaco', 'Minaco']);
  assert.equal(value.items[0].pricingVersion, 'Recorded Minaco rate');
  assert.equal(value.items[0].components[0].version, 'current');
});
