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

test('Instagram competitor activity is scoped to the Instagram information source', () => {
  assert.deepEqual(
    getRapidApiCompetitortoolNamesForProviders(['instagram_looter2']),
    ['altselfs_instagram_competitor_activity']
  );
  assert.deepEqual(
    createRapidApiCompetitorDynamictools(['instagram_looter2']).map((tool) => tool.name),
    ['altselfs_instagram_competitor_activity']
  );
  assert.deepEqual(createRapidApiCompetitorDynamictools(['similarweb_api1']).map((tool) => tool.name), [
    'altselfs_similarweb_api1',
  ]);
});

test('Instagram competitor activity resolves a domain and normalizes official and KOC posts', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TEST_RAPIDAPI_KEY;
  process.env.TEST_RAPIDAPI_KEY = 'configured-for-test';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const body = mockInstagramResponse(url);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const resultText = await runRapidApiCompetitortool(
      'altselfs_instagram_competitor_activity',
      {
        target: 'figurelabs.ai',
        since: '2026-08-14T00:00:00.000Z',
        until: '2026-08-21T23:59:59.999Z',
        includeOfficial: true,
        includeKoc: true,
      },
      config
    );
    const result = JSON.parse(resultText) as {
      data: {
        resolution: { username: string; matchReason: string };
        official: { count: number; posts: Array<Record<string, unknown>> };
        koc: { count: number; posts: Array<Record<string, unknown>> };
      };
    };

    assert.equal(result.data.resolution.username, 'figurelabs_ai');
    assert.equal(result.data.resolution.matchReason, 'profile_website_matches_target_domain');
    assert.equal(result.data.official.count, 1);
    assert.equal(result.data.official.posts[0].permalink, 'https://www.instagram.com/reel/OFFICIAL1/');
    assert.equal(result.data.official.posts[0].viewCount, 500);
    assert.deepEqual(result.data.official.posts[0].sourceTypes, ['official_feed', 'official_reel']);
    assert.equal(result.data.koc.count, 1);
    assert.equal(result.data.koc.posts[0].authorUsername, 'creator_one');
    assert.equal(result.data.koc.posts[0].promotionConfidence, 'high');
    assert.deepEqual(result.data.koc.posts[0].promotionSignals, [
      'official_account_tagged',
      'paid_or_collaboration_language',
      'affiliate_or_reward_offer',
      'conversion_call_to_action',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TEST_RAPIDAPI_KEY;
    else process.env.TEST_RAPIDAPI_KEY = originalKey;
  }
});

function mockInstagramResponse(url: URL) {
  if (url.pathname === '/search') {
    return {
      status: 'ok',
      users: [{ position: 1, user: { id: '41250599122', username: 'figurelabs_ai', full_name: 'FigureLabs.studio' } }],
    };
  }
  if (url.pathname === '/profile') {
    return {
      status: true,
      id: '41250599122',
      username: 'figurelabs_ai',
      full_name: 'FigureLabs.studio',
      external_url: 'https://www.figurelabs.ai/',
      biography: 'Science, made visual',
      edge_followed_by: { count: 32 },
      edge_follow: { count: 12 },
      is_professional_account: true,
      is_private: false,
      is_verified: false,
    };
  }
  if (url.pathname === '/user-feeds2') {
    return {
      data: {
        user: {
          edge_owner_to_timeline_media: {
            edges: [{
              node: {
                id: 'official-id',
                shortcode: 'OFFICIAL1',
                owner: { id: '41250599122', username: 'figurelabs_ai' },
                taken_at_timestamp: 1787220146,
                is_video: true,
                product_type: 'clips',
                video_view_count: 200,
                edge_media_preview_like: { count: 20 },
                edge_media_to_comment: { count: 2 },
                edge_media_to_caption: { edges: [{ node: { text: 'Official launch Reel' } }] },
              },
            }],
          },
        },
      },
      status: 'ok',
    };
  }
  if (url.pathname === '/reels') {
    return {
      items: [{
        media: {
          pk: 'official-id',
          code: 'OFFICIAL1',
          user: { username: 'figurelabs_ai' },
          taken_at: 1787220146,
          product_type: 'clips',
          play_count: 500,
          like_count: 21,
          comment_count: 2,
          caption: { text: 'Official launch Reel' },
          coauthor_producers: [],
          is_paid_partnership: false,
        },
      }],
    };
  }
  if (url.pathname === '/user-tags') {
    return {
      data: {
        user: {
          edge_user_to_photos_of_you: {
            edges: [{
              node: {
                id: 'koc-id',
                shortcode: 'KOC1',
                owner: { id: 'creator-id', username: 'creator_one' },
                taken_at_timestamp: 1787170255,
                is_video: true,
                product_type: 'clips',
                video_view_count: 9_538,
                edge_liked_by: { count: 467 },
                edge_media_to_comment: { count: 161 },
                edge_media_to_caption: {
                  edges: [{
                    node: {
                      text: 'In collaboration with @figurelabs_ai. Comment LINK and use code=BONUS for extra credits.',
                    },
                  }],
                },
              },
            }],
          },
        },
      },
      status: 'ok',
    };
  }
  throw new Error(`Unexpected Instagram test endpoint: ${url.pathname}`);
}
