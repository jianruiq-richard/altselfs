import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import {
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
