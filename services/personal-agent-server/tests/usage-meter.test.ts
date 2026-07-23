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
  assert.equal(usage.hermes.billedCostUsd, 0.03761145);
  assert.equal(usage.hermes.credits, 76);
  assert.equal(usage.totalCredits, 76);
  assert.deepEqual(usage.hermes.pricing, {
    source: 'apiyi-claude-sonnet-4-6',
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.3,
    cacheWriteUsdPerMillion: 6,
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
  assert.equal(usage.hermes.billedCostUsd, 0.027645);
  assert.equal(usage.hermes.credits, 56);
  assert.equal(usage.totalCredits, 56);
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
    hermesApiyiCacheWriteRate: 6,
    hermesApiyiCostMultiplier: 0.95,
    codexUsageUncachedInputRate: 125,
    codexUsageCachedInputRate: 12.5,
    codexUsageOutputRate: 750,
    codexUsageCreditMultiplier: 7.5,
  } as ServerConfig;
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
