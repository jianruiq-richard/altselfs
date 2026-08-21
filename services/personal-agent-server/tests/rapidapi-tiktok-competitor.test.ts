import assert from 'node:assert/strict';
import test from 'node:test';
import type { ServerConfig } from '../src/config.js';
import {
  createRapidApiCompetitorDynamictools,
  getRapidApiCompetitortoolNamesForProviders,
  runRapidApiCompetitortool,
} from '../src/tools/rapidapi-competitor.js';

const config = {
  rapidApiKeyEnv: 'TEST_RAPIDAPI_KEY',
  rapidApiRequestTimeoutMs: 5_000,
} as unknown as ServerConfig;

test('TikTok API23 is registered as one general-purpose information-source tool', () => {
  assert.deepEqual(
    getRapidApiCompetitortoolNamesForProviders(['tiktok_api23']),
    ['altselfs_tiktok_api23']
  );
  const tools = createRapidApiCompetitorDynamictools(['tiktok_api23']);
  assert.deepEqual(tools.map((tool) => tool.name), ['altselfs_tiktok_api23']);
  const schema = tools[0].inputSchema as { properties: { operation: { enum: string[] } } };
  assert.deepEqual(schema.properties.operation.enum, [
    'account_search',
    'user_info',
    'user_posts',
    'video_search',
    'post_discover',
  ]);
});

test('TikTok API23 validates only the parameters required by the selected operation', async () => {
  const originalKey = process.env.TEST_RAPIDAPI_KEY;
  process.env.TEST_RAPIDAPI_KEY = 'configured-for-test';
  try {
    const resultText = await runRapidApiCompetitortool(
      'altselfs_tiktok_api23',
      { operation: 'post_discover' },
      config
    );
    const result = JSON.parse(resultText) as { data: { error: string } };
    assert.equal(result.data.error, 'keyword is required.');
  } finally {
    if (originalKey === undefined) delete process.env.TEST_RAPIDAPI_KEY;
    else process.env.TEST_RAPIDAPI_KEY = originalKey;
  }
});

test('TikTok API23 passes caller parameters through and applies only an explicit publication filter', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TEST_RAPIDAPI_KEY;
  process.env.TEST_RAPIDAPI_KEY = 'configured-for-test';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/user/posts');
    assert.equal(url.searchParams.get('secUid'), 'caller-supplied-sec-uid');
    assert.equal(url.searchParams.get('count'), '20');
    assert.equal(url.searchParams.get('cursor'), 'opaque-cursor');
    return new Response(JSON.stringify({
      data: {
        cursor: 'next-cursor',
        hasMore: true,
        itemList: [
          post('in-range', '2026-08-12T09:00:00.000Z'),
          post('outside-range', '2026-08-18T09:00:00.000Z'),
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const resultText = await runRapidApiCompetitortool(
      'altselfs_tiktok_api23',
      {
        operation: 'user_posts',
        secUid: 'caller-supplied-sec-uid',
        count: 20,
        cursor: 'opaque-cursor',
        since: '2026-08-09T16:00:00.000Z',
        until: '2026-08-16T15:59:59.999Z',
      },
      config
    );
    const result = JSON.parse(resultText) as {
      data: {
        operation: string;
        request: Record<string, string>;
        publicationWindow: Record<string, string>;
        response: { data: { cursor: string; hasMore: boolean; itemList: Array<{ id: string }> } };
      };
    };

    assert.equal(result.data.operation, 'user_posts');
    assert.deepEqual(result.data.request, {
      secUid: 'caller-supplied-sec-uid',
      cursor: 'opaque-cursor',
      count: '20',
    });
    assert.deepEqual(result.data.publicationWindow, {
      since: '2026-08-09T16:00:00.000Z',
      until: '2026-08-16T15:59:59.999Z',
      interpretation: 'explicit_range',
    });
    assert.equal(result.data.response.data.cursor, 'next-cursor');
    assert.equal(result.data.response.data.hasMore, true);
    assert.deepEqual(result.data.response.data.itemList.map((item) => item.id), ['in-range']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TEST_RAPIDAPI_KEY;
    else process.env.TEST_RAPIDAPI_KEY = originalKey;
  }
});

test('TikTok API23 post discovery does not infer brands or classify returned posts', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TEST_RAPIDAPI_KEY;
  process.env.TEST_RAPIDAPI_KEY = 'configured-for-test';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/post/discover');
    assert.equal(url.searchParams.get('keyword'), 'caller chosen phrase');
    assert.equal(url.searchParams.get('page'), '3');
    return new Response(JSON.stringify({
      videoList: [{
        ...post('candidate', '2026-08-14T12:30:00.000Z'),
        desc: 'Raw creator caption',
        isAd: true,
      }],
      hasMore: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const resultText = await runRapidApiCompetitortool(
      'altselfs_tiktok_api23',
      { operation: 'post_discover', keyword: 'caller chosen phrase', page: 3 },
      config
    );
    const result = JSON.parse(resultText) as {
      data: { response: { videoList: Array<Record<string, unknown>> } };
    };
    assert.equal(result.data.response.videoList[0].desc, 'Raw creator caption');
    assert.equal(result.data.response.videoList[0].isAd, true);
    assert.equal('promotionConfidence' in result.data.response.videoList[0], false);
    assert.equal('classification' in result.data.response.videoList[0], false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TEST_RAPIDAPI_KEY;
    else process.env.TEST_RAPIDAPI_KEY = originalKey;
  }
});

function post(id: string, publishedAt: string) {
  return {
    id,
    createTime: Math.floor(Date.parse(publishedAt) / 1_000),
    desc: id,
    author: { uniqueId: 'source_account' },
    statsV2: { playCount: '100' },
  };
}
