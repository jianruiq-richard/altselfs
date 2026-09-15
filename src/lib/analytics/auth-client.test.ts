import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID = 'G-TEST';

test('auth completion uses the server result, retries failures, and consumes the flow once', async () => {
  const { startAuthFlow, completePendingAuthFlow } = await import('./client.js');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalFetch = globalThis.fetch;
  const storage = new Map<string, string>();
  const events: unknown[][] = [];
  let consent = 'all';
  let calls = 0;
  let status = 200;
  let eventName: 'sign_up' | 'login' | null = 'sign_up';
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => consent },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    gtag: (...args: unknown[]) => events.push(args),
  } });
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ eventName }, { status });
  };
  const completions = () => events.filter(e => e[0] === 'event' && (e[1] === 'sign_up' || e[1] === 'login')).map(e => e[1]);
  try {
    startAuthFlow('login', 'google_oauth');
    await Promise.all([completePendingAuthFlow(true), completePendingAuthFlow(true)]);
    assert.equal(calls, 1);
    assert.deepEqual(completions(), ['sign_up']);
    await completePendingAuthFlow(false);
    assert.equal(calls, 1);

    eventName = 'login';
    startAuthFlow('sign_up', 'google_oauth');
    status = 503;
    await completePendingAuthFlow(false);
    assert.equal(storage.size, 1);
    status = 200;
    await completePendingAuthFlow(false);
    assert.deepEqual(completions(), ['sign_up', 'login']);
    assert.equal(storage.size, 0);

    consent = 'denied';
    const before = calls;
    await completePendingAuthFlow(true);
    assert.equal(calls, before);

    consent = 'all';
    eventName = 'sign_up';
    await completePendingAuthFlow(true);
    assert.deepEqual(completions(), ['sign_up', 'login', 'sign_up']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
