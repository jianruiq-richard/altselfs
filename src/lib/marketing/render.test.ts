import assert from 'node:assert/strict';
import test from 'node:test';
import type { MinacoProductCatalog } from '../minaco-product-catalog';
import { renderAgentDirectory } from './render';

const catalog: MinacoProductCatalog = {
  generatedAt: '2026-11-14T00:00:00.000Z',
  plans: [],
  agents: [
    { id: 'codex', name: 'Codex', vendor: 'OpenAI', description: 'Code and complex tasks', status: 'experimental' },
    { id: 'gemini', name: 'Gemini CLI', vendor: 'Google', description: 'Work with Gemini locally', status: 'experimental' },
  ],
  models: [
    { provider: 'minaco-codex', model: 'gpt-test', label: 'GPT Test', engines: ['codex'], version: 'test', input: 1, cachedInput: 1, output: 1, unit: 'credits' },
  ],
  release: null,
  sources: { plans: 'minaco-billing', agentsAndModels: 'minaco-desktop-api', release: 'unavailable' },
};

test('agent directory presents a curated product choice instead of the internal engine catalog', () => {
  const html = renderAgentDirectory(catalog);

  assert.match(html, /Choose the right agent/);
  assert.match(html, /More agents in Minaco/);
  assert.match(html, /Minaco Credits available/);
  assert.match(html, /Use a supported provider account/);
  assert.match(html, /Early access/);
  assert.doesNotMatch(html, /Explore the catalog/);
  assert.doesNotMatch(html, /Experimental integration/);
  assert.doesNotMatch(html, /Published 2026-11-14/);
});
