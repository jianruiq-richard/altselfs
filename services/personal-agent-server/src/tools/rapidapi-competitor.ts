import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerConfig } from '../config.js';
import { isRecord } from '../util.js';

type ApparkPlatform = 0 | 1 | 2;

type ApparkAppCandidate = {
  app_id: string;
  app_name?: string;
  app_logo?: string;
  developer_name?: string;
  country?: string;
  platform: ApparkPlatform;
  platformLabel: string;
  cluster_id?: string;
  publish_store?: unknown;
};

type InstagramSearchCandidate = {
  id: string;
  username: string;
  fullName: string;
  position: number;
};

type InstagramActivityPost = {
  id: string;
  shortcode: string;
  permalink: string;
  authorUsername: string;
  authorFullName?: string;
  publishedAt: string | null;
  title: string;
  caption: string;
  mediaType: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  paidPartnership: boolean;
  coauthors: string[];
  sourceTypes: string[];
  promotionSignals: string[];
  promotionConfidence?: 'high' | 'medium' | 'low';
};

type YouTubeSearchCandidate = {
  channelId: string;
  title: string;
  description: string;
  position: number;
  score: number;
};

type YouTubeActivityVideo = {
  videoId: string;
  permalink: string;
  title: string;
  description: string;
  author: string;
  channelId: string;
  channelUrl: string;
  publishedAt: string | null;
  publishedTimeRaw?: string;
  durationSeconds: number | null;
  viewCount: number | null;
  category?: string;
  mediaType: string;
  keywords: string[];
  sourceTypes: string[];
  matchedQueries: string[];
  promotionSignals: string[];
  promotionConfidence?: 'high' | 'medium' | 'low';
};

type RapidApitoolSpec = {
  provider: string;
  source: string;
  host: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresRapidApiKey?: boolean;
  run: (args: Record<string, unknown>, config: ServerConfig) => Promise<unknown>;
};

const TOOLS: RapidApitoolSpec[] = [
  {
    provider: 'appark',
    source: 'appark',
    host: 'appark.ai',
    name: 'altselfs_appark_app_intelligence',
    description:
      'Use Appark public app analytics for mobile app market intelligence. Best for App Store and Google Play app search, app metadata, ratings, cumulative downloads, in-app purchases, 30-day download and revenue estimates, country split, and competitor app discovery.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'App name to search, for example MagicLight, Genspark, or CapCut.' },
        appId: { type: 'string', description: 'App Store numeric ID or Google Play package, for example 6748646938 or com.magiclight.app.' },
        platform: {
          type: 'string',
          enum: ['auto', 'ios', 'app_store', 'android', 'google_play'],
          description: 'Optional platform filter. Use auto unless the user asks for iOS/App Store or Android/Google Play specifically.',
        },
        country: { type: 'string', description: 'Two-letter country code for store-specific details. Defaults to us.' },
        searchSize: { type: 'number', description: 'Number of search candidates to return, from 1 to 20. Defaults to 10.' },
        includeDownloadRevenue: { type: 'boolean', description: 'Include Appark 30-day download/revenue estimates. Defaults to true.' },
        includeCompetitors: { type: 'boolean', description: 'Include Appark competitor app candidates. Defaults to true.' },
      },
      additionalProperties: false,
    },
    requiresRapidApiKey: false,
    run: async (args, config) => {
      const appName = readString(args.appName);
      const appId = readString(args.appId);
      if (!appName && !appId) return missingInput('appName or appId');
      return apparkAppIntelligence(args, config);
    },
  },
  {
    provider: 'instagram_looter2',
    source: 'instagram-looter2',
    host: 'instagram-looter2.p.rapidapi.com',
    name: 'altselfs_instagram_competitor_activity',
    description:
      'Track a competitor\'s recent Instagram promotion activity with RapidAPI Instagram Looter. Resolves the official Instagram account from a product name, domain, URL, or username; verifies the profile website; and returns normalized official posts/Reels plus tagged KOC or creator promotion candidates with dates, permalinks, engagement counts, and promotion signals. Best for day- or week-level acquisition monitoring.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Product name, domain, website URL, Instagram profile URL, or @username, for example figurelabs.ai.',
        },
        username: {
          type: 'string',
          description: 'Optional exact Instagram username when already known. This bypasses account search but still verifies the profile.',
        },
        since: {
          type: 'string',
          description: 'Inclusive ISO-8601 start timestamp supplied by the calling agent. Use an explicit timezone.',
        },
        until: {
          type: 'string',
          description: 'Inclusive ISO-8601 end timestamp supplied by the calling agent. Use an explicit timezone.',
        },
        includeOfficial: {
          type: 'boolean',
          description: 'Include posts and Reels published by the resolved official account. Defaults to true.',
        },
        includeKoc: {
          type: 'boolean',
          description: 'Include recent posts that tag the official account as KOC/creator promotion candidates. Defaults to true.',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum normalized results per section, from 1 to 100. Defaults to 50.',
        },
      },
      required: ['since', 'until'],
      additionalProperties: false,
    },
    run: async (args, config) => {
      const target = readString(args.target);
      const username = normalizeInstagramUsername(readString(args.username));
      if (!target && !username) return missingInput('target or username');
      if (!readString(args.since) || !readString(args.until)) return missingInput('since and until');
      return instagramCompetitorActivity(args, config);
    },
  },
  {
    provider: 'tiktok_api23',
    source: 'tiktok-api23',
    host: 'tiktok-api23.p.rapidapi.com',
    name: 'altselfs_tiktok_api23',
    description:
      'Call TikTok API23 as a general-purpose TikTok public-data source. Select one operation to search accounts, load a user profile, list a user\'s posts, search videos, or discover posts. The calling agent supplies identifiers, keywords, pagination, and any exact publication-time filter; the tool does not resolve brands, classify official/KOC activity, invent keywords, or choose a time range.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['account_search', 'user_info', 'user_posts', 'video_search', 'post_discover'],
          description: 'TikTok API23 operation to execute.',
        },
        keyword: {
          type: 'string',
          description: 'Caller-supplied query for account_search, video_search, or post_discover.',
        },
        uniqueId: {
          type: 'string',
          description: 'Exact TikTok handle without @ for user_info.',
        },
        secUid: {
          type: 'string',
          description: 'TikTok secUid for user_posts.',
        },
        cursor: {
          type: 'string',
          description: 'Optional opaque provider cursor for account_search, user_posts, or video_search.',
        },
        searchId: {
          type: 'string',
          description: 'Optional opaque search id returned by a previous search page.',
        },
        page: {
          type: 'number',
          description: 'Optional page number for post_discover.',
        },
        count: {
          type: 'number',
          description: 'Optional requested post count for user_posts, from 1 to the provider maximum of 35.',
        },
        since: {
          type: 'string',
          description: 'Optional inclusive ISO-8601 publication timestamp filter with an explicit timezone. Must be paired with until.',
        },
        until: {
          type: 'string',
          description: 'Optional inclusive ISO-8601 publication timestamp filter with an explicit timezone. Must be paired with since.',
        },
        maxItems: {
          type: 'number',
          description: 'Optional local cap for returned item arrays after filtering, from 1 to 100. Omit to preserve the provider page.',
        },
      },
      required: ['operation'],
      additionalProperties: false,
    },
    run: async (args, config) => {
      return tiktokApi23(args, config);
    },
  },
  {
    provider: 'youtube_v2',
    source: 'youtube-v2',
    host: 'youtube-v2.p.rapidapi.com',
    name: 'altselfs_youtube_competitor_activity',
    description:
      'Track a competitor\'s public YouTube promotion activity for an explicit caller-supplied time range with RapidAPI YouTube V2. Resolves the official channel and combines channel videos, Shorts, and keyword search into normalized official releases plus KOC or creator promotion candidates with exact publication dates, permalinks, views, and promotion signals. The calling agent must translate requests such as “last week” into exact since/until timestamps using the user\'s current date and timezone.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Product name, domain, website URL, YouTube channel URL, or channel name, for example az8.art.',
        },
        channelId: {
          type: 'string',
          description: 'Optional exact official YouTube channel id when already known.',
        },
        channelName: {
          type: 'string',
          description: 'Optional expected official channel name. Strongly recommended when the target domain is ambiguous or misspelled.',
        },
        since: {
          type: 'string',
          description: 'Inclusive ISO-8601 start timestamp supplied by the calling agent. Use an explicit timezone.',
        },
        until: {
          type: 'string',
          description: 'Inclusive ISO-8601 end timestamp supplied by the calling agent. Use an explicit timezone.',
        },
        includeOfficial: {
          type: 'boolean',
          description: 'Include videos and Shorts published by the resolved official channel. Defaults to true.',
        },
        includeKoc: {
          type: 'boolean',
          description: 'Include public keyword-discovered KOC or creator promotion candidates. Defaults to true.',
        },
        includeShorts: {
          type: 'boolean',
          description: 'Include Shorts from the resolved official channel. Defaults to true.',
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 5,
          description: 'Optional product names, corrected aliases, domains, or campaign keywords for channel resolution and KOC discovery.',
        },
        country: {
          type: 'string',
          description: 'Two-letter search country code. Defaults to US.',
        },
        lang: {
          type: 'string',
          description: 'Two-letter search language code. Defaults to en.',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum normalized results per section, from 1 to 30. Defaults to 20.',
        },
      },
      required: ['since', 'until'],
      additionalProperties: false,
    },
    run: async (args, config) => {
      const target = readString(args.target);
      const channelId = readString(args.channelId);
      const channelName = readString(args.channelName);
      if (!target && !channelId && !channelName) return missingInput('target, channelId, or channelName');
      if (!readString(args.since) || !readString(args.until)) return missingInput('since and until');
      return youtubeCompetitorActivity(args, config);
    },
  },
  {
    provider: 'similarweb_api1',
    source: 'similarweb-api1',
    host: 'similarweb-api1.p.rapidapi.com',
    name: 'altselfs_similarweb_api1',
    description:
      'Use RapidAPI similarweb-api1 visitsInfo for competitor traffic intelligence. Best for total visits, visit trend, countries, devices, engagement, traffic sources, keywords, AI traffic, and competitor/source discovery when covered.',
    inputSchema: domainInputSchema('Target domain, for example figurelabs.ai. Do not include protocol.'),
    run: async (args, config) => {
      const domain = normalizeDomain(readString(args.domain));
      if (!domain) return missingInput('domain');
      return rapidApiJson({
        config,
        host: 'similarweb-api1.p.rapidapi.com',
        url: 'https://similarweb-api1.p.rapidapi.com/v1/visitsInfo',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ q: domain }),
        },
        publicInput: { domain },
      });
    },
  },
  {
    provider: 'semrush13',
    source: 'semrush13',
    host: 'semrush13.p.rapidapi.com',
    name: 'altselfs_semrush13',
    description:
      'Use RapidAPI semrush13 domain-data for competitor intelligence. Best for covered domains with visits, growth history, search traffic, countries, devices, traffic journey, backlinks summary, keywords, competitors, and AI traffic. Does not provide backlink URL lists.',
    inputSchema: domainInputSchema('Target domain, for example magiclight.ai. Do not include protocol.'),
    run: async (args, config) => {
      const domain = normalizeDomain(readString(args.domain));
      if (!domain) return missingInput('domain');
      const url = new URL('https://semrush13.p.rapidapi.com/domain-data');
      url.searchParams.set('domain', domain);
      return rapidApiJson({
        config,
        host: 'semrush13.p.rapidapi.com',
        url: url.toString(),
        publicInput: { domain },
      });
    },
  },
  {
    provider: 'semrush8',
    source: 'semrush8',
    host: 'semrush8.p.rapidapi.com',
    name: 'altselfs_semrush8',
    description:
      'Use RapidAPI semrush8 url_traffic for lightweight SEO summary when richer sources do not cover the domain. Returns Semrush-like rank, keyword count, traffic estimate, cost estimate, and link counts.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target URL, for example https://figurelabs.ai/.' },
        domain: { type: 'string', description: 'Target domain. Used to construct https://domain/ if url is omitted.' },
      },
      additionalProperties: false,
    },
    run: async (args, config) => {
      const targetUrl = normalizeUrl(readString(args.url), readString(args.domain));
      if (!targetUrl) return missingInput('url or domain');
      const url = new URL('https://semrush8.p.rapidapi.com/url_traffic');
      url.searchParams.set('url', targetUrl);
      return rapidApiJson({
        config,
        host: 'semrush8.p.rapidapi.com',
        url: url.toString(),
        publicInput: { url: targetUrl },
      });
    },
  },
  {
    provider: 'ahrefs_url_research',
    source: 'ahrefs-url-research',
    host: 'ahrefs-url-research.p.rapidapi.com',
    name: 'altselfs_ahrefs_url_research',
    description:
      'Use RapidAPI Ahrefs URL Research url-metrics for URL-level SEO intelligence. Best for authority, backlinks, referring domains, organic keywords, traffic proxy, and URL/domain link footprint checks when covered.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target URL or domain, for example az8.art or az8.art/pricing. Protocol is optional.' },
        domain: { type: 'string', description: 'Target domain. Used when url is omitted.' },
      },
      additionalProperties: false,
    },
    run: async (args, config) => {
      const targetUrl = normalizeAhrefsUrlMetricTarget(readString(args.url), readString(args.domain));
      if (!targetUrl) return missingInput('url or domain');
      const url = new URL('https://ahrefs-url-research.p.rapidapi.com/url-metrics');
      url.searchParams.set('url', targetUrl);
      return rapidApiJson({
        config,
        host: 'ahrefs-url-research.p.rapidapi.com',
        url: url.toString(),
        init: {
          headers: { 'content-type': 'application/json' },
        },
        publicInput: { url: targetUrl },
      });
    },
  },
  {
    provider: 'domain_metrics_check',
    source: 'domain-metrics-check',
    host: 'domain-metrics-check.p.rapidapi.com',
    name: 'altselfs_domain_metrics_check',
    description:
      'Use RapidAPI Domain Metrics Check for SEO authority and backlink summary. Returns Moz, Majestic, and Ahrefs-style metrics such as DA, PA, spam score, Trust Flow, Citation Flow, DR, backlinks, referring domains, organic keywords, and traffic proxy.',
    inputSchema: domainInputSchema('Target domain, for example figurelabs.ai. Do not include protocol.'),
    run: async (args, config) => {
      const domain = normalizeDomain(readString(args.domain));
      if (!domain) return missingInput('domain');
      return rapidApiJson({
        config,
        host: 'domain-metrics-check.p.rapidapi.com',
        url: `https://domain-metrics-check.p.rapidapi.com/domain-metrics/${encodeURIComponent(domain)}/`,
        publicInput: { domain },
      });
    },
  },
];

export const RAPIDAPI_COMPETITOR_PROVIDER_TOOL_NAMES = Object.freeze(
  Object.fromEntries(TOOLS.map((tool) => [tool.provider, tool.name])) as Record<string, string>
);

export const RAPIDAPI_COMPETITOR_TOOL_PROVIDER_NAMES = Object.freeze(
  Object.fromEntries(TOOLS.map((tool) => [tool.name, tool.provider])) as Record<string, string>
);

export function getRapidApiCompetitortoolNamesForProviders(providers: Iterable<string>) {
  const enabled = new Set(Array.from(providers, (provider) => provider.toLowerCase()));
  return TOOLS.filter((tool) => enabled.has(tool.provider)).map((tool) => tool.name);
}

export function createRapidApiCompetitorDynamictools(providers?: Iterable<string>) {
  const enabled = providers ? new Set(Array.from(providers, (provider) => provider.toLowerCase())) : null;
  return TOOLS.filter((tool) => !enabled || enabled.has(tool.provider)).map((tool) => ({
    namespace: null,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    deferLoading: false,
  }));
}

export async function runRapidApiCompetitortool(toolName: string, argumentsValue: unknown, config: ServerConfig) {
  const tool = TOOLS.find((item) => item.name === toolName);
  if (!tool) return JSON.stringify({ source: 'rapidapi-competitor', error: `Unsupported tool: ${toolName}` });
  const args = isRecord(argumentsValue) ? argumentsValue : {};
  const requiresRapidApiKey = tool.requiresRapidApiKey !== false;
  const configured = !requiresRapidApiKey || Boolean(process.env[config.rapidApiKeyEnv]?.trim());
  const fetchedAt = new Date().toISOString();

  if (!configured) {
    return JSON.stringify({
      source: tool.source,
      fetchedAt,
      error: `RapidAPI platform key is not configured. Set ${config.rapidApiKeyEnv} before executing ${tool.name}.`,
      limitations: ['The competitive intelligence profile can see this tool, but the platform key is missing in this environment.'],
    }, null, 2);
  }

  try {
    const data = await tool.run(args, config);
    return JSON.stringify({
      source: tool.source,
      host: tool.host,
      fetchedAt,
      input: publicArgs(args),
      data,
      confidence: 'medium',
      limitations: tool.source === 'appark'
        ? [
            'Appark data is retrieved from public web endpoints rather than a contracted official API; endpoint behavior may change.',
            'Downloads, revenue, traffic, ranking, and competitor figures are third-party estimates or proxy signals; present them with source and confidence labels.',
          ]
        : tool.source === 'instagram-looter2'
          ? [
              'Instagram Looter is an independent third-party wrapper, not an official Meta API. Availability, fields, counts, and pagination may change without notice.',
              'Tagged posts are KOC or creator promotion candidates, not proof of payment. Use the returned promotion signals and captions to distinguish paid, gifted, affiliate, and organic mentions.',
              'The tool only reports public content returned by the provider in the requested window; private, deleted, untagged, story-only, or unindexed posts can be missing.',
            ]
        : tool.source === 'tiktok-api23'
          ? [
              'TikTok API23 is an independent unofficial third-party wrapper, not an official TikTok API. Availability, fields, counts, ordering, and pagination may change without notice.',
              'The tool returns public provider data without deciding which account is official or whether a post is paid, gifted, affiliate, KOC, or organic; the calling agent must make and label those assessments.',
              'TikTok content endpoints do not provide a server-side publication-date filter. When since/until are supplied, the tool filters the returned page by createTime, so deleted, private, unindexed, or lower-ranked posts can be missing.',
              'Engagement metrics are current cumulative snapshots rather than historical values at publication time.',
            ]
        : tool.source === 'youtube-v2'
          ? [
              'YouTube V2 is an independent third-party wrapper, not the official YouTube Data API. Availability, fields, result ordering, and pagination may change without notice.',
              'Keyword results are KOC or creator promotion candidates, not proof of payment. promotionSignals and promotionConfidence are evidence heuristics and must not be presented as proof of a commercial relationship.',
              'Search ranking and the provider page can omit deleted, private, unlisted, lower-ranked, or unindexed videos. Exact-range filtering is applied after video-detail timestamps are loaded.',
              'View counts are current cumulative snapshots rather than historical values at publication time.',
            ]
        : [
            'RapidAPI providers are third-party wrappers and may differ from official Semrush, Similarweb, Moz, Majestic, or Ahrefs APIs.',
            'Traffic, user, revenue, backlink, and keyword numbers are estimates or proxy signals; present them with source and confidence labels.',
          ],
    }, null, 2);
  } catch (error) {
    return JSON.stringify({
      source: tool.source,
      host: tool.host,
      fetchedAt,
      input: publicArgs(args),
      error: error instanceof Error ? error.message : String(error),
      limitations: tool.source === 'appark'
        ? ['The Appark public endpoint failed, changed behavior, rate-limited the request, or the app is not covered.']
        : tool.source === 'instagram-looter2'
          ? ['The Instagram Looter request failed, the provider rate-limited the request, the public account could not be resolved, or Instagram did not return the requested content.']
        : tool.source === 'tiktok-api23'
          ? ['The TikTok API23 request failed, the provider rate-limited the request, the free plan blocked the selected operation, or TikTok did not return the requested public data.']
        : tool.source === 'youtube-v2'
          ? ['The YouTube V2 request failed, the provider rate-limited the request, the free plan blocked an endpoint, the official channel could not be resolved, or YouTube did not return the requested public content.']
        : ['The RapidAPI request failed, the provider rate-limited the request, or the domain is not covered.'],
    }, null, 2);
  }
}

export function isRapidApiCompetitortool(toolName: string) {
  return TOOLS.some((tool) => tool.name === toolName);
}

function domainInputSchema(description: string) {
  return {
    type: 'object',
    properties: {
      domain: { type: 'string', description },
    },
    required: ['domain'],
    additionalProperties: false,
  };
}

async function rapidApiJson(input: {
  config: ServerConfig;
  host: string;
  url: string;
  init?: RequestInit;
  publicInput: Record<string, unknown>;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.rapidApiRequestTimeoutMs);
  try {
    const response = await fetch(input.url, {
      ...input.init,
      signal: controller.signal,
      headers: {
        ...(input.init?.headers || {}),
        'x-rapidapi-host': input.host,
        'x-rapidapi-key': process.env[input.config.rapidApiKeyEnv] || '',
      },
    });
    const text = await response.text();
    const body = parseBody(text);
    const quota = rapidApiQuotaFromHeaders(response.headers);
    await persistRapidApiQuota(input.host, quota, response.status).catch(() => null);
    if (!response.ok) {
      throw new Error(`RapidAPI request failed with HTTP ${response.status}: ${text.slice(0, 1000)}`);
    }
    return {
      request: input.publicInput,
      status: response.status,
      quota,
      body,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`RapidAPI request timed out after ${input.config.rapidApiRequestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getRapidApiQuotaSnapshots() {
  const configured = Boolean(process.env.RAPIDAPI_KEY?.trim());
  const data: Record<string, unknown> = await readRapidApiQuotaFile().catch(() => ({}));
  return TOOLS.filter((tool) => tool.requiresRapidApiKey !== false).map((tool) => {
    const rawQuota = data[tool.host];
    const quota: Record<string, unknown> | null = isRecord(rawQuota) ? rawQuota : null;
    const remaining = readNumber(quota?.remaining);
    const limit = readNumber(quota?.limit);
    const reset = typeof quota?.reset === 'string' ? quota.reset : '';
    return {
      provider: 'RapidAPI',
      account: `${tool.source} · ${tool.host}`,
      fingerprint: configured ? 'ECS key configured' : 'Not configured',
      balance: remaining !== null && limit !== null ? `${remaining.toLocaleString()} / ${limit.toLocaleString()}` : configured ? 'Unknown' : 'Not configured',
      usage: reset ? `reset ${reset}` : quota ? `HTTP ${String(quota.status || 'unknown')}` : 'No quota data',
      status: !configured ? 'unknown' : remaining === null || limit === null ? 'unknown' : remaining <= 0 ? 'critical' : remaining / limit < 0.1 ? 'warning' : 'ok',
      updatedAt: typeof quota?.updatedAt === 'string' ? quota.updatedAt : new Date().toISOString(),
      note: quota ? 'RapidAPI quota headers were returned.' : 'Quota headers were not returned.',
    };
  });
}

function rapidApiQuotaFromHeaders(headers: Headers) {
  const limit = headerNumber(headers, [
    'x-ratelimit-requests-limit',
    'x-ratelimit-limit',
    'x-rate-limit-limit',
    'ratelimit-limit',
  ]);
  const remaining = headerNumber(headers, [
    'x-ratelimit-requests-remaining',
    'x-ratelimit-remaining',
    'x-rate-limit-remaining',
    'ratelimit-remaining',
  ]);
  const resetRaw = headerValue(headers, [
    'x-ratelimit-requests-reset',
    'x-ratelimit-reset',
    'x-rate-limit-reset',
    'ratelimit-reset',
  ]);
  return {
    limit,
    remaining,
    reset: formatReset(resetRaw),
  };
}

async function persistRapidApiQuota(host: string, quota: { limit: number | null; remaining: number | null; reset: string }, status: number) {
  if (quota.limit === null && quota.remaining === null && !quota.reset) return;
  const filePath = rapidApiQuotaSnapshotPath();
  const current: Record<string, unknown> = await readRapidApiQuotaFile().catch(() => ({}));
  current[host] = {
    ...quota,
    status,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}

async function readRapidApiQuotaFile(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(rapidApiQuotaSnapshotPath(), 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function rapidApiQuotaSnapshotPath() {
  return process.env.RAPIDAPI_QUOTA_SNAPSHOT_PATH?.trim() || '/data/altselfs-agent/ops/rapidapi-quota.json';
}

function headerNumber(headers: Headers, keys: string[]) {
  const value = headerValue(headers, keys);
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readNumber(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function headerValue(headers: Headers, keys: string[]) {
  for (const key of keys) {
    const value = headers.get(key);
    if (value) return value;
  }
  return '';
}

function formatReset(value: string) {
  if (!value) return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  if (number > 1_000_000_000_000) return new Date(number).toISOString();
  if (number > 1_000_000_000) return new Date(number * 1000).toISOString();
  return `${number}s`;
}

function parseBody(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

const INSTAGRAM_LOOTER_HOST = 'instagram-looter2.p.rapidapi.com';

async function instagramCompetitorActivity(args: Record<string, unknown>, config: ServerConfig) {
  const target = readString(args.target);
  const requestedUsername = normalizeInstagramUsername(readString(args.username));
  const includeOfficial = args.includeOfficial !== false;
  const includeKoc = args.includeKoc !== false;
  const maxResults = clampInt(readNumber(args.maxResults), 1, 100, 50);
  const since = parseRequiredDate(readString(args.since));
  const until = parseRequiredDate(readString(args.until));
  if (!since || !until) {
    return { error: 'since and until must be valid ISO-8601 timestamps with an explicit timezone.' };
  }
  if (since.getTime() > until.getTime()) {
    return { error: 'since must be earlier than or equal to until.' };
  }

  const resolution = await resolveInstagramProfile({ target, requestedUsername, config });
  if (!resolution.username || !resolution.id) {
    return {
      request: { target: target || undefined, username: requestedUsername || undefined },
      window: { since: since.toISOString(), until: until.toISOString(), interpretation: 'explicit_range' },
      resolution,
      official: { count: 0, posts: [] },
      koc: { count: 0, posts: [] },
      error: 'No public Instagram profile with a usable user id could be resolved.',
    };
  }

  const endpointTasks: Array<{ label: string; run: () => Promise<unknown> }> = [];
  if (includeOfficial) {
    endpointTasks.push(
      {
        label: 'user-feeds2',
        run: () => instagramLooterGet('/user-feeds2', {
          id: resolution.id,
          count: String(Math.min(maxResults, 50)),
        }, config),
      },
      {
        label: 'reels',
        run: () => instagramLooterGet('/reels', {
          id: resolution.id,
          count: String(Math.min(maxResults, 50)),
          fields: [
            'items[].media.pk',
            'items[].media.code',
            'items[].media.taken_at',
            'items[].media.caption.text',
            'items[].media.user.username',
            'items[].media.user.full_name',
            'items[].media.like_count',
            'items[].media.comment_count',
            'items[].media.share_count',
            'items[].media.play_count',
            'items[].media.ig_play_count',
            'items[].media.product_type',
            'items[].media.coauthor_producers',
            'items[].media.is_paid_partnership',
            'next_max_id',
          ].join(','),
        }, config),
      }
    );
  }
  if (includeKoc) {
    endpointTasks.push({
      label: 'user-tags',
      run: () => instagramLooterGet('/user-tags', {
        id: resolution.id,
        count: String(Math.min(maxResults, 50)),
      }, config),
    });
  }

  const settled = await Promise.allSettled(endpointTasks.map((task) => task.run()));
  const bodies = new Map<string, unknown>();
  const errors: Array<{ endpoint: string; error: string }> = [];
  settled.forEach((result, index) => {
    const label = endpointTasks[index].label;
    if (result.status === 'fulfilled') bodies.set(label, result.value);
    else errors.push({ endpoint: label, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });

  const officialCandidates = includeOfficial
    ? mergeInstagramPosts([
        extractInstagramFeedPosts(bodies.get('user-feeds2'), resolution.username),
        extractInstagramReelPosts(bodies.get('reels'), resolution.username),
      ])
    : [];
  const kocCandidates = includeKoc
    ? extractInstagramTaggedPosts(bodies.get('user-tags'), resolution.username)
    : [];
  const official = filterInstagramPostsByWindow(officialCandidates, since, until).slice(0, maxResults);
  const koc = filterInstagramPostsByWindow(kocCandidates, since, until).slice(0, maxResults);

  return {
    request: {
      target: target || undefined,
      username: requestedUsername || undefined,
      includeOfficial,
      includeKoc,
      maxResults,
    },
    window: {
      since: since.toISOString(),
      until: until.toISOString(),
      interpretation: 'explicit_range',
    },
    resolution,
    official: {
      count: official.length,
      posts: official,
    },
    koc: {
      count: koc.length,
      posts: koc,
      classification:
        'Public posts tagging the verified official account are returned as KOC/creator promotion candidates. promotionSignals and promotionConfidence are heuristics, not proof of payment.',
    },
    coverage: {
      endpoints: endpointTasks.map((task) => task.label),
      rawOfficialCandidates: officialCandidates.length,
      rawTaggedCandidates: kocCandidates.length,
      errors,
    },
  };
}

async function resolveInstagramProfile(input: {
  target: string;
  requestedUsername: string;
  config: ServerConfig;
}) {
  const usernameFromTarget = extractInstagramUsername(input.target);
  const explicitUsername = input.requestedUsername || usernameFromTarget;
  const targetDomain = extractTargetDomain(input.target);
  let candidates: InstagramSearchCandidate[] = [];
  let searchError = '';

  if (explicitUsername) {
    candidates = [{ id: '', username: explicitUsername, fullName: '', position: 0 }];
  } else {
    const query = instagramSearchQuery(input.target);
    try {
      const search = await instagramLooterGet('/search', { query }, input.config);
      candidates = extractInstagramSearchCandidates(search, query);
    } catch (error) {
      searchError = error instanceof Error ? error.message : String(error);
    }
  }

  let fallback: { candidate: InstagramSearchCandidate; profile: Record<string, unknown> } | null = null;
  const attempts = explicitUsername ? candidates : candidates.slice(0, 5);
  for (const candidate of attempts) {
    try {
      const rawProfile = await instagramLooterGet('/profile', { username: candidate.username }, input.config);
      const profile = isRecord(rawProfile) ? rawProfile : {};
      const profileUsername = normalizeInstagramUsername(readString(profile.username)) || candidate.username;
      const profileId = readString(profile.id) || candidate.id;
      if (!profileUsername || !profileId) continue;
      const current = { candidate: { ...candidate, id: profileId, username: profileUsername }, profile };
      fallback ||= current;
      const externalDomain = extractTargetDomain(readString(profile.external_url));
      if (explicitUsername || !targetDomain || (externalDomain && externalDomain === targetDomain)) {
        return summarizeInstagramResolution({
          selected: current,
          targetDomain,
          candidates,
          matchReason: explicitUsername
            ? 'explicit_username'
            : externalDomain === targetDomain
              ? 'profile_website_matches_target_domain'
              : 'ranked_search_candidate',
          searchError,
        });
      }
    } catch (error) {
      if (!searchError) searchError = error instanceof Error ? error.message : String(error);
    }
  }

  if (fallback) {
    return summarizeInstagramResolution({
      selected: fallback,
      targetDomain,
      candidates,
      matchReason: 'ranked_search_candidate_unverified_domain',
      searchError,
    });
  }

  return {
    username: '',
    id: '',
    profileUrl: '',
    targetDomain: targetDomain || undefined,
    matchReason: 'not_resolved',
    alternatives: candidates.slice(0, 5),
    searchError: searchError || undefined,
  };
}

function summarizeInstagramResolution(input: {
  selected: { candidate: InstagramSearchCandidate; profile: Record<string, unknown> };
  targetDomain: string;
  candidates: InstagramSearchCandidate[];
  matchReason: string;
  searchError: string;
}) {
  const { candidate, profile } = input.selected;
  const followerEdge = isRecord(profile.edge_followed_by) ? profile.edge_followed_by : {};
  const followingEdge = isRecord(profile.edge_follow) ? profile.edge_follow : {};
  const externalUrl = readString(profile.external_url);
  return {
    username: candidate.username,
    id: readString(profile.id) || candidate.id,
    fullName: readString(profile.full_name) || candidate.fullName || undefined,
    profileUrl: `https://www.instagram.com/${candidate.username}/`,
    externalUrl: externalUrl || undefined,
    targetDomain: input.targetDomain || undefined,
    biography: truncate(readString(profile.biography), 500) || undefined,
    followers: nonNegativeNumber(followerEdge.count),
    following: nonNegativeNumber(followingEdge.count),
    isVerified: profile.is_verified === true,
    isProfessional: profile.is_professional_account === true,
    isPrivate: profile.is_private === true,
    matchReason: input.matchReason,
    alternatives: input.candidates
      .filter((item) => item.username !== candidate.username)
      .slice(0, 5),
    searchError: input.searchError || undefined,
  };
}

async function instagramLooterGet(pathname: string, params: Record<string, string>, config: ServerConfig) {
  const url = new URL(`https://${INSTAGRAM_LOOTER_HOST}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await rapidApiJson({
    config,
    host: INSTAGRAM_LOOTER_HOST,
    url: url.toString(),
    publicInput: { endpoint: pathname, ...params, fields: params.fields ? '[normalized fields]' : undefined },
  });
  return isRecord(response) ? response.body : null;
}

function extractInstagramSearchCandidates(value: unknown, query: string) {
  if (!isRecord(value) || !Array.isArray(value.users)) return [];
  const comparableQuery = normalizeInstagramComparable(query);
  return value.users
    .map((entry, index) => {
      if (!isRecord(entry)) return null;
      const user = isRecord(entry.user) ? entry.user : entry;
      const username = normalizeInstagramUsername(readString(user.username));
      if (!username) return null;
      const fullName = readString(user.full_name);
      const position = readNumber(entry.position) ?? index;
      const usernameComparable = normalizeInstagramComparable(username);
      const fullNameComparable = normalizeInstagramComparable(fullName);
      const score = Math.max(0, 30 - position)
        + (usernameComparable === comparableQuery ? 60 : usernameComparable.includes(comparableQuery) ? 40 : 0)
        + (fullNameComparable.startsWith(comparableQuery) ? 35 : fullNameComparable.includes(comparableQuery) ? 20 : 0);
      return {
        id: readString(user.id) || readString(user.pk),
        username,
        fullName,
        position,
        score,
      };
    })
    .filter((item): item is InstagramSearchCandidate & { score: number } => Boolean(item))
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .map(({ score: _score, ...candidate }) => candidate);
}

function extractInstagramFeedPosts(value: unknown, officialUsername: string) {
  if (!isRecord(value)) return [];
  const data = isRecord(value.data) ? value.data : {};
  const user = isRecord(data.user) ? data.user : {};
  const timeline = isRecord(user.edge_owner_to_timeline_media) ? user.edge_owner_to_timeline_media : {};
  const edges = Array.isArray(timeline.edges) ? timeline.edges : [];
  return edges
    .map((edge) => isRecord(edge) ? normalizeInstagramPost(edge.node, 'official_feed', officialUsername) : null)
    .filter((item): item is InstagramActivityPost => Boolean(item));
}

function extractInstagramReelPosts(value: unknown, officialUsername: string) {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  return value.items
    .map((item) => isRecord(item) ? normalizeInstagramPost(item.media || item, 'official_reel', officialUsername) : null)
    .filter((post): post is InstagramActivityPost => Boolean(post));
}

function extractInstagramTaggedPosts(value: unknown, officialUsername: string) {
  if (!isRecord(value)) return [];
  const data = isRecord(value.data) ? value.data : {};
  const user = isRecord(data.user) ? data.user : {};
  const tagged = isRecord(user.edge_user_to_photos_of_you) ? user.edge_user_to_photos_of_you : {};
  const edges = Array.isArray(tagged.edges) ? tagged.edges : [];
  return edges
    .map((edge) => isRecord(edge) ? normalizeInstagramPost(edge.node, 'tagged_koc_candidate', officialUsername) : null)
    .filter((item): item is InstagramActivityPost => Boolean(item));
}

function normalizeInstagramPost(value: unknown, sourceType: string, officialUsername: string): InstagramActivityPost | null {
  if (!isRecord(value)) return null;
  const id = readString(value.pk) || readString(value.id);
  const shortcode = readString(value.code) || readString(value.shortcode);
  if (!id && !shortcode) return null;
  const caption = instagramCaption(value);
  const user = isRecord(value.user) ? value.user : isRecord(value.owner) ? value.owner : {};
  const authorUsername = normalizeInstagramUsername(readString(user.username));
  const authorFullName = readString(user.full_name);
  const timestamp = firstInstagramNumber(value.taken_at, value.taken_at_timestamp, value.timestamp);
  const publishedAt = instagramTimestampIso(timestamp);
  const coauthors = instagramCoauthors(value);
  const paidPartnership = value.is_paid_partnership === true || instagramSponsorUsernames(value).length > 0;
  const mediaType = instagramMediaType(value);
  const promotionSignals = sourceType === 'tagged_koc_candidate'
    ? instagramPromotionSignals(caption, officialUsername, paidPartnership)
    : paidPartnership ? ['paid_partnership_flag'] : [];
  const firstLine = caption.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  return {
    id: id || shortcode,
    shortcode,
    permalink: shortcode ? `https://www.instagram.com/${mediaType === 'reel' ? 'reel' : 'p'}/${shortcode}/` : '',
    authorUsername: authorUsername || (sourceType.startsWith('official') ? officialUsername : ''),
    authorFullName: authorFullName || undefined,
    publishedAt,
    title: truncate(firstLine || caption || `Instagram post ${shortcode || id}`, 180),
    caption: truncate(caption, 1800),
    mediaType,
    viewCount: maxNonNegativeNumber(value.play_count, value.ig_play_count, value.video_view_count, value.view_count),
    likeCount: maxNonNegativeNumber(
      value.like_count,
      instagramEdgeCount(value.edge_liked_by),
      instagramEdgeCount(value.edge_media_preview_like)
    ),
    commentCount: maxNonNegativeNumber(value.comment_count, instagramEdgeCount(value.edge_media_to_comment)),
    shareCount: maxNonNegativeNumber(value.share_count),
    paidPartnership,
    coauthors,
    sourceTypes: [sourceType],
    promotionSignals,
    promotionConfidence: sourceType === 'tagged_koc_candidate'
      ? promotionSignals.includes('paid_or_collaboration_language') || promotionSignals.includes('affiliate_or_reward_offer')
        ? 'high'
        : promotionSignals.length >= 2
          ? 'medium'
          : 'low'
      : undefined,
  };
}

function instagramCaption(value: Record<string, unknown>) {
  if (isRecord(value.caption)) {
    const text = readString(value.caption.text);
    if (text) return text;
  }
  const captionEdge = isRecord(value.edge_media_to_caption) ? value.edge_media_to_caption : {};
  const edges = Array.isArray(captionEdge.edges) ? captionEdge.edges : [];
  for (const edge of edges) {
    if (!isRecord(edge) || !isRecord(edge.node)) continue;
    const text = readString(edge.node.text);
    if (text) return text;
  }
  return '';
}

function instagramCoauthors(value: Record<string, unknown>) {
  const result = new Set<string>();
  const coauthors = Array.isArray(value.coauthor_producers) ? value.coauthor_producers : [];
  for (const item of coauthors) {
    if (!isRecord(item)) continue;
    const username = normalizeInstagramUsername(readString(item.username));
    if (username) result.add(username);
  }
  for (const username of instagramSponsorUsernames(value)) result.add(username);
  return Array.from(result);
}

function instagramSponsorUsernames(value: Record<string, unknown>) {
  const sponsorEdge = isRecord(value.edge_media_to_sponsor_user) ? value.edge_media_to_sponsor_user : {};
  const edges = Array.isArray(sponsorEdge.edges) ? sponsorEdge.edges : [];
  return edges.map((edge) => {
    if (!isRecord(edge) || !isRecord(edge.node)) return '';
    return normalizeInstagramUsername(readString(edge.node.username));
  }).filter(Boolean);
}

function instagramPromotionSignals(caption: string, officialUsername: string, paidPartnership: boolean) {
  const normalized = caption.toLowerCase();
  const signals = new Set<string>();
  if (officialUsername && normalized.includes(`@${officialUsername.toLowerCase()}`)) signals.add('official_account_tagged');
  if (paidPartnership) signals.add('paid_partnership_flag');
  if (/\b(collab(?:oration)?|partner(?:ship)?|sponsor(?:ed)?|paid\s+partnership|ad)\b|en colaboración|colaboración|合作|赞助/i.test(caption)) {
    signals.add('paid_or_collaboration_language');
  }
  if (/affiliate|referral|promo\s*code|discount\s*code|credits?\s+extra|extra\s+credits?|cr[eé]ditos?\s+extra|\bcode\s*[=:]|\?code=/i.test(caption)) {
    signals.add('affiliate_or_reward_offer');
  }
  if (/link\s+in\s+(?:my\s+)?bio|link\s+en\s+(?:mi\s+)?bio|comment\s+[“"']?(?:link|enlace)|comenta\s+[“"']?enlace|try\s+it|register|regístrate/i.test(caption)) {
    signals.add('conversion_call_to_action');
  }
  return Array.from(signals);
}

function instagramMediaType(value: Record<string, unknown>) {
  const productType = readString(value.product_type);
  if (productType) return productType === 'clips' ? 'reel' : productType;
  if (value.is_video === true || readString(value.__typename) === 'GraphVideo' || readNumber(value.media_type) === 2) return 'video';
  if (readString(value.__typename) === 'GraphSidecar' || readNumber(value.media_type) === 8) return 'carousel';
  return 'image';
}

function mergeInstagramPosts(groups: InstagramActivityPost[][]) {
  const merged = new Map<string, InstagramActivityPost>();
  for (const post of groups.flat()) {
    const key = post.shortcode || post.id;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, post);
      continue;
    }
    merged.set(key, {
      ...current,
      ...post,
      title: post.title.length >= current.title.length ? post.title : current.title,
      caption: post.caption.length >= current.caption.length ? post.caption : current.caption,
      viewCount: maxNonNegativeNumber(current.viewCount, post.viewCount),
      likeCount: maxNonNegativeNumber(current.likeCount, post.likeCount),
      commentCount: maxNonNegativeNumber(current.commentCount, post.commentCount),
      shareCount: maxNonNegativeNumber(current.shareCount, post.shareCount),
      paidPartnership: current.paidPartnership || post.paidPartnership,
      coauthors: Array.from(new Set([...current.coauthors, ...post.coauthors])),
      sourceTypes: Array.from(new Set([...current.sourceTypes, ...post.sourceTypes])),
      promotionSignals: Array.from(new Set([...current.promotionSignals, ...post.promotionSignals])),
    });
  }
  return Array.from(merged.values());
}

function filterInstagramPostsByWindow(posts: InstagramActivityPost[], since: Date, until: Date) {
  return posts
    .filter((post) => {
      if (!post.publishedAt) return false;
      const timestamp = Date.parse(post.publishedAt);
      return Number.isFinite(timestamp) && timestamp >= since.getTime() && timestamp <= until.getTime();
    })
    .sort((left, right) => Date.parse(right.publishedAt || '') - Date.parse(left.publishedAt || ''));
}

function instagramEdgeCount(value: unknown) {
  return isRecord(value) ? value.count : null;
}

function firstInstagramNumber(...values: unknown[]) {
  for (const value of values) {
    const number = readNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function maxNonNegativeNumber(...values: unknown[]) {
  const numbers = values.map(nonNegativeNumber).filter((value): value is number => value !== null);
  return numbers.length ? Math.max(...numbers) : null;
}

function nonNegativeNumber(value: unknown) {
  const number = readNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function instagramTimestampIso(value: number | null) {
  if (value === null) return null;
  const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseRequiredDate(value: string) {
  if (!value || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function extractInstagramUsername(value: string) {
  const normalized = value.trim();
  if (/^@[A-Za-z0-9._]+$/.test(normalized)) return normalizeInstagramUsername(normalized);
  try {
    const url = new URL(/^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`);
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return '';
    const segment = url.pathname.split('/').filter(Boolean)[0] || '';
    return normalizeInstagramUsername(segment);
  } catch {
    return '';
  }
}

function normalizeInstagramUsername(value: string) {
  return value.replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9._]/g, '');
}

function instagramSearchQuery(value: string) {
  const domain = extractTargetDomain(value);
  if (domain) return domain.split('.')[0].replace(/[-_]+/g, ' ');
  return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\s+/g, ' ').trim();
}

function extractTargetDomain(value: string) {
  const normalized = value.trim();
  if (!normalized) return '';
  if (!/^https?:\/\//i.test(normalized) && !/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/.*)?$/i.test(normalized)) return '';
  return normalizeDomain(normalized);
}

function normalizeInstagramComparable(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const TIKTOK_API23_HOST = 'tiktok-api23.p.rapidapi.com';

const TIKTOK_API23_OPERATIONS = {
  account_search: { endpoint: '/api/search/account', required: 'keyword' },
  user_info: { endpoint: '/api/user/info', required: 'uniqueId' },
  user_posts: { endpoint: '/api/user/posts', required: 'secUid' },
  video_search: { endpoint: '/api/search/video', required: 'keyword' },
  post_discover: { endpoint: '/api/post/discover', required: 'keyword' },
} as const;

async function tiktokApi23(args: Record<string, unknown>, config: ServerConfig) {
  const operationName = readString(args.operation);
  if (!(operationName in TIKTOK_API23_OPERATIONS)) {
    return { error: 'operation must be one of account_search, user_info, user_posts, video_search, or post_discover.' };
  }
  const operation = operationName as keyof typeof TIKTOK_API23_OPERATIONS;
  const operationConfig = TIKTOK_API23_OPERATIONS[operation];
  const requiredValue = readString(args[operationConfig.required]);
  if (!requiredValue) return missingInput(operationConfig.required);

  const sinceValue = readString(args.since);
  const untilValue = readString(args.until);
  if (Boolean(sinceValue) !== Boolean(untilValue)) {
    return { error: 'since and until must be supplied together.' };
  }
  const since = sinceValue ? parseRequiredDate(sinceValue) : null;
  const until = untilValue ? parseRequiredDate(untilValue) : null;
  if ((sinceValue && !since) || (untilValue && !until)) {
    return { error: 'since and until must be valid ISO-8601 timestamps with an explicit timezone.' };
  }
  if (since && until && since.getTime() > until.getTime()) {
    return { error: 'since must be earlier than or equal to until.' };
  }

  const params = tiktokApi23Params(operation, args);
  const response = await tiktokApi23Get(operationConfig.endpoint, params, config);
  const maxItems = readNumber(args.maxItems);
  return {
    operation,
    endpoint: operationConfig.endpoint,
    request: params,
    publicationWindow: since && until
      ? { since: since.toISOString(), until: until.toISOString(), interpretation: 'explicit_range' }
      : undefined,
    response: transformTikTokApi23Response(
      response,
      since,
      until,
      maxItems === null ? null : clampInt(maxItems, 1, 100, 100)
    ),
  };
}

function tiktokApi23Params(
  operation: keyof typeof TIKTOK_API23_OPERATIONS,
  args: Record<string, unknown>
) {
  const params: Record<string, string> = {};
  if (operation === 'account_search' || operation === 'video_search' || operation === 'post_discover') {
    params.keyword = readString(args.keyword);
  }
  if (operation === 'user_info') params.uniqueId = readString(args.uniqueId);
  if (operation === 'user_posts') params.secUid = readString(args.secUid);

  const cursor = readString(args.cursor);
  const searchId = readString(args.searchId);
  const count = readNumber(args.count);
  const page = readNumber(args.page);
  if (cursor && ['account_search', 'user_posts', 'video_search'].includes(operation)) params.cursor = cursor;
  if (searchId && ['account_search', 'video_search'].includes(operation)) params.search_id = searchId;
  if (count !== null && operation === 'user_posts') params.count = String(clampInt(count, 1, 35, 35));
  if (page !== null && operation === 'post_discover') params.page = String(Math.max(1, Math.floor(page)));
  return params;
}

async function tiktokApi23Get(pathname: string, params: Record<string, string>, config: ServerConfig) {
  const url = new URL(`https://${TIKTOK_API23_HOST}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await rapidApiJson({
    config,
    host: TIKTOK_API23_HOST,
    url: url.toString(),
    publicInput: { endpoint: pathname, ...params },
  });
  return isRecord(response) ? response.body : null;
}

const TIKTOK_API23_ITEM_ARRAY_KEYS = new Set([
  'user_list',
  'userList',
  'item_list',
  'itemList',
  'video_list',
  'videoList',
  'seoBizItemInfoList',
]);
const TIKTOK_API23_POST_ARRAY_KEYS = new Set([
  'item_list',
  'itemList',
  'video_list',
  'videoList',
  'seoBizItemInfoList',
]);

function transformTikTokApi23Response(
  value: unknown,
  since: Date | null,
  until: Date | null,
  maxItems: number | null,
  parentKey = ''
): unknown {
  if (Array.isArray(value)) {
    let items = value;
    if (since && until && TIKTOK_API23_POST_ARRAY_KEYS.has(parentKey)) {
      items = items.filter((item) => {
        const timestamp = tiktokApi23CreateTimeMs(item);
        return timestamp !== null && timestamp >= since.getTime() && timestamp <= until.getTime();
      });
    }
    if (maxItems !== null && TIKTOK_API23_ITEM_ARRAY_KEYS.has(parentKey)) {
      items = items.slice(0, maxItems);
    }
    return items.map((item) => transformTikTokApi23Response(item, since, until, maxItems));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      transformTikTokApi23Response(nested, since, until, maxItems, key),
    ])
  );
}

function tiktokApi23CreateTimeMs(value: unknown) {
  if (!isRecord(value)) return null;
  const timestamp = readNumber(value.createTime) ?? readNumber(value.create_time);
  if (timestamp === null) return null;
  return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
}

const YOUTUBE_V2_HOST = 'youtube-v2.p.rapidapi.com';

async function youtubeCompetitorActivity(args: Record<string, unknown>, config: ServerConfig) {
  const target = readString(args.target);
  const requestedChannelId = readString(args.channelId);
  const channelName = readString(args.channelName);
  const since = parseRequiredDate(readString(args.since));
  const until = parseRequiredDate(readString(args.until));
  if (!since || !until) {
    return { error: 'since and until must be valid ISO-8601 timestamps with an explicit timezone.' };
  }
  if (since.getTime() > until.getTime()) return { error: 'since must be earlier than or equal to until.' };

  const includeOfficial = args.includeOfficial !== false;
  const includeKoc = args.includeKoc !== false;
  const includeShorts = args.includeShorts !== false;
  const maxResults = clampInt(readNumber(args.maxResults), 1, 30, 20);
  const country = normalizeYoutubeCountry(readString(args.country));
  const lang = normalizeYoutubeLanguage(readString(args.lang));
  const extraKeywords = Array.isArray(args.keywords)
    ? args.keywords.map(readString).filter(Boolean).slice(0, 5)
    : [];
  const targetDomain = extractTargetDomain(target);
  const targetStem = targetDomain ? targetDomain.split('.')[0] : youtubeSearchQuery(target);
  const aliases = uniqueStrings([channelName, ...extraKeywords, targetDomain, targetStem, youtubeSearchQuery(target)]);
  const resolution = await resolveYouTubeChannel({
    target,
    requestedChannelId,
    channelName,
    aliases,
    country,
    lang,
    config,
  });
  const searchQueries = uniqueStrings([
    channelName,
    ...extraKeywords,
    resolution.title,
    targetDomain,
    targetStem,
    youtubeSearchQuery(target),
  ]).slice(0, 4);
  const orderBy = youtubeSearchOrderBy(since, new Date());

  const endpointTasks: Array<{
    label: string;
    kind: 'official' | 'koc';
    query?: string;
    run: () => Promise<unknown>;
  }> = [];
  if (includeOfficial && resolution.channelId) {
    endpointTasks.push({
      label: 'channel-videos',
      kind: 'official',
      run: () => youtubeV2Get('/channel/videos', { channel_id: resolution.channelId }, config),
    });
    if (includeShorts) {
      endpointTasks.push({
        label: 'channel-shorts',
        kind: 'official',
        run: () => youtubeV2Get('/channel/shorts', { channel_id: resolution.channelId }, config),
      });
    }
  }
  if (includeKoc) {
    for (const query of searchQueries) {
      endpointTasks.push({
        label: `search:${query}`,
        kind: 'koc',
        query,
        run: () => youtubeV2Get('/search/', {
          query,
          country,
          lang,
          ...(orderBy ? { order_by: orderBy } : {}),
        }, config),
      });
    }
  }

  const settled = await Promise.allSettled(endpointTasks.map((task) => task.run()));
  const officialGroups: YouTubeActivityVideo[][] = [];
  const kocGroups: YouTubeActivityVideo[][] = [];
  const errors: Array<{ endpoint: string; error: string }> = [...resolution.errors];
  settled.forEach((result, index) => {
    const task = endpointTasks[index];
    if (result.status === 'rejected') {
      errors.push({ endpoint: task.label, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      return;
    }
    const videos = extractYouTubeVideos(result.value, task.label, task.query);
    if (task.kind === 'official') officialGroups.push(videos);
    else kocGroups.push(videos);
  });

  const rawOfficialCandidates = mergeYouTubeVideos(officialGroups);
  const rawKocCandidates = mergeYouTubeVideos(kocGroups)
    .filter((video) => !resolution.channelId || video.channelId !== resolution.channelId)
    .filter((video) => youtubeBrandRelevant(video, aliases));
  const detailLimit = Math.min(40, maxResults * 2);
  const officialDetails = await loadYouTubeVideoDetails(rawOfficialCandidates, since, until, detailLimit, config, errors);
  const kocDetails = await loadYouTubeVideoDetails(rawKocCandidates, since, until, detailLimit, config, errors);
  const official = filterYouTubeVideosByWindow(officialDetails.videos, since, until).slice(0, maxResults);
  const koc = filterYouTubeVideosByWindow(kocDetails.videos, since, until)
    .filter((video) => !resolution.channelId || video.channelId !== resolution.channelId)
    .filter((video) => youtubeBrandRelevant(video, aliases))
    .map((video) => applyYouTubePromotionClassification(video, aliases, targetDomain))
    .slice(0, maxResults);

  const request = {
    target: target || undefined,
    channelId: requestedChannelId || undefined,
    channelName: channelName || undefined,
    keywords: extraKeywords,
    includeOfficial,
    includeKoc,
    includeShorts,
    country,
    lang,
    maxResults,
  };
  const window = { since: since.toISOString(), until: until.toISOString(), interpretation: 'explicit_range' };
  const coverage = {
    endpoints: endpointTasks.map((task) => task.label),
    apiCallCount: resolution.apiCallCount + endpointTasks.length + officialDetails.apiCallCount + kocDetails.apiCallCount,
    searchQueries,
    orderBy: orderBy || null,
    rawOfficialCandidates: rawOfficialCandidates.length,
    rawKocCandidates: rawKocCandidates.length,
    detailedOfficialCandidates: officialDetails.apiCallCount,
    detailedKocCandidates: kocDetails.apiCallCount,
    errors,
  };

  if (!resolution.channelId) {
    return {
      request,
      window,
      resolution,
      official: { count: 0, videos: [] },
      koc: { count: koc.length, videos: koc, classification: youtubeKocClassification() },
      coverage,
      warning: 'No official YouTube channel could be resolved; keyword KOC candidates may still be available.',
    };
  }
  return {
    request,
    window,
    resolution,
    official: { count: official.length, videos: official },
    koc: { count: koc.length, videos: koc, classification: youtubeKocClassification() },
    coverage,
  };
}

function youtubeKocClassification() {
  return 'Public keyword-search results from non-official channels are returned as KOC/creator promotion candidates. promotionSignals and promotionConfidence are heuristics, not proof of payment, sponsorship, gifting, or another commercial relationship.';
}

async function resolveYouTubeChannel(input: {
  target: string;
  requestedChannelId: string;
  channelName: string;
  aliases: string[];
  country: string;
  lang: string;
  config: ServerConfig;
}) {
  const errors: Array<{ endpoint: string; error: string }> = [];
  let apiCallCount = 0;
  if (input.requestedChannelId) {
    try {
      apiCallCount += 1;
      const details = await youtubeV2Get('/channel/details', { channel_id: input.requestedChannelId }, input.config);
      return {
        ...normalizeYouTubeChannelDetails(details, input.requestedChannelId),
        matchReason: 'explicit_channel_id',
        alternatives: [],
        apiCallCount,
        errors,
      };
    } catch (error) {
      errors.push({ endpoint: `channel-details:${input.requestedChannelId}`, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const query = input.channelName || input.aliases.find(Boolean) || youtubeSearchQuery(input.target);
  let candidates: YouTubeSearchCandidate[] = [];
  if (query) {
    try {
      apiCallCount += 1;
      const search = await youtubeV2Get('/search/', { query, country: input.country, lang: input.lang }, input.config);
      candidates = extractYouTubeChannelCandidates(search, input.aliases, query);
    } catch (error) {
      errors.push({ endpoint: `channel-search:${query}`, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const attempts: Array<ReturnType<typeof normalizeYouTubeChannelDetails> & { score: number }> = [];
  for (const candidate of candidates.slice(0, 3)) {
    try {
      apiCallCount += 1;
      const raw = await youtubeV2Get('/channel/details', { channel_id: candidate.channelId }, input.config);
      const details = normalizeYouTubeChannelDetails(raw, candidate.channelId);
      attempts.push({
        ...details,
        title: details.title || candidate.title,
        description: details.description || candidate.description,
        score: candidate.score + youtubeChannelDetailScore(details, input.aliases, extractTargetDomain(input.target)),
      });
    } catch (error) {
      errors.push({ endpoint: `channel-details:${candidate.channelId}`, error: error instanceof Error ? error.message : String(error) });
    }
  }
  attempts.sort((left, right) => right.score - left.score);
  const selected = attempts[0];
  if (selected) {
    const { score: _score, ...channel } = selected;
    const expected = normalizeComparableName(input.channelName);
    const actual = normalizeComparableName(channel.title);
    return {
      ...channel,
      matchReason: expected && actual === expected ? 'exact_channel_name' : 'ranked_search_candidate',
      alternatives: attempts.slice(1, 4).map(({ score: _candidateScore, ...item }) => item),
      apiCallCount,
      errors,
    };
  }

  const fallback = candidates[0];
  return {
    channelId: fallback?.channelId || input.requestedChannelId,
    title: fallback?.title || input.channelName,
    description: fallback?.description || '',
    channelUrl: fallback?.channelId ? `https://www.youtube.com/channel/${fallback.channelId}` : '',
    matchReason: fallback ? 'ranked_search_candidate_details_unavailable' : 'not_resolved',
    alternatives: candidates.slice(1, 5),
    apiCallCount,
    errors,
  };
}

function extractYouTubeChannelCandidates(value: unknown, aliases: string[], query: string) {
  const videos = youtubeVideoArray(value);
  const merged = new Map<string, YouTubeSearchCandidate>();
  videos.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const channelId = readString(entry.channel_id) || readString(entry.channelId);
    if (!channelId) return;
    const title = readString(entry.author) || readString(entry.channel_title) || readString(entry.channelTitle);
    const description = readString(entry.description);
    const comparableTitle = normalizeComparableName(title);
    const comparableText = normalizeComparableName(`${title} ${description} ${readString(entry.title)}`);
    const comparableAliases = uniqueStrings([...aliases, query]).map(normalizeComparableName).filter((item) => item.length >= 2);
    const score = Math.max(0, 30 - index)
      + Math.max(0, ...comparableAliases.map((alias) => comparableTitle === alias ? 100 : comparableTitle.includes(alias) ? 55 : comparableText.includes(alias) ? 20 : 0));
    const candidate = { channelId, title, description, position: index, score };
    const current = merged.get(channelId);
    if (!current || candidate.score > current.score) merged.set(channelId, candidate);
  });
  return Array.from(merged.values()).sort((left, right) => right.score - left.score || left.position - right.position);
}

function normalizeYouTubeChannelDetails(value: unknown, fallbackChannelId = '') {
  const root = youtubeRecord(value);
  const channelId = readString(root.channel_id) || readString(root.channelId) || readString(root.id) || fallbackChannelId;
  const title = readString(root.title) || readString(root.channel_name) || readString(root.name);
  return {
    channelId,
    title,
    description: truncate(readString(root.description), 1_000),
    channelUrl: readString(root.channel_url) || readString(root.url) || (channelId ? `https://www.youtube.com/channel/${channelId}` : ''),
    customUrl: readString(root.custom_url) || readString(root.handle) || undefined,
    subscribers: youtubeMetric(root.number_of_subscribers ?? root.subscriber_count ?? root.subscribers),
    videoCount: youtubeMetric(root.number_of_videos ?? root.video_count ?? root.videos_count),
    views: youtubeMetric(root.number_of_views ?? root.view_count ?? root.views),
    links: Array.isArray(root.links) ? root.links.slice(0, 20) : [],
  };
}

function youtubeChannelDetailScore(
  channel: ReturnType<typeof normalizeYouTubeChannelDetails>,
  aliases: string[],
  targetDomain: string
) {
  const title = normalizeComparableName(channel.title);
  const text = `${channel.title} ${channel.description} ${JSON.stringify(channel.links)}`.toLowerCase();
  const aliasScore = Math.max(0, ...aliases.map(normalizeComparableName).filter(Boolean)
    .map((alias) => title === alias ? 120 : title.includes(alias) ? 60 : normalizeComparableName(text).includes(alias) ? 25 : 0));
  return aliasScore + (targetDomain && text.includes(targetDomain.toLowerCase()) ? 150 : 0);
}

async function youtubeV2Get(pathname: string, params: Record<string, string>, config: ServerConfig) {
  const url = new URL(`https://${YOUTUBE_V2_HOST}${pathname}`);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  const response = await rapidApiJson({
    config,
    host: YOUTUBE_V2_HOST,
    url: url.toString(),
    publicInput: { endpoint: pathname, ...params },
  });
  return isRecord(response) ? response.body : null;
}

function extractYouTubeVideos(value: unknown, sourceType: string, query?: string) {
  return youtubeVideoArray(value)
    .map((item) => normalizeYouTubeVideo(item, sourceType, query))
    .filter((item): item is YouTubeActivityVideo => Boolean(item));
}

function youtubeVideoArray(value: unknown) {
  const root = youtubeRecord(value);
  const candidate = root.videos ?? root.items ?? root.results ?? root.data;
  return Array.isArray(candidate) ? candidate : [];
}

function youtubeRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  if (isRecord(value.data) && !Array.isArray(value.data)) return value.data;
  return value;
}

function normalizeYouTubeVideo(value: unknown, sourceType: string, query?: string): YouTubeActivityVideo | null {
  if (!isRecord(value)) return null;
  const videoId = readString(value.video_id) || readString(value.videoId) || readString(value.id);
  if (!videoId) return null;
  const publishedTimeRaw = readString(value.published_time) || readString(value.publishedAt) || readString(value.publish_time);
  const channelId = readString(value.channel_id) || readString(value.channelId);
  const description = readString(value.description);
  const keywords = Array.isArray(value.keywords) ? value.keywords.map(readString).filter(Boolean).slice(0, 30) : [];
  return {
    videoId,
    permalink: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    title: truncate(readString(value.title), 300),
    description: truncate(description, 2_500),
    author: readString(value.author) || readString(value.channel_title) || readString(value.channelTitle),
    channelId,
    channelUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : '',
    publishedAt: youtubePublishedAt(publishedTimeRaw),
    publishedTimeRaw: publishedTimeRaw || undefined,
    durationSeconds: youtubeMetric(value.video_length ?? value.duration),
    viewCount: youtubeMetric(value.number_of_views ?? value.view_count ?? value.views),
    category: readString(value.category) || undefined,
    mediaType: sourceType.includes('shorts') ? 'short' : readString(value.type) || 'video',
    keywords,
    sourceTypes: [sourceType],
    matchedQueries: query ? [query] : [],
    promotionSignals: [],
  };
}

function mergeYouTubeVideos(groups: YouTubeActivityVideo[][]) {
  const merged = new Map<string, YouTubeActivityVideo>();
  for (const video of groups.flat()) {
    const current = merged.get(video.videoId);
    if (!current) {
      merged.set(video.videoId, video);
      continue;
    }
    merged.set(video.videoId, {
      ...current,
      title: video.title.length > current.title.length ? video.title : current.title,
      description: video.description.length > current.description.length ? video.description : current.description,
      author: current.author || video.author,
      channelId: current.channelId || video.channelId,
      channelUrl: current.channelUrl || video.channelUrl,
      publishedAt: video.publishedAt || current.publishedAt,
      publishedTimeRaw: video.publishedTimeRaw || current.publishedTimeRaw,
      durationSeconds: maxNonNegativeNumber(current.durationSeconds, video.durationSeconds),
      viewCount: maxNonNegativeNumber(current.viewCount, video.viewCount),
      category: current.category || video.category,
      mediaType: current.mediaType === 'short' || video.mediaType === 'short' ? 'short' : current.mediaType,
      keywords: uniqueStrings([...current.keywords, ...video.keywords]),
      sourceTypes: uniqueStrings([...current.sourceTypes, ...video.sourceTypes]),
      matchedQueries: uniqueStrings([...current.matchedQueries, ...video.matchedQueries]),
      promotionSignals: uniqueStrings([...current.promotionSignals, ...video.promotionSignals]),
    });
  }
  return Array.from(merged.values());
}

async function loadYouTubeVideoDetails(
  candidates: YouTubeActivityVideo[],
  since: Date,
  until: Date,
  maxCandidates: number,
  config: ServerConfig,
  errors: Array<{ endpoint: string; error: string }>
) {
  const shortlisted = candidates
    .filter((video) => youtubeApproximateDateMayOverlap(video.publishedTimeRaw || '', since, until, new Date()))
    .slice(0, maxCandidates);
  const videos: YouTubeActivityVideo[] = [];
  for (let index = 0; index < shortlisted.length; index += 5) {
    const batch = shortlisted.slice(index, index + 5);
    const settled = await Promise.allSettled(batch.map((video) => youtubeV2Get('/video/details', { video_id: video.videoId }, config)));
    settled.forEach((result, resultIndex) => {
      const candidate = batch[resultIndex];
      if (result.status === 'rejected') {
        errors.push({ endpoint: `video-details:${candidate.videoId}`, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
        if (candidate.publishedAt) videos.push(candidate);
        return;
      }
      const detail = normalizeYouTubeVideo(result.value, 'video-details');
      videos.push(...mergeYouTubeVideos([[candidate], detail ? [detail] : []]));
    });
  }
  return { videos: mergeYouTubeVideos([videos]), apiCallCount: shortlisted.length };
}

function filterYouTubeVideosByWindow(videos: YouTubeActivityVideo[], since: Date, until: Date) {
  return videos
    .filter((video) => {
      if (!video.publishedAt) return false;
      const timestamp = Date.parse(video.publishedAt);
      return Number.isFinite(timestamp) && timestamp >= since.getTime() && timestamp <= until.getTime();
    })
    .sort((left, right) => Date.parse(right.publishedAt || '') - Date.parse(left.publishedAt || ''));
}

function youtubeBrandRelevant(video: YouTubeActivityVideo, aliases: string[]) {
  const text = normalizeComparableName(`${video.title} ${video.description} ${video.author} ${video.keywords.join(' ')}`);
  return aliases.map(normalizeComparableName).filter((alias) => alias.length >= 3).some((alias) => text.includes(alias));
}

function applyYouTubePromotionClassification(video: YouTubeActivityVideo, aliases: string[], targetDomain: string) {
  const text = `${video.title}\n${video.description}`;
  const normalized = text.toLowerCase();
  const signals = new Set<string>();
  const knownDomains = uniqueStrings([targetDomain, ...aliases.filter((alias) => /(?:^|\.)[a-z0-9-]+\.[a-z]{2,}$/i.test(alias))])
    .map(normalizeDomain)
    .filter(Boolean);
  if (video.matchedQueries.length) signals.add('brand_keyword_search_result');
  if (knownDomains.some((domain) => normalized.includes(domain))) signals.add('brand_domain_mentioned');
  if (knownDomains.some((domain) => new RegExp(`https?://[^\\s]*${escapeRegExp(domain)}`, 'i').test(text))) signals.add('brand_link_in_description');
  if (/[?&](?:utm_[a-z]+|ref|referral|affiliate|aff|source|campaign)=/i.test(text)) signals.add('tracking_or_affiliate_link');
  if (/\b(?:ad|sponsored|paid promotion|paid partnership|in collaboration with|partnered with|gifted|thanks to .{0,60} sponsoring|made possible by|supported by)\b/i.test(text)) signals.add('paid_or_collaboration_language');
  if (/\b(?:affiliate|discount|promo code|coupon|use (?:my )?code|code\s*[:=])\b/i.test(text)) signals.add('affiliate_or_discount_offer');
  if (/\b(?:link in (?:the )?description|check (?:it|them) out|try it|sign up|download|get started|learn more)\b/i.test(text)) signals.add('conversion_call_to_action');
  if (aliases.some((alias) => alias && normalized.includes(alias.toLowerCase()))) signals.add('brand_mentioned_in_metadata');
  const promotionSignals = Array.from(signals);
  const promotionConfidence: 'high' | 'medium' | 'low' = promotionSignals.includes('paid_or_collaboration_language')
    || promotionSignals.includes('tracking_or_affiliate_link')
    ? 'high'
    : promotionSignals.includes('brand_link_in_description')
      || promotionSignals.includes('affiliate_or_discount_offer')
      || promotionSignals.includes('conversion_call_to_action')
      ? 'medium'
      : 'low';
  return { ...video, promotionSignals, promotionConfidence };
}

function youtubePublishedAt(value: string) {
  if (!value || /\bago\b|today|yesterday|streamed|premiered/i.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function youtubeApproximateDateMayOverlap(rawValue: string, since: Date, until: Date, now: Date) {
  if (!rawValue) return true;
  const exact = youtubePublishedAt(rawValue);
  if (exact) {
    const timestamp = Date.parse(exact);
    return timestamp >= since.getTime() && timestamp <= until.getTime();
  }
  const normalized = rawValue.toLowerCase().replace(/^(?:streamed|premiered)\s+/, '').trim();
  const relative = normalized.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (relative) {
    const amount = Number(relative[1]);
    const units: Record<string, number> = {
      second: 1_000,
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 7 * 86_400_000,
      month: 30 * 86_400_000,
      year: 365 * 86_400_000,
    };
    const unit = units[relative[2]];
    const newest = now.getTime() - amount * unit;
    const oldest = now.getTime() - (amount + 1) * unit;
    return newest >= since.getTime() && oldest <= until.getTime();
  }
  if (normalized.includes('today')) return now.getTime() >= since.getTime() && now.getTime() - 86_400_000 <= until.getTime();
  if (normalized.includes('yesterday')) return now.getTime() - 86_400_000 >= since.getTime() && now.getTime() - 2 * 86_400_000 <= until.getTime();
  return true;
}

function youtubeSearchOrderBy(since: Date, now: Date) {
  const age = Math.max(0, now.getTime() - since.getTime());
  if (age <= 3_600_000) return 'last_hour';
  if (age <= 86_400_000) return 'today';
  if (age <= 7 * 86_400_000) return 'this_week';
  if (age <= 31 * 86_400_000) return 'this_month';
  if (age <= 366 * 86_400_000) return 'this_year';
  return '';
}

function youtubeSearchQuery(value: string) {
  const domain = extractTargetDomain(value);
  if (domain) return domain.split('.')[0].replace(/[-_]+/g, ' ').trim();
  return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\s+/g, ' ').trim();
}

function normalizeYoutubeCountry(value: string) {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : 'US';
}

function normalizeYoutubeLanguage(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[a-z]{2}$/.test(normalized) ? normalized : 'en';
}

function youtubeMetric(value: unknown) {
  if (typeof value === 'string') {
    const match = value.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)\s*([kmb])?/i);
    if (!match) return null;
    const multiplier = match[2]?.toLowerCase() === 'b'
      ? 1_000_000_000
      : match[2]?.toLowerCase() === 'm'
        ? 1_000_000
        : match[2]?.toLowerCase() === 'k'
          ? 1_000
          : 1;
    return nonNegativeNumber(Number(match[1]) * multiplier);
  }
  return nonNegativeNumber(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function apparkAppIntelligence(args: Record<string, unknown>, config: ServerConfig) {
  const requestedAppName = readString(args.appName);
  const requestedAppId = readString(args.appId);
  const platform = normalizeApparkPlatform(readString(args.platform), requestedAppId);
  const country = normalizeCountry(readString(args.country));
  const searchSize = clampInt(readNumber(args.searchSize), 1, 20, 10);
  const includeDownloadRevenue = args.includeDownloadRevenue !== false;
  const includeCompetitors = args.includeCompetitors !== false;

  const search = requestedAppName
    ? await apparkSearch(requestedAppName, searchSize, platform, config)
    : { apps: null, publishers: null };
  const selected = selectApparkCandidate({
    candidates: search.apps?.list || [],
    requestedAppId,
    requestedAppName,
    platform,
  });
  const target = selected.app || inferApparkTarget(requestedAppId, platform, country);

  if (!target) {
    return {
      request: {
        appName: requestedAppName || undefined,
        appId: requestedAppId || undefined,
        platform: platformToLabel(platform),
        country,
      },
      search,
      selected: null,
      error: 'No Appark app candidate matched the request. Provide an appId/packageName or a more specific platform.',
    };
  }

  const targetCountry = normalizeCountry(target.country || country);
  const [detailResult, clusterResult] = await Promise.allSettled([
    apparkGet('/api/app/app-detail', {
      app_id: target.app_id,
      platform: String(target.platform),
      country: targetCountry,
    }, config),
    apparkGet('/api/app-cluster/app-cluster', {
      app_id: target.app_id,
      country: targetCountry,
    }, config),
  ]);

  const detail = settledBody(detailResult);
  const cluster = settledBody(clusterResult);
  const clusterData = apparkPayloadData(cluster);
  const clusterId = readStringFromRecord(clusterData, 'cluster_id') || readString(target.cluster_id);

  const [downloadRevenueResult, competitorsResult] = await Promise.allSettled([
    includeDownloadRevenue && clusterId
      ? apparkGet('/api/app-cluster/cluster-download-revenue', { cluster_id: clusterId }, config)
      : Promise.resolve(null),
    includeCompetitors && clusterId
      ? apparkGet('/api/app-cluster/competitors', {
          app_cluster_id: clusterId,
          platform: String(target.platform),
          country: targetCountry,
        }, config)
      : Promise.resolve(null),
  ]);

  return {
    request: {
      appName: requestedAppName || undefined,
      appId: requestedAppId || undefined,
      platform: platformToLabel(platform),
      country: targetCountry,
      includeDownloadRevenue,
      includeCompetitors,
    },
    search,
    selected: {
      reason: selected.reason || (requestedAppId ? 'inferred_from_app_id' : 'first_matching_candidate'),
      app: normalizeApparkSearchApp(target),
    },
    appDetail: summarizeApparkDetail(detail),
    cluster: summarizeApparkCluster(cluster),
    downloadRevenue30d: summarizeApparkDownloadRevenue(settledBody(downloadRevenueResult)),
    competitors: summarizeApparkCompetitors(settledBody(competitorsResult)),
    errors: [
      settledError('appDetail', detailResult),
      settledError('cluster', clusterResult),
      settledError('downloadRevenue30d', downloadRevenueResult),
      settledError('competitors', competitorsResult),
    ].filter(Boolean),
  };
}

async function apparkSearch(keyword: string, size: number, platform: ApparkPlatform, config: ServerConfig) {
  const platformParam = platform || 0;
  const [appsResult, publishersResult] = await Promise.allSettled([
    apparkGet('/api/app/search-suggest', {
      keyword,
      page: '1',
      size: String(size),
      platform: String(platformParam),
      country: 'all',
    }, config),
    apparkGet('/api/company/search-suggest', {
      keyword,
      page: '1',
      size: String(size),
      platform: String(platformParam),
      country: 'all',
    }, config),
  ]);
  return {
    apps: summarizeApparkSearchResult(settledBody(appsResult), normalizeApparkSearchApp),
    publishers: summarizeApparkSearchResult(settledBody(publishersResult), normalizeApparkPublisher),
    errors: [
      settledError('appSearch', appsResult),
      settledError('publisherSearch', publishersResult),
    ].filter(Boolean),
  };
}

async function apparkGet(pathname: string, params: Record<string, string>, config: ServerConfig) {
  const baseUrl = process.env.APPARK_BASE_URL?.trim() || 'https://appark.ai';
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.rapidApiRequestTimeoutMs);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        referer: `${baseUrl}/`,
        'user-agent': process.env.APPARK_USER_AGENT?.trim()
          || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      },
    });
    const text = await response.text();
    const body = parseBody(text);
    if (!response.ok) {
      throw new Error(`Appark request failed with HTTP ${response.status}: ${text.slice(0, 1000)}`);
    }
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Appark request timed out after ${config.rapidApiRequestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function settledBody(result: PromiseSettledResult<unknown>) {
  return result.status === 'fulfilled' ? result.value : null;
}

function settledError(label: string, result: PromiseSettledResult<unknown>) {
  if (result.status === 'fulfilled') return null;
  return {
    label,
    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
  };
}

function apparkPayloadData(value: unknown) {
  if (isRecord(value) && Object.hasOwn(value, 'data')) return value.data;
  return value;
}

function summarizeApparkSearchResult<T>(
  value: unknown,
  mapper: (item: unknown) => T | null
) {
  const data = apparkPayloadData(value);
  if (!isRecord(data)) return null;
  const list = Array.isArray(data.list) ? data.list.map(mapper).filter((item): item is T => Boolean(item)) : [];
  return {
    page: readNumber(data.page),
    size: readNumber(data.size),
    total: readNumber(data.total),
    list,
  };
}

function normalizeApparkSearchApp(value: unknown): ApparkAppCandidate | null {
  if (!isRecord(value)) return null;
  const appId = readString(value.app_id);
  const platform = normalizeApparkPlatformNumber(value.platform);
  if (!appId || !platform) return null;
  return {
    app_id: appId,
    app_name: readString(value.app_name) || undefined,
    app_logo: readString(value.app_logo) || undefined,
    developer_name: readString(value.developer_name) || readString(value.publisher_name) || undefined,
    country: normalizeCountry(readString(value.country)),
    platform,
    platformLabel: platformToLabel(platform),
    cluster_id: readString(value.cluster_id) || undefined,
    publish_store: value.publish_store,
  };
}

function normalizeApparkPublisher(value: unknown) {
  if (!isRecord(value)) return null;
  const companyId = readString(value.company_id);
  const companyName = readString(value.company_name);
  if (!companyId && !companyName) return null;
  return {
    company_id: companyId || undefined,
    company_name: companyName || undefined,
    geo: readString(value.geo) || undefined,
  };
}

function selectApparkCandidate(input: {
  candidates: unknown[];
  requestedAppId: string;
  requestedAppName: string;
  platform: ApparkPlatform;
}) {
  const candidates = input.candidates.map(normalizeApparkSearchApp).filter((item): item is ApparkAppCandidate => Boolean(item));
  if (input.requestedAppId) {
    const match = candidates.find((item) => item.app_id.toLowerCase() === input.requestedAppId.toLowerCase());
    if (match) return { app: match, reason: 'matched_app_id' };
  }
  const byPlatform = input.platform ? candidates.filter((item) => item.platform === input.platform) : candidates;
  const normalizedName = normalizeComparableName(input.requestedAppName);
  if (normalizedName) {
    const exact = byPlatform.find((item) => normalizeComparableName(item.app_name || '') === normalizedName);
    if (exact) return { app: exact, reason: 'matched_exact_app_name' };
    const contains = byPlatform.find((item) => normalizeComparableName(item.app_name || '').includes(normalizedName));
    if (contains) return { app: contains, reason: 'matched_app_name_contains_query' };
  }
  if (byPlatform[0]) return { app: byPlatform[0], reason: input.platform ? 'first_matching_platform_candidate' : 'first_search_candidate' };
  return { app: null, reason: '' };
}

function inferApparkTarget(appId: string, platform: ApparkPlatform, country: string): ApparkAppCandidate | null {
  if (!appId) return null;
  const inferredPlatform = platform || normalizeApparkPlatform('', appId);
  if (!inferredPlatform) return null;
  return {
    app_id: appId,
    country,
    platform: inferredPlatform,
    platformLabel: platformToLabel(inferredPlatform),
  };
}

function summarizeApparkDetail(value: unknown) {
  const data = apparkPayloadData(value);
  if (!isRecord(data)) return null;
  return {
    app_id: readString(data.app_id) || undefined,
    app_name: readString(data.app_name) || undefined,
    app_url: readString(data.app_url) || undefined,
    developer_name: readString(data.developer_name) || undefined,
    seller_name: readString(data.seller_name) || undefined,
    categories: parseMaybeJson(data.categories),
    tags: parseMaybeJson(data.tags),
    version: readString(data.version) || undefined,
    release_date: readString(data.release_date) || undefined,
    score: readNumber(data.score),
    rating_count: readNumber(data.rating),
    reviews: readNumber(data.reviews),
    downloads: readNumber(data.downloads),
    rating_histogram: isRecord(data.rating_histogram) ? data.rating_histogram : null,
    is_free: typeof data.is_free === 'boolean' ? data.is_free : null,
    price_formatted: readString(data.price_formatted) || undefined,
    is_iap: typeof data.is_iap === 'boolean' ? data.is_iap : null,
    iap_purchase: data.iap_purchase ?? null,
    has_ads: typeof data.has_ads === 'boolean' ? data.has_ads : typeof data.have_ads === 'boolean' ? data.have_ads : null,
    age_group: readString(data.age_group) || undefined,
    file_size_bytes: readString(data.file_size_bytes) || undefined,
    support_website: readString(data.support_website) || undefined,
    privacy_policy: readString(data.privacy_policy) || undefined,
    support_languages: Array.isArray(data.support_languages) ? data.support_languages.slice(0, 20) : [],
    description_excerpt: truncate(readString(data.description), 700),
    version_release_history: summarizeVersionHistory(data.version_release_history),
  };
}

function summarizeApparkCluster(value: unknown) {
  const data = apparkPayloadData(value);
  if (!isRecord(data)) return null;
  return {
    cluster_id: readString(data.cluster_id) || undefined,
    app_name: readString(data.app_name) || undefined,
    develop: readString(data.develop) || undefined,
    company_id: readString(data.company_id) || undefined,
    geo: readString(data.geo) || undefined,
    support_platform: Array.isArray(data.support_platform)
      ? data.support_platform.map(normalizeApparkPlatformNumber).filter(Boolean).map(platformToLabel)
      : [],
    category_id: Array.isArray(data.category_id) ? data.category_id : [],
    tag_id: Array.isArray(data.tag_id) ? data.tag_id : [],
    cluster_list: Array.isArray(data.cluster_list)
      ? data.cluster_list.map(normalizeClusterApp).filter(Boolean).slice(0, 10)
      : [],
    competitor_preview: Array.isArray(data.competitor_list)
      ? data.competitor_list.map(normalizeCompetitorApp).filter(Boolean).slice(0, 12)
      : [],
  };
}

function summarizeApparkDownloadRevenue(value: unknown) {
  const payload = isRecord(value) ? value : null;
  const data = apparkPayloadData(value);
  if (!Array.isArray(data)) return null;
  const rows = data.map(normalizeDownloadRevenueRow).filter((item): item is NonNullable<ReturnType<typeof normalizeDownloadRevenueRow>> => Boolean(item));
  const all = rows.find((row) => row.Country === 'all') || null;
  const topCountriesByDownloads = rows
    .filter((row) => row.Country !== 'all')
    .sort((left, right) => (right.Last30DaysDownloads || 0) - (left.Last30DaysDownloads || 0))
    .slice(0, 12);
  const topCountriesByRevenue = rows
    .filter((row) => row.Country !== 'all')
    .sort((left, right) => (right.Last30DaysRevenue || 0) - (left.Last30DaysRevenue || 0))
    .slice(0, 12);
  return {
    rpd: readNumber(payload?.rpd),
    score: readNumber(payload?.score),
    country_count: rows.length,
    overall: all,
    topCountriesByDownloads,
    topCountriesByRevenue,
  };
}

function summarizeApparkCompetitors(value: unknown) {
  const data = apparkPayloadData(value);
  if (!Array.isArray(data)) return null;
  return {
    total: data.length,
    list: data.map(normalizeCompetitorApp).filter(Boolean).slice(0, 30),
  };
}

function normalizeClusterApp(value: unknown) {
  if (!isRecord(value)) return null;
  const appId = readString(value.app_id);
  const platform = normalizeApparkPlatformNumber(value.platform);
  if (!appId || !platform) return null;
  const supportCountry = isRecord(value.support_country)
    ? Object.entries(value.support_country)
        .filter(([, enabled]) => enabled === 1 || enabled === true)
        .map(([country]) => country)
        .slice(0, 80)
    : [];
  return {
    app_id: appId,
    app_name: readString(value.app_name) || undefined,
    platform: platformToLabel(platform),
    publisher_name: readString(value.publisher_name) || undefined,
    support_country_count: supportCountry.length,
    support_countries: supportCountry,
  };
}

function normalizeCompetitorApp(value: unknown) {
  if (!isRecord(value)) return null;
  const appId = readString(value.app_id);
  if (!appId) return null;
  const platform = normalizeApparkPlatformNumber(value.platform);
  return {
    app_id: appId,
    app_name: readString(value.app_name) || undefined,
    platform: platform ? platformToLabel(platform) : undefined,
    country: normalizeCountry(readString(value.country)),
    score: readNumber(value.score),
    downloads: readNumber(value.downloads),
    publish_store: value.publish_store,
  };
}

function normalizeDownloadRevenueRow(value: unknown) {
  if (!isRecord(value)) return null;
  const country = readString(value.Country);
  if (!country) return null;
  return {
    Country: country,
    Last30DaysRevenue: readNumber(value.Last30DaysRevenue),
    Last30DaysDownloads: readNumber(value.Last30DaysDownloads),
    Last30DaysRevenuePercent: readNumber(value.Last30DaysRevenuePercent),
    Last30DaysDownloadsPercent: readNumber(value.Last30DaysDownloadsPercent),
  };
}

function summarizeVersionHistory(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item) => {
    if (!isRecord(item)) return null;
    const detail = isRecord(item.detail) ? item.detail : {};
    return {
      date: readString(item.date) || readString(detail.updated_date) || undefined,
      version: readString(item.version) || undefined,
      score: readNumber(detail.score),
      ratings: readNumber(detail.ratings),
      summary: truncate(readString(detail.summary), 220),
      recent_changes_notes: truncate(readString(detail.recent_changes_notes), 300),
    };
  }).filter(Boolean);
}

function normalizeApparkPlatform(value: string, appId = ''): ApparkPlatform {
  const normalized = value.trim().toLowerCase();
  if (['ios', 'app_store', 'app-store', 'apple', '1'].includes(normalized)) return 1;
  if (['android', 'google_play', 'google-play', 'googleplay', 'play', '2'].includes(normalized)) return 2;
  if (/^\d+$/.test(appId)) return 1;
  if (appId.includes('.')) return 2;
  return 0;
}

function normalizeApparkPlatformNumber(value: unknown): ApparkPlatform {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return number === 1 || number === 2 ? number : 0;
}

function platformToLabel(platform: ApparkPlatform) {
  if (platform === 1) return 'app_store';
  if (platform === 2) return 'google_play';
  return 'auto';
}

function normalizeCountry(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[a-z]{2}$/.test(normalized) ? normalized : 'us';
}

function normalizeComparableName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function uniqueStrings(values: string[]) {
  const unique = new Map<string, string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized && !unique.has(normalized.toLowerCase())) unique.set(normalized.toLowerCase(), normalized);
  }
  return Array.from(unique.values());
}

function parseMaybeJson(value: unknown) {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function clampInt(value: number | null, min: number, max: number, fallback: number) {
  if (value === null) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function truncate(value: string, maxLength: number) {
  if (!value) return '';
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function readStringFromRecord(value: unknown, key: string) {
  return isRecord(value) ? readString(value[key]) : '';
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDomain(value: string) {
  if (!value) return '';
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withProtocol).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
  }
}

function normalizeUrl(urlValue: string, domainValue: string) {
  if (urlValue) return /^https?:\/\//i.test(urlValue) ? urlValue : `https://${urlValue}`;
  const domain = normalizeDomain(domainValue);
  return domain ? `https://${domain}/` : '';
}

function normalizeAhrefsUrlMetricTarget(urlValue: string, domainValue: string) {
  const raw = urlValue || domainValue;
  if (!raw) return '';
  if (!urlValue) return normalizeDomain(raw);
  const cleaned = raw.replace(/^\/+/, '');
  const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  try {
    const parsed = new URL(withProtocol);
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${parsed.hostname.toLowerCase()}${pathname}${parsed.search}`;
  } catch {
    return cleaned.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

function missingInput(name: string) {
  return { error: `${name} is required.` };
}

function publicArgs(args: Record<string, unknown>) {
  const allowed = [
    'domain',
    'url',
    'appName',
    'appId',
    'platform',
    'country',
    'searchSize',
    'includeDownloadRevenue',
    'includeCompetitors',
    'target',
    'username',
    'since',
    'until',
    'includeOfficial',
    'includeKoc',
    'includeShorts',
    'keywords',
    'channelId',
    'channelName',
    'lang',
    'maxResults',
    'operation',
    'keyword',
    'uniqueId',
    'secUid',
    'cursor',
    'searchId',
    'page',
    'count',
    'maxItems',
  ];
  return Object.fromEntries(Object.entries(args).filter(([key]) => allowed.includes(key)));
}
