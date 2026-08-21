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

test('X competitor activity is scoped to the Twitter241 information source', () => {
  assert.deepEqual(
    getRapidApiCompetitortoolNamesForProviders(['twitter241']),
    ['altselfs_x_competitor_activity']
  );
  assert.deepEqual(
    createRapidApiCompetitorDynamictools(['twitter241']).map((tool) => tool.name),
    ['altselfs_x_competitor_activity']
  );
});

test('X competitor activity requires an explicit caller-supplied time range', async () => {
  const originalKey = process.env.TEST_RAPIDAPI_KEY;
  process.env.TEST_RAPIDAPI_KEY = 'configured-for-test';
  try {
    const resultText = await runRapidApiCompetitortool(
      'altselfs_x_competitor_activity',
      { target: 'example.ai' },
      config
    );
    const result = JSON.parse(resultText) as { data: { error: string } };
    assert.equal(result.data.error, 'since and until is required.');
  } finally {
    if (originalKey === undefined) delete process.env.TEST_RAPIDAPI_KEY;
    else process.env.TEST_RAPIDAPI_KEY = originalKey;
  }
});

test('X competitor activity resolves by profile domain, paginates, filters exactly, and separates official, KOC, and organic posts', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TEST_RAPIDAPI_KEY;
  process.env.TEST_RAPIDAPI_KEY = 'configured-for-test';
  const requestedUrls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    return new Response(JSON.stringify(mockTwitter241Response(url)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const resultText = await runRapidApiCompetitortool(
      'altselfs_x_competitor_activity',
      {
        target: 'example.ai',
        keywords: ['Example Create'],
        since: '2026-08-09T16:00:00.000Z',
        until: '2026-08-16T15:59:59.999Z',
        includeOfficial: true,
        includeKoc: true,
        includeOrganic: true,
        includeReplies: true,
        maxPages: 3,
        pageSize: 20,
        maxResults: 20,
      },
      config
    );
    const result = JSON.parse(resultText) as {
      data: {
        window: { since: string; until: string; interpretation: string };
        resolution: {
          username: string;
          userId: string;
          matchReason: string;
          profileWebsiteUrls: string[];
        };
        official: { count: number; posts: Array<Record<string, unknown>> };
        koc: { count: number; posts: Array<Record<string, unknown>>; classification: string };
        organic: { count: number; posts: Array<Record<string, unknown>> };
        coverage: {
          apiCallCount: number;
          searchQueries: string[];
          collections: Array<Record<string, unknown>>;
          errors: unknown[];
        };
      };
    };

    assert.deepEqual(result.data.window, {
      since: '2026-08-09T16:00:00.000Z',
      until: '2026-08-16T15:59:59.999Z',
      interpretation: 'explicit_range',
    });
    assert.equal(result.data.resolution.username, 'ExampleStudio');
    assert.equal(result.data.resolution.userId, 'official-user-id');
    assert.equal(result.data.resolution.matchReason, 'profile_website_matches_target_domain');
    assert.deepEqual(result.data.resolution.profileWebsiteUrls, ['https://example.ai/']);

    assert.equal(result.data.official.count, 2);
    assert.deepEqual(
      result.data.official.posts.map((post) => post.id),
      ['official-reply-in-range', 'official-post-in-range']
    );
    assert.equal(result.data.official.posts[1].permalink, 'https://x.com/ExampleStudio/status/official-post-in-range');
    assert.equal(result.data.official.posts[1].viewCount, 12_345);

    assert.equal(result.data.koc.count, 1);
    assert.equal(result.data.koc.posts[0].id, 'creator-promo-in-range');
    assert.equal(result.data.koc.posts[0].authorUsername, 'CreatorOne');
    assert.equal(result.data.koc.posts[0].promotionConfidence, 'high');
    assert.deepEqual(result.data.koc.posts[0].promotionSignals, [
      'brand_link_in_post',
      'brand_keyword_search_result',
      'tracking_or_affiliate_link',
      'tracking_attribution_matches_author',
      'paid_or_collaboration_language',
      'affiliate_or_discount_offer',
      'conversion_call_to_action',
      'creator_or_marketing_profile',
    ]);
    assert.match(result.data.koc.classification, /not proof of payment/i);

    assert.equal(result.data.organic.count, 1);
    assert.equal(result.data.organic.posts[0].id, 'organic-discussion-in-range');
    assert.equal(result.data.organic.posts[0].promotionConfidence, 'low');
    assert.ok(result.data.organic.posts[0].relevanceSignals instanceof Array);

    assert.deepEqual(result.data.coverage.searchQueries, [
      'Example Create',
      'example.ai',
      'example',
      '@ExampleStudio',
      'Example Studio',
    ]);
    assert.equal(result.data.coverage.apiCallCount, 9);
    assert.deepEqual(result.data.coverage.errors, []);
    assert.ok(requestedUrls.some((url) => url.pathname === '/search-v2' && url.searchParams.get('cursor') === 'example-next-page'));
    assert.ok(requestedUrls.every((url) => !url.search.toLowerCase().includes('az8')));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TEST_RAPIDAPI_KEY;
    else process.env.TEST_RAPIDAPI_KEY = originalKey;
  }
});

function mockTwitter241Response(url: URL) {
  if (url.pathname === '/user') {
    assert.equal(url.searchParams.get('username'), 'ExampleStudio');
    return { result: officialProfile() };
  }
  if (url.pathname === '/user-tweets') {
    assert.equal(url.searchParams.get('user'), 'official-user-id');
    return timeline([
      tweet({
        id: 'official-post-in-range',
        createdAt: 'Thu Aug 13 09:00:00 +0000 2026',
        text: 'Build your next scene with Example Create at https://t.co/launch',
        author: officialProfile(),
        urls: ['https://example.ai/launch'],
        views: 12_345,
      }),
      tweet({
        id: 'official-post-before-window',
        createdAt: 'Sat Aug 08 09:00:00 +0000 2026',
        text: 'Earlier Example update',
        author: officialProfile(),
      }),
    ]);
  }
  if (url.pathname === '/user-replies-v2') {
    assert.equal(url.searchParams.get('user'), 'official-user-id');
    return timeline([
      tweet({
        id: 'official-reply-in-range',
        createdAt: 'Fri Aug 14 10:00:00 +0000 2026',
        text: '@Customer Thanks for trying Example Create!',
        author: officialProfile(),
        isReply: true,
      }),
      tweet({
        id: 'official-reply-before-window',
        createdAt: 'Fri Aug 07 10:00:00 +0000 2026',
        text: '@Customer An earlier reply',
        author: officialProfile(),
        isReply: true,
      }),
    ]);
  }
  if (url.pathname === '/search-v2') {
    assert.equal(url.searchParams.get('type'), 'Latest');
    const query = url.searchParams.get('query');
    const cursor = url.searchParams.get('cursor');
    if (query === 'example.ai') {
      return timeline([
        tweet({
          id: 'official-seed-before-window',
          createdAt: 'Sat Aug 08 08:00:00 +0000 2026',
          text: 'The official Example site is https://t.co/site',
          author: officialProfile(),
          urls: ['https://example.ai/'],
        }),
      ]);
    }
    if (query === 'Example Create' && !cursor) {
      return timeline([
        tweet({
          id: 'creator-promo-in-range',
          createdAt: 'Sat Aug 15 12:00:00 +0000 2026',
          text: 'Sponsored by Example Create — try it now and use code CREATE20: https://t.co/offer',
          author: creatorProfile(),
          urls: ['https://example.ai/?utm_source=creatorone'],
          views: 8_765,
        }),
        tweet({
          id: 'organic-discussion-in-range',
          createdAt: 'Wed Aug 12 11:00:00 +0000 2026',
          text: 'Has anyone compared Example Create with the other image tools?',
          author: organicProfile(),
          views: 432,
        }),
        tweet({
          id: 'outside-window-after-end',
          createdAt: 'Mon Aug 17 11:00:00 +0000 2026',
          text: 'Example Create discussion after the requested week',
          author: organicProfile(),
        }),
      ], 'example-next-page');
    }
    if (query === 'Example Create' && cursor === 'example-next-page') {
      return timeline([
        tweet({
          id: 'creator-before-window',
          createdAt: 'Fri Aug 07 11:00:00 +0000 2026',
          text: 'An older Example Create post',
          author: creatorProfile(),
        }),
      ]);
    }
    if (query === 'example' || query === '@ExampleStudio' || query === 'Example Studio') return timeline([]);
  }
  throw new Error(`Unexpected Twitter241 request: ${url.toString()}`);
}

function timeline(tweets: Array<Record<string, unknown>>, bottomCursor = '') {
  return {
    cursor: bottomCursor ? { bottom: bottomCursor } : {},
    result: {
      timeline: {
        instructions: [{
          entries: tweets.map((value) => ({
            entryId: `tweet-${String(value.rest_id)}`,
            content: { itemContent: { tweet_results: { result: value } } },
          })),
        }],
      },
    },
    status: 'ok',
  };
}

function tweet(input: {
  id: string;
  createdAt: string;
  text: string;
  author: Record<string, unknown>;
  urls?: string[];
  views?: number;
  isReply?: boolean;
}) {
  return {
    rest_id: input.id,
    core: { user_results: { result: input.author } },
    views: { count: String(input.views ?? 100) },
    legacy: {
      id_str: input.id,
      created_at: input.createdAt,
      full_text: input.text,
      lang: 'en',
      entities: {
        urls: (input.urls || []).map((expanded_url) => ({ expanded_url })),
        hashtags: [],
      },
      favorite_count: 10,
      reply_count: 2,
      quote_count: 1,
      retweet_count: 3,
      bookmark_count: 4,
      ...(input.isReply ? { in_reply_to_status_id_str: 'parent-id' } : {}),
    },
  };
}

function officialProfile() {
  return {
    rest_id: 'official-user-id',
    core: { name: 'Example Studio', screen_name: 'ExampleStudio' },
    legacy: {
      description: 'The official account for Example Create.',
      followers_count: 1_630,
      entities: { url: { urls: [{ expanded_url: 'https://example.ai/' }] } },
    },
    is_blue_verified: true,
    professional: { professional_type: 'Business' },
  };
}

function creatorProfile() {
  return {
    rest_id: 'creator-user-id',
    core: { name: 'Creator One', screen_name: 'CreatorOne' },
    legacy: {
      description: 'AI creator. DM for collab.',
      followers_count: 50_000,
      entities: {},
    },
    professional: { professional_type: 'Creator' },
  };
}

function organicProfile() {
  return {
    rest_id: 'organic-user-id',
    core: { name: 'Product Observer', screen_name: 'ProductObserver' },
    legacy: {
      description: 'I discuss creative software.',
      followers_count: 800,
      entities: {},
    },
  };
}
