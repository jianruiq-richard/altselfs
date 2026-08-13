import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import type { ServerConfig } from '../src/config.js';
import {
  buildAgentRunUsage,
  buildMemoryReviewUsage,
  readCodexUsageSince,
  readHermesUsageSnapshot,
} from '../src/usage-meter.js';

const execFileAsync = promisify(execFile);

test('reads native Hermes session usage from state.db', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-hermes-usage-'));
  const stateDb = path.join(root, 'state.db');
  const script = [
    'import sqlite3, sys',
    'conn = sqlite3.connect(sys.argv[1])',
    'conn.execute("""CREATE TABLE sessions (',
    'id TEXT PRIMARY KEY, input_tokens INTEGER, output_tokens INTEGER,',
    'cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER,',
    'estimated_cost_usd REAL, actual_cost_usd REAL, api_call_count INTEGER)""")',
    'conn.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",',
    '("session-1", 1200, 80, 900, 40, 22, 0.031, 0.029, 3))',
    'conn.commit()',
  ].join('\n');
  await execFileAsync('python3', ['-c', script, stateDb]);

  const usage = await readHermesUsageSnapshot(root, 'session-1');
  assert.deepEqual(usage, {
    inputTokens: 1200,
    outputTokens: 80,
    cacheReadTokens: 900,
    cacheWriteTokens: 40,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheWriteUnclassifiedTokens: 40,
    cacheWriteTierSource: 'apiyi_channel_fallback_5m',
    reasoningTokens: 22,
    estimatedCostUsd: 0.031,
    actualCostUsd: 0.029,
    apiCallCount: 3,
  });
});

test('sums current-run Codex last-token usage from native JSONL events', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-codex-usage-'));
  const sessionDir = path.join(root, 'sessions', '2026', '07', '23');
  await fs.mkdir(sessionDir, { recursive: true });
  const startedAtMs = Date.now();
  const events = [
    tokenEvent(startedAtMs + 100, 1_000, 800, 100, 30),
    tokenEvent(startedAtMs + 200, 2_000, 1_500, 180, 50),
  ];
  await fs.writeFile(path.join(sessionDir, 'rollout.jsonl'), `${events.map(JSON.stringify).join('\n')}\n`);

  const usage = await readCodexUsageSince(root, startedAtMs);
  assert.deepEqual(usage, {
    inputTokens: 3_000,
    cachedInputTokens: 2_300,
    outputTokens: 280,
    reasoningOutputTokens: 80,
    modelCallCount: 2,
  });
});

test('keeps OpenAI Codex billing on the ChatGPT usage-credit rate card', async () => {
  const startedAtMs = Date.now();
  const codexHome = await createCodexHome(startedAtMs, [
    tokenEvent(startedAtMs + 100, 1_000_000, 800_000, 100_000, 20_000),
  ]);

  const usage = await buildAgentRunUsage({
    config: billingConfig(),
    runId: 'run-openai-codex',
    hermesHome: path.join(codexHome, 'missing-hermes-home'),
    hermesSessionId: null,
    hermesBefore: emptyHermesUsage(),
    hermesModel: 'claude-sonnet-4-6',
    hermesProvider: 'apiyi',
    codexHome,
    codexModel: 'gpt-5.5',
    codexProvider: 'openai',
    startedAtMs,
  });

  assert.equal(usage.codex.provider, 'openai');
  assert.equal(usage.codex.billingBasis, 'chatgpt_usage_credits');
  assert.equal(usage.codex.openAiUsageCredits, 110);
  assert.equal(usage.codex.billedCostUsd, 0);
  assert.equal(usage.codex.credits, 825);
  assert.equal(usage.codex.pricing?.source, 'openai-chatgpt-rate-card');
});

test('prices APIYI Codex calls independently across the long-context boundary', async () => {
  const startedAtMs = Date.now();
  const codexHome = await createCodexHome(startedAtMs, [
    tokenEvent(startedAtMs + 100, 278_528, 0, 0, 0),
    tokenEvent(startedAtMs + 200, 278_529, 0, 0, 0),
  ]);

  const usage = await buildAgentRunUsage({
    config: billingConfig(),
    runId: 'run-apiyi-codex-boundary',
    hermesHome: path.join(codexHome, 'missing-hermes-home'),
    hermesSessionId: null,
    hermesBefore: emptyHermesUsage(),
    hermesModel: 'claude-sonnet-4-6',
    hermesProvider: 'apiyi',
    codexHome,
    codexModel: 'gpt-5.5',
    codexProvider: 'apiyi',
    startedAtMs,
  });

  assert.equal(usage.codex.provider, 'apiyi');
  assert.equal(usage.codex.billingBasis, 'provider_usd');
  assert.equal(usage.codex.openAiUsageCredits, 0);
  assert.equal(usage.codex.longContextModelCallCount, 1);
  assert.ok(Math.abs(usage.codex.billedCostUsd - 4.17793) < 1e-12);
  assert.equal(usage.codex.credits, 8_356);
  assert.equal(usage.codex.pricing?.source, 'apiyi-tiered-rate-card');
});

test('does not treat aggregate APIYI Codex usage as one long-context call', async () => {
  const startedAtMs = Date.now();
  const codexHome = await createCodexHome(startedAtMs, [
    tokenEvent(startedAtMs + 100, 150_000, 50_000, 5_000, 0),
    tokenEvent(startedAtMs + 200, 150_000, 50_000, 5_000, 0),
  ]);

  const usage = await buildAgentRunUsage({
    config: billingConfig(),
    runId: 'run-apiyi-codex-short-calls',
    hermesHome: path.join(codexHome, 'missing-hermes-home'),
    hermesSessionId: null,
    hermesBefore: emptyHermesUsage(),
    hermesModel: 'claude-sonnet-4-6',
    hermesProvider: 'apiyi',
    codexHome,
    codexModel: 'gpt-5.5',
    codexProvider: 'apiyi',
    startedAtMs,
  });

  assert.equal(usage.codex.inputTokens, 300_000);
  assert.equal(usage.codex.modelCallCount, 2);
  assert.equal(usage.codex.longContextModelCallCount, 0);
  assert.ok(Math.abs(usage.codex.billedCostUsd - 1.35) < 1e-12);
  assert.equal(usage.codex.credits, 2_700);
});

test('prices APIYI Claude usage locally when Hermes reports no provider cost', async () => {
  const root = await createHermesStateDb({
    inputTokens: 3,
    outputTokens: 18,
    cacheReadTokens: 0,
    cacheWriteTokens: 6_552,
    reasoningTokens: 0,
    estimatedCostUsd: 0,
    actualCostUsd: 0,
    apiCallCount: 1,
  });

  const usage = await buildAgentRunUsage({
    config: billingConfig(),
    runId: 'run-priced',
    hermesHome: root,
    hermesSessionId: 'session-1',
    hermesBefore: emptyHermesUsage(),
    hermesModel: 'claude-sonnet-4-6',
    hermesProvider: 'apiyi',
    codexHome: path.join(root, 'codex-home'),
    codexModel: 'gpt-5.5',
    startedAtMs: Date.now(),
  });

  assert.equal(usage.hermes.costSource, 'local_pricing');
  assert.ok(Math.abs(usage.hermes.billedCostUsd - 0.02360655) < 1e-12);
  assert.equal(usage.hermes.credits, 48);
  assert.equal(usage.totalCredits, 48);
  assert.deepEqual(usage.hermes.pricing, {
    source: 'apiyi-claude-sonnet-4-6',
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.3,
    cacheWrite5mUsdPerMillion: 3.75,
    cacheWrite1hUsdPerMillion: 6,
    multiplier: 0.95,
  });
});

test('prices aggregate APIYI Claude tokens across multiple calls in one run', async () => {
  const root = await createHermesStateDb({
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 2_000,
    cacheWriteTokens: 3_000,
    reasoningTokens: 0,
    estimatedCostUsd: 0,
    actualCostUsd: 0,
    apiCallCount: 3,
  });

  const usage = await buildAgentRunUsage({
    config: billingConfig(),
    runId: 'run-aggregate',
    hermesHome: root,
    hermesSessionId: 'session-1',
    hermesBefore: emptyHermesUsage(),
    hermesModel: 'claude-sonnet-4-6',
    hermesProvider: 'apiyi',
    codexHome: path.join(root, 'codex-home'),
    codexModel: 'gpt-5.5',
    startedAtMs: Date.now(),
  });

  assert.equal(usage.hermes.apiCallCount, 3);
  assert.ok(Math.abs(usage.hermes.billedCostUsd - 0.0212325) < 1e-12);
  assert.equal(usage.hermes.credits, 43);
  assert.equal(usage.totalCredits, 43);
});

test('uses per-call Hermes cache TTL details instead of the aggregate state bucket', async () => {
  const root = await createHermesStateDb({
    inputTokens: 3,
    outputTokens: 17,
    cacheReadTokens: 3_514,
    cacheWriteTokens: 3_062,
    reasoningTokens: 0,
    estimatedCostUsd: 0,
    actualCostUsd: 0,
    apiCallCount: 1,
  });
  const usageLogPath = path.join(root, 'hermes-usage.jsonl');
  await fs.writeFile(usageLogPath, `${JSON.stringify({
    provider: 'apiyi',
    input_tokens: 3,
    output_tokens: 17,
    cache_read_tokens: 3_514,
    cache_write_tokens: 3_062,
    cache_write_5m_tokens: 3_062,
    cache_write_1h_tokens: 0,
  })}\n`);

  const usage = await buildAgentRunUsage({
    config: billingConfig(),
    runId: 'run-detailed-cache',
    taskLabel: '你好',
    hermesHome: root,
    hermesUsageLogPath: usageLogPath,
    hermesSessionId: 'session-1',
    hermesBefore: emptyHermesUsage(),
    hermesModel: 'claude-sonnet-4-6',
    hermesProvider: 'apiyi',
    codexHome: path.join(root, 'codex-home'),
    codexModel: 'gpt-5.5',
    startedAtMs: Date.now(),
  });

  assert.equal(usage.hermes.cacheWriteTierSource, 'provider_detail');
  assert.equal(usage.hermes.cacheWrite5mTokens, 3_062);
  assert.equal(usage.hermes.cacheWrite1hTokens, 0);
  assert.ok(Math.abs(usage.hermes.billedCostUsd - 0.012160665) < 1e-12);
  assert.equal(usage.totalCredits, 25);
});

test('uses provider actual cost instead of local APIYI estimate when available', async () => {
  const root = await createHermesStateDb({
    inputTokens: 10_000,
    outputTokens: 1_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 8_000,
    reasoningTokens: 0,
    estimatedCostUsd: 0.04,
    actualCostUsd: 0.03,
    apiCallCount: 2,
  });

  const usage = await buildAgentRunUsage({
    config: billingConfig(),
    runId: 'run-provider-actual',
    hermesHome: root,
    hermesSessionId: 'session-1',
    hermesBefore: emptyHermesUsage(),
    hermesModel: 'claude-sonnet-4-6',
    hermesProvider: 'apiyi',
    codexHome: path.join(root, 'codex-home'),
    codexModel: 'gpt-5.5',
    startedAtMs: Date.now(),
  });

  assert.equal(usage.hermes.costSource, 'provider_actual');
  assert.equal(usage.hermes.billedCostUsd, 0.03);
  assert.equal(usage.hermes.credits, 60);
});

test('uses OpenRouter per-call actual costs instead of the Hermes state estimate', async () => {
  const root = await createHermesStateDb({
    inputTokens: 13_147,
    outputTokens: 1_841,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    estimatedCostUsd: 0.00582346,
    actualCostUsd: 0,
    apiCallCount: 2,
  });
  const usageLogPath = path.join(root, 'hermes-usage.jsonl');
  await fs.writeFile(usageLogPath, [
    JSON.stringify({
      provider: 'openrouter',
      input_tokens: 2_661,
      output_tokens: 673,
      estimated_cost_usd: 0.0028,
      actual_cost_usd: 0.00245,
    }),
    JSON.stringify({
      provider: 'openrouter',
      input_tokens: 10_486,
      output_tokens: 1_168,
      estimated_cost_usd: 0.00302346,
      actual_cost_usd: 0.00263,
    }),
  ].join('\n'));

  const usage = await buildAgentRunUsage({
    config: billingConfig(),
    runId: 'run-openrouter-actual',
    hermesHome: root,
    hermesUsageLogPath: usageLogPath,
    hermesSessionId: 'session-1',
    hermesBefore: emptyHermesUsage(),
    hermesModel: 'deepseek/deepseek-v3.2',
    hermesProvider: 'openrouter',
    codexHome: path.join(root, 'codex-home'),
    codexModel: 'gpt-5.5',
    startedAtMs: Date.now(),
  });

  assert.equal(usage.pricingVersion, '2026-08-v5');
  assert.equal(usage.hermes.costSource, 'provider_actual');
  assert.ok(Math.abs(usage.hermes.actualCostUsd - 0.00508) < 1e-12);
  assert.ok(Math.abs(usage.hermes.billedCostUsd - 0.00508) < 1e-12);
  assert.equal(usage.hermes.estimatedCostUsd, 0.00582346);
  assert.equal(usage.hermes.credits, 11);
  assert.equal(usage.totalCredits, 11);
});

test('prices APIYI memory review from Anthropic cache TTL response details', () => {
  const usage = buildMemoryReviewUsage({
    config: billingConfig(),
    sourceRunId: 'run-main',
    memoryReviewJobId: 'memrev-1',
    taskLabel: '你好',
    hermesModel: 'claude-sonnet-4-6',
    hermesProvider: 'apiyi',
    rawCompletion: {
      usage: {
        input_tokens: 3,
        output_tokens: 17,
        cache_read_input_tokens: 3_514,
        cache_creation_input_tokens: 3_062,
        cache_creation: {
          ephemeral_5m_input_tokens: 3_062,
          ephemeral_1h_input_tokens: 0,
        },
      },
    },
  });

  assert.equal(usage.component, 'memory_review');
  assert.equal(usage.sourceRunId, 'run-main');
  assert.equal(usage.hermes.cacheWrite5mTokens, 3_062);
  assert.equal(usage.hermes.cacheWrite1hTokens, 0);
  assert.equal(usage.hermes.cacheWriteTierSource, 'provider_detail');
  assert.equal(usage.hermes.billedCostUsd, 0.012160665);
  assert.equal(usage.totalCredits, 25);
});

test('prices uncached APIYI memory review without applying the task minimum charge', () => {
  const usage = buildMemoryReviewUsage({
    config: billingConfig(),
    sourceRunId: 'run-main',
    memoryReviewJobId: 'memrev-2',
    taskLabel: '你好',
    hermesModel: 'claude-sonnet-4-6',
    hermesProvider: 'apiyi',
    rawCompletion: {
      usage: {
        input_tokens: 2_592,
        output_tokens: 42,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  });

  assert.equal(usage.hermes.billedCostUsd, 0.0079857);
  assert.equal(usage.totalCredits, 16);
});

async function createHermesStateDb(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  apiCallCount: number;
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-hermes-priced-usage-'));
  const stateDb = path.join(root, 'state.db');
  const script = [
    'import json, sqlite3, sys',
    'values = json.loads(sys.argv[2])',
    'conn = sqlite3.connect(sys.argv[1])',
    'conn.execute("""CREATE TABLE sessions (',
    'id TEXT PRIMARY KEY, input_tokens INTEGER, output_tokens INTEGER,',
    'cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER,',
    'estimated_cost_usd REAL, actual_cost_usd REAL, api_call_count INTEGER)""")',
    'conn.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", values)',
    'conn.commit()',
  ].join('\n');
  await execFileAsync('python3', [
    '-c',
    script,
    stateDb,
    JSON.stringify([
      'session-1',
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheWriteTokens,
      usage.reasoningTokens,
      usage.estimatedCostUsd,
      usage.actualCostUsd,
      usage.apiCallCount,
    ]),
  ]);
  return root;
}

function emptyHermesUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheWriteUnclassifiedTokens: 0,
    cacheWriteTierSource: 'none' as const,
    reasoningTokens: 0,
    estimatedCostUsd: 0,
    actualCostUsd: 0,
    apiCallCount: 0,
  };
}

function billingConfig() {
  return {
    creditsPerUsd: 1_000,
    creditsCostMarkup: 2,
    creditsMinimumRunCharge: 5,
    hermesApiyiInputRate: 3,
    hermesApiyiOutputRate: 15,
    hermesApiyiCacheReadRate: 0.3,
    hermesApiyiCacheWrite5mRate: 3.75,
    hermesApiyiCacheWrite1hRate: 6,
    hermesApiyiCostMultiplier: 0.95,
    codexUsageUncachedInputRate: 125,
    codexUsageCachedInputRate: 12.5,
    codexUsageOutputRate: 750,
    codexUsageCreditMultiplier: 7.5,
    codexApiyiUncachedInputRate: 5,
    codexApiyiCachedInputRate: 0.5,
    codexApiyiOutputRate: 30,
    codexApiyiLongContextThreshold: 278_528,
    codexApiyiLongUncachedInputRate: 10,
    codexApiyiLongCachedInputRate: 1,
    codexApiyiLongOutputRate: 45,
  } as ServerConfig;
}

async function createCodexHome(startedAtMs: number, events: unknown[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-priced-codex-'));
  const sessionDir = path.join(root, 'sessions', '2026', '08', '13');
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, 'rollout.jsonl'),
    `${events.map(JSON.stringify).join('\n')}\n`,
  );
  await fs.utimes(sessionDir, new Date(startedAtMs), new Date(startedAtMs));
  return root;
}

function tokenEvent(
  timestampMs: number,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
  reasoningOutputTokens: number,
) {
  return {
    timestamp: new Date(timestampMs).toISOString(),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: inputTokens,
          cached_input_tokens: cachedInputTokens,
          output_tokens: outputTokens,
          reasoning_output_tokens: reasoningOutputTokens,
          total_tokens: inputTokens + outputTokens,
        },
      },
    },
  };
}
