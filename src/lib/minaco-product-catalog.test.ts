import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMinacoProductCatalog } from './minaco-product-catalog';

test('commercial catalog keeps plans local and follows Desktop authorities for models and releases', async () => {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/v1/public/config')) return Response.json({
      releaseManifestUrl: 'https://desktop.minaco.ai/releases/latest.json',
      engines: [{ id: 'codex', name: 'Codex', vendor: 'OpenAI', description: 'Code and complex tasks', status: 'experimental' }],
    });
    if (url.endsWith('/v1/public/models')) return Response.json([{
      provider: 'minaco-codex', model: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', engines: ['codex'],
      version: 'rate-v1', input: 125, cachedInput: 6.25, output: 625, cacheWrite: 156.25,
      cacheWrite1h: 250, longContext: { threshold: 100_000, input: 250, cachedInput: 12.5, output: 1_250, cacheWrite: 312.5, cacheWrite1h: 500 },
      pricingNote: 'Prompt total selects the tier.', unit: 'credits',
    }]);
    if (url.endsWith('/releases/latest.json')) return Response.json({
      version: '0.12.62', releasedAt: '2026-11-03T00:00:00.000Z', assets: [{
        platform: 'darwin-arm64', url: 'https://downloads.minaco.ai/releases/Minaco-0.12.62-arm64.dmg', bytes: 320_000_000, sha256: 'a'.repeat(64),
      }],
    });
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  const catalog = await loadMinacoProductCatalog(fetcher, 'https://desktop-api.minaco.ai');
  assert.equal(catalog.plans.find((plan) => plan.key === 'SCALE')?.name, 'Ultra');
  assert.equal(catalog.models[0]?.input, 125);
  assert.equal(catalog.models[0]?.cacheWrite, 156.25);
  assert.equal(catalog.models[0]?.cacheWrite1h, 250);
  assert.equal(catalog.models[0]?.longContext?.cacheWrite, 312.5);
  assert.equal(catalog.models[0]?.pricingNote, 'Prompt total selects the tier.');
  assert.equal(catalog.release?.version, '0.12.62');
  assert.deepEqual(catalog.agents.map((agent) => agent.id), ['codex']);
  assert.deepEqual(calls, [
    'https://desktop-api.minaco.ai/v1/public/config',
    'https://desktop-api.minaco.ai/v1/public/models',
    'https://desktop.minaco.ai/releases/latest.json',
  ]);
});

test('commercial catalog never invents models or a download when Desktop is unavailable', async () => {
  const fetcher = (async () => new Response(null, { status: 503 })) as typeof fetch;
  const catalog = await loadMinacoProductCatalog(fetcher, 'https://desktop-api.minaco.ai');
  assert.equal(catalog.release, null);
  assert.deepEqual(catalog.models, []);
  assert.deepEqual(catalog.agents, []);
  assert.equal(catalog.sources.agentsAndModels, 'unavailable');
});
