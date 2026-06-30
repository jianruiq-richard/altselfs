import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerConfig } from '../config.js';
import { isRecord } from '../util.js';

type RapidApiToolSpec = {
  provider: string;
  source: string;
  host: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, config: ServerConfig) => Promise<unknown>;
};

const TOOLS: RapidApiToolSpec[] = [
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

export function getRapidApiCompetitorToolNamesForProviders(providers: Iterable<string>) {
  const enabled = new Set(Array.from(providers, (provider) => provider.toLowerCase()));
  return TOOLS.filter((tool) => enabled.has(tool.provider)).map((tool) => tool.name);
}

export function createRapidApiCompetitorDynamicTools(providers?: Iterable<string>) {
  const enabled = providers ? new Set(Array.from(providers, (provider) => provider.toLowerCase())) : null;
  return TOOLS.filter((tool) => !enabled || enabled.has(tool.provider)).map((tool) => ({
    namespace: null,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    deferLoading: false,
  }));
}

export async function runRapidApiCompetitorTool(toolName: string, argumentsValue: unknown, config: ServerConfig) {
  const tool = TOOLS.find((item) => item.name === toolName);
  if (!tool) return JSON.stringify({ source: 'rapidapi-competitor', error: `Unsupported tool: ${toolName}` });
  const args = isRecord(argumentsValue) ? argumentsValue : {};
  const configured = Boolean(process.env[config.rapidApiKeyEnv]?.trim());
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
      limitations: [
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
      limitations: ['The RapidAPI request failed, the provider rate-limited the request, or the domain is not covered.'],
    }, null, 2);
  }
}

export function isRapidApiCompetitorTool(toolName: string) {
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
  return TOOLS.map((tool) => {
    const rawQuota = data[tool.host];
    const quota: Record<string, unknown> | null = isRecord(rawQuota) ? rawQuota : null;
    const remaining = readNumber(quota?.remaining);
    const limit = readNumber(quota?.limit);
    const reset = typeof quota?.reset === 'string' ? quota.reset : '';
    return {
      provider: 'RapidAPI',
      account: tool.host,
      fingerprint: configured ? 'ECS key configured' : '未配置',
      balance: remaining !== null && limit !== null ? `${remaining.toLocaleString()} / ${limit.toLocaleString()}` : configured ? '未采集' : '未知',
      usage: reset ? `reset ${reset}` : quota ? `HTTP ${String(quota.status || 'unknown')}` : '等待下一次调用采集',
      status: !configured ? 'unknown' : remaining === null || limit === null ? 'unknown' : remaining <= 0 ? 'critical' : remaining / limit < 0.1 ? 'warning' : 'ok',
      updatedAt: typeof quota?.updatedAt === 'string' ? quota.updatedAt : new Date().toISOString(),
      note: quota ? '来自最近一次 RapidAPI 响应头' : '该订阅源还没有采集到 quota headers',
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

function missingInput(name: string) {
  return { error: `${name} is required.` };
}

function publicArgs(args: Record<string, unknown>) {
  const allowed = ['domain', 'url'];
  return Object.fromEntries(Object.entries(args).filter(([key]) => allowed.includes(key)));
}
