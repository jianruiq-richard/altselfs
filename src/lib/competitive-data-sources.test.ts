import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefaultVisibleCompetitiveIntegrations } from './competitive-data-sources';

test('new investor workspaces connect every currently visible competitive tool', () => {
  const connectedAt = new Date('2026-08-30T00:00:00.000Z');
  const integrations = buildDefaultVisibleCompetitiveIntegrations('investor-1', connectedAt);

  assert.deepEqual(integrations.map((integration) => integration.provider), [
    'INSTAGRAM_LOOTER2',
    'TWITTER241',
    'TIKTOK_API23',
    'YOUTUBE_V2',
    'SIMILARWEB_API1',
    'SEMRUSH13',
    'AHREFS_URL_RESEARCH',
    'DOMAIN_METRICS_CHECK',
    'APPARK',
  ]);
  assert.equal(integrations.every((integration) => integration.status === 'CONNECTED'), true);
  assert.equal(integrations.every((integration) => integration.investorId === 'investor-1'), true);
  assert.equal(integrations.every((integration) => integration.connectedAt === connectedAt), true);
});

test('hidden competitive tools are not provisioned by default', () => {
  const integrations = buildDefaultVisibleCompetitiveIntegrations('investor-1');
  assert.equal(integrations.some((integration) => integration.provider === 'SEMRUSH8'), false);
});
