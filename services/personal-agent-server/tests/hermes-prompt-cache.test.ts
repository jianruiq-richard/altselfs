import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ALTSELFS_HERMES_DYNAMIC_USER_CONTEXT_ENV,
  buildHermesDynamicUserContext,
  buildHermesPromptCachingYamlLines,
  buildHermesStableSystemPrompt,
  HERMES_PROMPT_CACHE_TTL,
  prepareHermesRuntimeContextPlugin,
} from '../src/hermes/source-hermes-runtime.js';

test('Hermes stable system prompt excludes all per-turn runtime context', () => {
  const stablePrompt = buildHermesStableSystemPrompt();

  assert.match(stablePrompt, /Altselfs runtime contract:/);
  assert.match(stablePrompt, /Role split:/);
  assert.doesNotMatch(stablePrompt, /Current time:/);
  assert.doesNotMatch(stablePrompt, /Altselfs runtime metadata for this turn:/);
  assert.doesNotMatch(stablePrompt, /<altselfs_user_profile>/);
  assert.doesNotMatch(stablePrompt, /<altselfs_artifact_context>/);
});

test('Hermes dynamic context contains time, mode, tools, profile, and artifacts', () => {
  const dynamicContext = buildHermesDynamicUserContext(
    {
      artifactContext: '<artifacts>quarterly-report.pdf</artifacts>',
      renderedProfile: '- Prefers concise answers',
      selectedAgentProfileId: 'competitive_intelligence',
      enabledInfoSources: ['similarweb_api1'],
      enabledCompetitortools: ['altselfs_similarweb_api1'],
      personalDatatoolNames: ['altselfs_gmail_search'],
      codexModelProvider: 'openai',
      sandboxExecEnabled: true,
    },
    new Date('2026-07-23T00:00:00.000Z')
  );

  assert.match(dynamicContext, /Current time:/);
  assert.match(dynamicContext, /competitive_intelligence/);
  assert.match(dynamicContext, /similarweb_api1/);
  assert.match(dynamicContext, /altselfs_similarweb_api1/);
  assert.match(dynamicContext, /altselfs_gmail_search/);
  assert.match(dynamicContext, /<altselfs_user_profile>/);
  assert.match(dynamicContext, /Prefers concise answers/);
  assert.match(dynamicContext, /<altselfs_artifact_context>/);
  assert.match(dynamicContext, /quarterly-report\.pdf/);
});

test('Hermes prompt caching is configured for one hour', () => {
  assert.equal(HERMES_PROMPT_CACHE_TTL, '1h');
  assert.deepEqual(buildHermesPromptCachingYamlLines(), [
    'prompt_caching:',
    '  cache_ttl: "1h"',
  ]);
});

test('generated Hermes plugin injects dynamic context through pre_llm_call', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-hermes-plugin-'));
  await prepareHermesRuntimeContextPlugin(root);

  const pluginDir = path.join(root, 'plugins', 'altselfs-runtime-context');
  const [manifest, source] = await Promise.all([
    fs.readFile(path.join(pluginDir, 'plugin.yaml'), 'utf8'),
    fs.readFile(path.join(pluginDir, '__init__.py'), 'utf8'),
  ]);

  assert.match(manifest, /pre_llm_call/);
  assert.match(source, new RegExp(ALTSELFS_HERMES_DYNAMIC_USER_CONTEXT_ENV));
  assert.match(source, /return \{"context": context\}/);
  assert.match(source, /ctx\.register_hook\("pre_llm_call"/);

  await fs.rm(root, { recursive: true, force: true });
});
