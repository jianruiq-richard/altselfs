import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  ALTSELFS_HERMES_DYNAMIC_USER_CONTEXT_ENV,
  buildHermesDynamicUserContext,
  buildHermesPromptCachingYamlLines,
  buildHermesProviderRoutingYamlLines,
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
  assert.match(stablePrompt, /## Be the cognitive brain/);
  assert.match(stablePrompt, /Decide what data is needed, how it should be analyzed, what the estimates are, and what conclusions to draw/);
  assert.match(stablePrompt, /Do not delegate business reasoning, interpretation, estimates, or conclusions to Codex/);
  assert.match(stablePrompt, /Codex may implement the HTML exactly as you specify/);
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

test('Hermes chat-completions prompt caching retains one hour', () => {
  assert.equal(HERMES_PROMPT_CACHE_TTL, '1h');
  assert.deepEqual(buildHermesPromptCachingYamlLines(), [
    'prompt_caching:',
    '  cache_ttl: "1h"',
  ]);
});

test('Hermes prioritizes Friendli and falls back to Alibaba without affecting other providers', () => {
  const config = { hermesOpenRouterProvidersOnly: ['friendli', 'alibaba'] };

  assert.deepEqual(buildHermesProviderRoutingYamlLines({ provider: 'openrouter' }, config), [
    'provider_routing:',
    '  only:',
    '    - "friendli"',
    '    - "alibaba"',
    '  order:',
    '    - "friendli"',
    '    - "alibaba"',
    '  require_parameters: true',
  ]);
  assert.deepEqual(buildHermesProviderRoutingYamlLines({ provider: 'apiyi' }, config), []);
  assert.deepEqual(buildHermesProviderRoutingYamlLines(
    { provider: 'openrouter' },
    { hermesOpenRouterProvidersOnly: [] }
  ), []);
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

test('generated cache middleware preserves 1h with tools within four breakpoints', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-hermes-cache-'));
  try {
    await prepareHermesRuntimeContextPlugin(root);
    execFileSync('python3', ['-c', `
import copy, runpy, sys
plugin = runpy.run_path(sys.argv[1])
registered = {}
class Context:
    def register_hook(self, *args): pass
    def register_middleware(self, kind, callback): registered[kind] = callback
plugin['register'](Context())
normalize = registered['llm_request']
marker = {'type': 'ephemeral'}
request = {
    'tools': [{'name': 'one'}, {'name': 'two'}],
    'system': [{'type': 'text', 'text': 'system', 'cache_control': marker}],
    'messages': [{'role': role, 'content': [{'type': 'text', 'text': str(i), 'cache_control': marker}]} for i, role in enumerate(['user', 'assistant', 'user'])],
}
original = copy.deepcopy(request)
context = dict(api_mode='anthropic_messages', provider='custom', model='claude-sonnet-4-6', base_url='https://api.apiyi.com/v1')
result = normalize(request, **context)['request']
assert request == original
assert 'cache_control' not in result['tools'][0]
blocks = result['tools'] + result['system'] + [m['content'][0] for m in result['messages']]
markers = [b['cache_control'] for b in blocks if 'cache_control' in b]
assert len(markers) == 4
assert all(m == {'type': 'ephemeral', 'ttl': '1h'} for m in markers)
assert 'cache_control' not in result['messages'][0]['content'][0]
assert normalize(result, **context)['request'] == result
assert normalize(request, **{**context, 'provider': 'apiyi'})['request'] == result
assert normalize(request, **{**context, 'base_url': 'https://vip.apiyi.com/v1'})['request'] == result
for url in ['https://openrouter.ai/api/v1', 'https://apiyi.com.example.org/v1', 'https://notapiyi.com/v1', '']:
    assert normalize(request, **{**context, 'base_url': url}) is None
assert normalize(request, **{**context, 'api_mode': 'chat_completions'}) is None
no_tools = {k: v for k, v in request.items() if k != 'tools'}
assert 'tools' not in normalize(no_tools, **context)['request']
`, path.join(root, 'plugins', 'altselfs-runtime-context', '__init__.py')]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
