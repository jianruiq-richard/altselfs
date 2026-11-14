import assert from 'node:assert/strict';
import test from 'node:test';
import { identifyPostHogUser, normalizePostHogDistinctId, recordDesktopDownload } from './posthog.ts';

test('validates identifiers and sends the fixed download event', async () => {
  assert.equal(normalizePostHogDistinctId('anon-123'), 'anon-123');
  assert.equal(normalizePostHogDistinctId('email@example.com'), null);
  process.env.POSTHOG_PROJECT_KEY = 'phc_localtest';
  process.env.POSTHOG_HOST = 'https://analytics.test';
  const requests: Array<{url:string; body:Record<string, unknown>}> = [];
  const previousFetch = global.fetch;
  global.fetch = (async (input, init) => {
    requests.push({url:String(input), body:JSON.parse(String(init?.body))});
    return new Response('{}', {status:200});
  }) as typeof fetch;
  try {
    assert.equal(await recordDesktopDownload('anon-123', {version:'0.13.24',platform:'darwin-arm64'}), true);
    assert.equal(requests[0].url, 'https://analytics.test/i/v0/e/');
    assert.equal(requests[0].body.event, 'desktop_downloaded');
    assert.deepEqual(requests[0].body.properties, {
      distinct_id:'anon-123', $geoip_disable:true, surface:'website', environment:'production',
      app_version:'0.13.24', platform:'darwin-arm64',
    });
  } finally {
    global.fetch = previousFetch;
  }
});

test('identifies a consented anonymous browser with an opaque account ID', async () => {
  process.env.POSTHOG_PROJECT_KEY = 'phc_localtest';
  process.env.POSTHOG_HOST = 'https://analytics.test';
  let body: Record<string, unknown> | null = null;
  const previousFetch = global.fetch;
  global.fetch = (async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response('{}', {status:200});
  }) as typeof fetch;
  try {
    assert.equal(await identifyPostHogUser('user_123', 'anon-123'), true);
    assert.equal(body?.event, '$identify');
    assert.equal((body?.properties as Record<string, unknown>).distinct_id, 'user_123');
    assert.equal((body?.properties as Record<string, unknown>).$anon_distinct_id, 'anon-123');
    assert.equal(await identifyPostHogUser('user_123', 'not an id'), false);
  } finally {
    global.fetch = previousFetch;
  }
});
