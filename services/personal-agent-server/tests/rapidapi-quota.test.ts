import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ServerConfig } from '../src/config.js';
import {
  getRapidApiQuotaSnapshots,
  runRapidApiCompetitortool,
} from '../src/tools/rapidapi-competitor.js';

const config = {
  rapidApiKeyEnv: 'TEST_RAPIDAPI_KEY',
  rapidApiRequestTimeoutMs: 5_000,
} as unknown as ServerConfig;

test('RapidAPI quota snapshots expose provider-neutral remaining, used, limit, and reset fields', async () => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-rapidapi-quota-'));
  const snapshotPath = path.join(tempDirectory, 'quota.json');
  const originalFetch = globalThis.fetch;
  const originalTestKey = process.env.TEST_RAPIDAPI_KEY;
  const originalRapidApiKey = process.env.RAPIDAPI_KEY;
  const originalSnapshotPath = process.env.RAPIDAPI_QUOTA_SNAPSHOT_PATH;
  process.env.TEST_RAPIDAPI_KEY = 'configured-for-test';
  process.env.RAPIDAPI_KEY = 'configured-for-ops-test';
  process.env.RAPIDAPI_QUOTA_SNAPSHOT_PATH = snapshotPath;
  globalThis.fetch = async () => new Response(null, {
    status: 204,
    headers: {
      'x-ratelimit-requests-limit': '100',
      'x-ratelimit-requests-remaining': '89',
      'x-ratelimit-requests-reset': '3600',
    },
  });

  try {
    await runRapidApiCompetitortool(
      'altselfs_tiktok_api23',
      { operation: 'user_info', uniqueId: 'figurelabs.ai' },
      config
    );
    const accounts = await getRapidApiQuotaSnapshots();
    const account = accounts.find((item) => item.account.includes('tiktok-api23.p.rapidapi.com'));
    assert.ok(account);
    assert.equal(account.balance, '89 / 100');
    assert.equal(account.status, 'ok');
    assert.deepEqual(
      {
        host: account.quota.host,
        limit: account.quota.limit,
        remaining: account.quota.remaining,
        used: account.quota.used,
        usedPercent: account.quota.usedPercent,
        reset: account.quota.reset,
        httpStatus: account.quota.httpStatus,
        sampled: account.quota.sampled,
      },
      {
        host: 'tiktok-api23.p.rapidapi.com',
        limit: 100,
        remaining: 89,
        used: 11,
        usedPercent: 11,
        reset: '3600s',
        httpStatus: 204,
        sampled: true,
      }
    );
    assert.ok(account.quota.sampledAt);
    assert.ok(account.quota.resetAt);
    assert.equal(
      Date.parse(account.quota.resetAt || '') - Date.parse(account.quota.sampledAt || ''),
      3_600_000
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment('TEST_RAPIDAPI_KEY', originalTestKey);
    restoreEnvironment('RAPIDAPI_KEY', originalRapidApiKey);
    restoreEnvironment('RAPIDAPI_QUOTA_SNAPSHOT_PATH', originalSnapshotPath);
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});

function restoreEnvironment(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
