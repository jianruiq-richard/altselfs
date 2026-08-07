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
  ];
  return Object.fromEntries(Object.entries(args).filter(([key]) => allowed.includes(key)));
}
