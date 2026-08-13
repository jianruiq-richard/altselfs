import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BrokeredOpenAiAuthSession,
  OpenAiAuthBroker,
  type OpenAiRefreshRequest,
} from '../src/codex/openai-auth-broker.js';
import type { CodexJsonRpcClient } from '../src/codex/json-rpc-client.js';

const NOW_MS = Date.parse('2026-08-13T08:00:00.000Z');

test('fresh shared auth can be read concurrently without refreshing', async () => {
  const fixture = await createAuthFixture({ expiresAtMs: NOW_MS + 60 * 60_000 });
  let refreshCalls = 0;
  try {
    const brokers = Array.from({ length: 3 }, () => new OpenAiAuthBroker({
      sourcePath: fixture.authPath,
      now: () => NOW_MS,
      refreshRequest: async () => {
        refreshCalls += 1;
        throw new Error('unexpected refresh');
      },
    }));
    const results = await Promise.all(brokers.map((broker) => broker.getAuth()));
    assert.equal(refreshCalls, 0);
    assert.deepEqual(results, Array.from({ length: 3 }, () => ({
      accessToken: fixture.accessToken,
      chatgptAccountId: 'account-old',
      chatgptPlanType: 'pro',
    })));
  } finally {
    await fixture.cleanup();
  }
});

test('three concurrent brokers rotate a single-use refresh token only once', async () => {
  const fixture = await createAuthFixture({ expiresAtMs: NOW_MS - 60_000 });
  const nextAccessToken = jwt({
    exp: Math.floor((NOW_MS + 60 * 60_000) / 1000),
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'account-old',
      chatgpt_plan_type: 'business',
    },
  });
  let refreshCalls = 0;
  let observedRefreshToken = '';
  const refreshRequest = async (request: OpenAiRefreshRequest) => {
    refreshCalls += 1;
    observedRefreshToken = request.refreshToken;
    await delay(40);
    return {
      access_token: nextAccessToken,
      refresh_token: 'refresh-new',
      id_token: jwt({
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'account-old',
          chatgpt_plan_type: 'business',
        },
      }),
    };
  };

  try {
    const brokers = Array.from({ length: 3 }, () => new OpenAiAuthBroker({
      sourcePath: fixture.authPath,
      now: () => NOW_MS,
      lockPollMs: 10,
      refreshRequest,
    }));
    const results = await Promise.all(brokers.map((broker) => broker.getAuth()));
    assert.equal(refreshCalls, 1);
    assert.equal(observedRefreshToken, 'refresh-old');
    assert.deepEqual(results, Array.from({ length: 3 }, () => ({
      accessToken: nextAccessToken,
      chatgptAccountId: 'account-old',
      chatgptPlanType: 'business',
    })));

    const saved = JSON.parse(await fs.readFile(fixture.authPath, 'utf8')) as Record<string, unknown>;
    const tokens = saved.tokens as Record<string, unknown>;
    assert.equal(tokens.access_token, nextAccessToken);
    assert.equal(tokens.refresh_token, 'refresh-new');
    assert.equal(saved.preserved, 'yes');
    assert.equal((await fs.stat(fixture.authPath)).mode & 0o777, 0o600);
  } finally {
    await fixture.cleanup();
  }
});

test('an unauthorized waiter reuses a token already refreshed by another process', async () => {
  const fixture = await createAuthFixture({ expiresAtMs: NOW_MS + 60 * 60_000 });
  const nextAccessToken = jwt({
    exp: Math.floor((NOW_MS + 2 * 60 * 60_000) / 1000),
    'https://api.openai.com/auth': { chatgpt_account_id: 'account-old', chatgpt_plan_type: 'pro' },
  });
  let refreshCalls = 0;
  try {
    const broker = new OpenAiAuthBroker({
      sourcePath: fixture.authPath,
      now: () => NOW_MS,
      refreshRequest: async () => {
        refreshCalls += 1;
        throw new Error('unexpected duplicate refresh');
      },
    });
    const first = await broker.getAuth();
    await writeAuth(fixture.authPath, {
      accessToken: nextAccessToken,
      refreshToken: 'refresh-new',
      accountId: 'account-old',
      planType: 'pro',
    });
    const refreshed = await broker.refreshAfterUnauthorized(first.accessToken);
    assert.equal(refreshCalls, 0);
    assert.equal(refreshed.accessToken, nextAccessToken);
  } finally {
    await fixture.cleanup();
  }
});

test('broker session logs in through external auth and answers Codex refresh requests', async () => {
  const fixture = await createAuthFixture({ expiresAtMs: NOW_MS + 60 * 60_000 });
  const nextAccessToken = jwt({
    exp: Math.floor((NOW_MS + 2 * 60 * 60_000) / 1000),
    'https://api.openai.com/auth': { chatgpt_account_id: 'account-old', chatgpt_plan_type: 'pro' },
  });
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const responses: Array<{ id: unknown; result: Record<string, unknown> }> = [];
  const client = {
    request: async (method: string, params: Record<string, unknown>) => {
      requests.push({ method, params });
      return {};
    },
    respond: (id: unknown, result: Record<string, unknown>) => responses.push({ id, result }),
    respondError: () => assert.fail('refresh should not fail'),
  } as unknown as CodexJsonRpcClient;

  try {
    const session = new BrokeredOpenAiAuthSession(new OpenAiAuthBroker({
      sourcePath: fixture.authPath,
      now: () => NOW_MS,
      refreshRequest: async () => ({
        access_token: nextAccessToken,
        refresh_token: 'refresh-new',
      }),
    }));
    await session.login(client);
    assert.deepEqual(requests, [{
      method: 'account/login/start',
      params: {
        type: 'chatgptAuthTokens',
        accessToken: fixture.accessToken,
        chatgptAccountId: 'account-old',
        chatgptPlanType: 'pro',
      },
    }]);

    assert.equal(await session.handleServerRequest(client, {
      id: 17,
      method: 'account/chatgptAuthTokens/refresh',
      params: { reason: 'unauthorized', previousAccountId: 'account-old' },
    }), true);
    assert.deepEqual(responses, [{
      id: 17,
      result: {
        accessToken: nextAccessToken,
        chatgptAccountId: 'account-old',
        chatgptPlanType: 'pro',
      },
    }]);
    assert.equal(await session.handleServerRequest(client, { id: 18, method: 'item/tool/call' }), false);
  } finally {
    await fixture.cleanup();
  }
});

async function createAuthFixture(input: { expiresAtMs: number }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-openai-auth-broker-'));
  const authPath = path.join(dir, 'auth.json');
  const accessToken = jwt({
    exp: Math.floor(input.expiresAtMs / 1000),
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'account-old',
      chatgpt_plan_type: 'pro',
    },
  });
  await writeAuth(authPath, {
    accessToken,
    refreshToken: 'refresh-old',
    accountId: 'account-old',
    planType: 'pro',
  });
  return {
    authPath,
    accessToken,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

async function writeAuth(
  authPath: string,
  input: { accessToken: string; refreshToken: string; accountId: string; planType: string }
) {
  const idToken = jwt({
    'https://api.openai.com/auth': {
      chatgpt_account_id: input.accountId,
      chatgpt_plan_type: input.planType,
    },
  });
  await fs.writeFile(authPath, `${JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      id_token: idToken,
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
      account_id: input.accountId,
    },
    last_refresh: '2026-08-13T07:00:00.000Z',
    preserved: 'yes',
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function jwt(claims: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.signature`;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
