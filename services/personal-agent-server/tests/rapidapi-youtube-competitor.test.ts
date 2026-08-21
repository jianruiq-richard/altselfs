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

test('YouTube competitor activity is scoped to the YouTube V2 information source', () => {
  assert.deepEqual(
    getRapidApiCompetitortoolNamesForProviders(['youtube_v2']),
    ['altselfs_youtube_competitor_activity']
  );
  assert.deepEqual(
    createRapidApiCompetitorDynamictools(['youtube_v2']).map((tool) => tool.name),
    ['altselfs_youtube_competitor_activity']
  );
});

test('YouTube competitor activity requires an explicit caller-supplied time range', async () => {
  const originalKey = process.env.TEST_RAPIDAPI_KEY;
  process.env.TEST_RAPIDAPI_KEY = 'configured-for-test';
  try {
    const resultText = await runRapidApiCompetitortool(
      'altselfs_youtube_competitor_activity',
      { target: 'za8.art' },
      config
    );
    const result = JSON.parse(resultText) as { data: { error: string } };
    assert.equal(result.data.error, 'since and until is required.');
  } finally {
    if (originalKey === undefined) delete process.env.TEST_RAPIDAPI_KEY;
    else process.env.TEST_RAPIDAPI_KEY = originalKey;
  }
});

test('YouTube competitor activity resolves the official channel and separates exact-range official and KOC videos', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TEST_RAPIDAPI_KEY;
  process.env.TEST_RAPIDAPI_KEY = 'configured-for-test';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    return new Response(JSON.stringify(mockYouTubeResponse(url)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const resultText = await runRapidApiCompetitortool(
      'altselfs_youtube_competitor_activity',
      {
        target: 'za8.art',
        channelName: 'AZ8 Studio',
        keywords: ['AZ8', 'az8.art'],
        since: '2026-08-09T16:00:00.000Z',
        until: '2026-08-16T15:59:59.999Z',
        includeOfficial: true,
        includeKoc: true,
        includeShorts: true,
        maxResults: 20,
      },
      config
    );
    const result = JSON.parse(resultText) as {
      data: {
        window: { since: string; until: string; interpretation: string };
        resolution: { channelId: string; title: string; matchReason: string };
        official: { count: number; videos: Array<Record<string, unknown>> };
        koc: { count: number; videos: Array<Record<string, unknown>>; classification: string };
        coverage: { apiCallCount: number; searchQueries: string[]; orderBy: string };
      };
    };

    assert.deepEqual(result.data.window, {
      since: '2026-08-09T16:00:00.000Z',
      until: '2026-08-16T15:59:59.999Z',
      interpretation: 'explicit_range',
    });
    assert.equal(result.data.resolution.channelId, 'UC_AZ8_OFFICIAL');
    assert.equal(result.data.resolution.title, 'AZ8 Studio');
    assert.equal(result.data.resolution.matchReason, 'exact_channel_name');
    assert.equal(result.data.official.count, 2);
    assert.deepEqual(
      result.data.official.videos.map((video) => video.videoId),
      ['official-short-in-range', 'official-video-in-range']
    );
    assert.equal(result.data.official.videos[0].viewCount, 12_345);
    assert.equal(result.data.official.videos[0].permalink, 'https://www.youtube.com/watch?v=official-short-in-range');
    assert.equal(result.data.koc.count, 1);
    assert.equal(result.data.koc.videos[0].videoId, 'koc-in-range');
    assert.equal(result.data.koc.videos[0].author, 'Creator One');
    assert.equal(result.data.koc.videos[0].publishedAt, '2026-08-14T12:30:00.000Z');
    assert.equal(result.data.koc.videos[0].promotionConfidence, 'high');
    assert.deepEqual(result.data.koc.videos[0].promotionSignals, [
      'brand_keyword_search_result',
      'brand_domain_mentioned',
      'brand_link_in_description',
      'tracking_or_affiliate_link',
      'paid_or_collaboration_language',
      'affiliate_or_discount_offer',
      'conversion_call_to_action',
      'brand_mentioned_in_metadata',
    ]);
    assert.deepEqual(result.data.coverage.searchQueries, ['AZ8 Studio', 'AZ8', 'az8.art', 'za8.art']);
    assert.equal(result.data.coverage.orderBy, 'this_month');
    assert.equal(result.data.coverage.apiCallCount, 12);
    assert.match(result.data.koc.classification, /not proof of payment/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TEST_RAPIDAPI_KEY;
    else process.env.TEST_RAPIDAPI_KEY = originalKey;
  }
});

function mockYouTubeResponse(url: URL) {
  if (url.pathname === '/search/' && !url.searchParams.has('order_by')) {
    assert.equal(url.searchParams.get('query'), 'AZ8 Studio');
    return {
      videos: [
        youtubeVideo({
          id: 'official-resolution-video',
          title: 'Welcome to AZ8',
          author: 'AZ8 Studio',
          channelId: 'UC_AZ8_OFFICIAL',
          publishedTime: '2 months ago',
          description: 'Welcome to AZ8 at az8.art',
        }),
        youtubeVideo({
          id: 'creator-resolution-video',
          title: 'AZ8 tutorial',
          author: 'Creator One',
          channelId: 'UC_CREATOR_ONE',
          publishedTime: '1 week ago',
          description: 'An AZ8 walkthrough',
        }),
      ],
    };
  }
  if (url.pathname === '/channel/details') {
    const channelId = url.searchParams.get('channel_id');
    if (channelId === 'UC_AZ8_OFFICIAL') {
      return {
        channel_id: channelId,
        title: 'AZ8 Studio',
        description: 'Welcome to AZ8 — the creative AI platform at az8.art',
        number_of_subscribers: '1,234',
        number_of_videos: '25',
      };
    }
    return {
      channel_id: channelId,
      title: 'Creator One',
      description: 'Independent creator',
      number_of_subscribers: '50,000',
    };
  }
  if (url.pathname === '/channel/videos') {
    return {
      videos: [
        youtubeVideo({
          id: 'official-video-in-range',
          title: 'AZ8 official launch update',
          author: 'AZ8 Studio',
          channelId: 'UC_AZ8_OFFICIAL',
          publishedTime: '1 week ago',
          description: 'Official product update',
        }),
        youtubeVideo({
          id: 'official-video-old',
          title: 'Old AZ8 update',
          author: 'AZ8 Studio',
          channelId: 'UC_AZ8_OFFICIAL',
          publishedTime: '2 months ago',
          description: 'Old update',
        }),
      ],
    };
  }
  if (url.pathname === '/channel/shorts') {
    return {
      videos: [
        youtubeVideo({
          id: 'official-short-in-range',
          title: 'AZ8 in 30 seconds',
          author: 'AZ8 Studio',
          channelId: 'UC_AZ8_OFFICIAL',
          publishedTime: '',
          description: 'Official Short',
        }),
      ],
    };
  }
  if (url.pathname === '/search/' && url.searchParams.get('order_by') === 'this_month') {
    assert.ok(['AZ8 Studio', 'AZ8', 'az8.art', 'za8.art'].includes(url.searchParams.get('query') || ''));
    return {
      videos: [
        youtubeVideo({
          id: 'koc-in-range',
          title: 'I tried AZ8 for a week',
          author: 'Creator One',
          channelId: 'UC_CREATOR_ONE',
          publishedTime: '1 week ago',
          description: 'Sponsored by AZ8. Try it: https://az8.art/?utm_source=youtube — use code: CREATE',
        }),
        youtubeVideo({
          id: 'official-search-duplicate',
          title: 'AZ8 official launch update',
          author: 'AZ8 Studio',
          channelId: 'UC_AZ8_OFFICIAL',
          publishedTime: '1 week ago',
          description: 'Official result',
        }),
        youtubeVideo({
          id: 'irrelevant-result',
          title: 'A painting tutorial',
          author: 'Art Channel',
          channelId: 'UC_ART',
          publishedTime: '1 week ago',
          description: 'Unrelated result',
        }),
      ],
    };
  }
  if (url.pathname === '/video/details') {
    const id = url.searchParams.get('video_id') || '';
    const details: Record<string, { publishedAt: string; views: string }> = {
      'official-video-in-range': { publishedAt: '2026-08-12T09:00:00.000Z', views: '3,210' },
      'official-short-in-range': { publishedAt: '2026-08-15T10:00:00.000Z', views: '12,345' },
      'koc-in-range': { publishedAt: '2026-08-14T12:30:00.000Z', views: '9,876' },
    };
    const detail = details[id];
    if (!detail) throw new Error(`Unexpected video details request: ${id}`);
    const base = id === 'koc-in-range'
      ? {
          title: 'I tried AZ8 for a week',
          author: 'Creator One',
          channelId: 'UC_CREATOR_ONE',
          description: 'Sponsored by AZ8. Try it: https://az8.art/?utm_source=youtube — use code: CREATE',
        }
      : {
          title: id.includes('short') ? 'AZ8 in 30 seconds' : 'AZ8 official launch update',
          author: 'AZ8 Studio',
          channelId: 'UC_AZ8_OFFICIAL',
          description: 'Official AZ8 release',
        };
    return youtubeVideo({
      id,
      title: base.title,
      author: base.author,
      channelId: base.channelId,
      publishedTime: detail.publishedAt,
      description: base.description,
      views: detail.views,
    });
  }
  throw new Error(`Unexpected YouTube V2 endpoint: ${url.pathname}`);
}

function youtubeVideo(input: {
  id: string;
  title: string;
  author: string;
  channelId: string;
  publishedTime: string;
  description: string;
  views?: string;
}) {
  return {
    video_id: input.id,
    title: input.title,
    author: input.author,
    channel_id: input.channelId,
    published_time: input.publishedTime,
    description: input.description,
    number_of_views: input.views || '100',
    video_length: '42',
    type: 'video',
    keywords: /az8/i.test(`${input.title} ${input.description}`) ? ['AZ8'] : [],
  };
}
