import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ALTSELFS_HERMES_DYNAMIC_USER_CONTEXT_ENV,
  buildHermesDynamicUserContext,
  buildHermesPromptCachingYamlLines,
  buildHermesSkillsYamlLines,
  buildHermesStableSystemPrompt,
  buildHermesToolsets,
  HERMES_PROMPT_CACHE_TTL,
  prepareHermesRuntimeContextPlugin,
  prepareHermesSkillsHome,
} from '../src/hermes/source-hermes-runtime.js';

test('Hermes stable system prompt excludes all per-turn runtime context', () => {
  const stablePrompt = buildHermesStableSystemPrompt();

  assert.match(stablePrompt, /Minaco runtime contract:/);
  assert.match(stablePrompt, /Role split:/);
  assert.match(stablePrompt, /mcp_altselfs_codex_update_plan/);
  assert.match(stablePrompt, /Do not impose an artificial step count or tool-call count/);
  assert.match(stablePrompt, /Connector authorization guidance:/);
  assert.match(stablePrompt, /connect or enable it in Connectors/);
  assert.match(stablePrompt, /Product expert Skills are centrally maintained and read-only/);
  assert.match(stablePrompt, /include both `name` and the exact `file_path`/);
  assert.match(stablePrompt, /A name-only call reloads the main SKILL\.md/);
  assert.doesNotMatch(stablePrompt, /Current time:/);
  assert.doesNotMatch(stablePrompt, /Minaco runtime metadata for this turn:/);
  assert.doesNotMatch(stablePrompt, /<altselfs_user_profile>/);
  assert.doesNotMatch(stablePrompt, /<altselfs_artifact_context>/);
});

test('Hermes dynamic context contains time, mode, tools, profile, and artifacts', () => {
  const dynamicContext = buildHermesDynamicUserContext(
    {
      artifactContext: '<artifacts>quarterly-report.pdf</artifacts>',
      renderedProfile: '- Prefers concise answers',
      selectedAgentProfileId: 'competitive_intelligence',
      enabledConnectorKeys: ['feishu', 'similarweb_api1'],
      availablePersonalConnectorKeys: ['feishu'],
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
  assert.match(dynamicContext, /Enabled connector keys selected for this turn: feishu, similarweb_api1/);
  assert.match(dynamicContext, /Connected private personal-data connector keys available to this user: feishu/);
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

test('Hermes external skills use the native toolset with write approval', () => {
  const enabled = {
    hermesSkillsEnabled: true,
    hermesExternalSkillsDirs: ['/opt/altselfs/expert-skills'],
  };

  assert.equal(buildHermesToolsets(enabled), 'altselfs_codex,skills');
  assert.deepEqual(buildHermesSkillsYamlLines(enabled), [
    'skills:',
    '  external_dirs:',
    '    - "/opt/altselfs/expert-skills"',
    '  write_approval: true',
  ]);
  assert.equal(buildHermesToolsets({ hermesSkillsEnabled: false }), 'altselfs_codex');
  assert.deepEqual(buildHermesSkillsYamlLines({
    hermesSkillsEnabled: false,
    hermesExternalSkillsDirs: [],
  }), []);
});

test('Hermes homes opt out of bundled skills and require configured external directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-hermes-skills-'));
  const hermesHome = path.join(root, 'home');
  const externalDir = path.join(root, 'external');
  await Promise.all([
    fs.mkdir(hermesHome, { recursive: true }),
    fs.mkdir(externalDir, { recursive: true }),
  ]);

  await prepareHermesSkillsHome(hermesHome, {
    hermesSkillsEnabled: true,
    hermesExternalSkillsDirs: [externalDir],
  });
  assert.equal(await fs.readFile(path.join(hermesHome, '.no-bundled-skills'), 'utf8'), '');

  await assert.rejects(
    prepareHermesSkillsHome(hermesHome, {
      hermesSkillsEnabled: true,
      hermesExternalSkillsDirs: [path.join(root, 'missing')],
    }),
    /external skills directory is unavailable/
  );

  await fs.rm(root, { recursive: true, force: true });
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
