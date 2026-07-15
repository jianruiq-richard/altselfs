import { prisma } from '@/lib/prisma';
import { createJsonChatCompletion, getOpenRouterModel, type ChatMessage } from '@/lib/openrouter';
import {
  getArticleDetail,
  getArticleMetrics,
  listArticlesByAccount,
} from '@/lib/wechat-tools/agent';
import { isWechatProviderReady } from '@/lib/wechat-data-provider/raw';
import type { AgentBriefingItem, AgentRunInput, AgentRunResult, AgentRuntoolCall, AgentTaskSpec } from '@/lib/agents/types';

const WECHAT_AGENT_TYPE = 'WECHAT';
const HISTORY_PAGE_SIZE = readPositiveIntEnv('EXECUTIVE_WECHAT_SUBAGENT_HISTORY_PAGE_SIZE', 20);
const DETAIL_FETCH_LIMIT = readPositiveIntEnv('EXECUTIVE_WECHAT_SUBAGENT_DETAIL_FETCH_LIMIT', 0);
const METRICS_FETCH_LIMIT = readPositiveIntEnv('EXECUTIVE_WECHAT_SUBAGENT_METRICS_FETCH_LIMIT', 0);
const PROFILE_STALE_DAYS = readPositiveIntEnv('EXECUTIVE_WECHAT_SOURCE_PROFILE_STALE_DAYS', 30);
const SOURCE_CONCURRENCY = readPositiveIntEnv('EXECUTIVE_WECHAT_SOURCE_CONCURRENCY', 4);
const SELECTED_DETAIL_LIMIT = readPositiveIntEnv('EXECUTIVE_WECHAT_SELECTED_DETAIL_LIMIT', 50);
const DETAIL_CONCURRENCY = readPositiveIntEnv('EXECUTIVE_WECHAT_DETAIL_CONCURRENCY', 3);
const ARTICLE_SUMMARY_CONCURRENCY = readPositiveIntEnv('EXECUTIVE_WECHAT_ARTICLE_SUMMARY_CONCURRENCY', 5);

const MODULE_TITLES = ['Information Digest'] as const;
type WechatModuleTitle = (typeof MODULE_TITLES)[number];

type SourceRecord = {
  id: string;
  displayName: string;
  biz: string;
  description: string | null;
  lastArticleUrl: string;
  profile: unknown;
  profileUpdatedAt: Date | null;
  profileConfidence: number | null;
  updatedAt: Date;
};

type ArticleCandidate = {
  sourceName: string;
  biz: string;
  title: string;
  url: string;
  publishAt: string | null;
  summary: string;
};

type SelectedArticle = ArticleCandidate & {
  category: WechatModuleTitle;
  reason: string;
  priority: number;
};

type DetailedArticle = SelectedArticle & {
  detail?: unknown;
  detailText: string;
};

type ArticleInsight = {
  article: SelectedArticle;
  include: boolean;
  category: WechatModuleTitle;
  summary: string;
  whyItMatters: string;
};

type WechatStructuredModule = {
  title: WechatModuleTitle;
  content: string;
  items: AgentBriefingItem[];
};

type WechatStructuredSummary = {
  summary: string;
  modules: WechatStructuredModule[];
};

type SourceProfile = {
  topics: string[];
  domains: string[];
  style: string;
  audience: string;
  keywords: string[];
  negativeKeywords: string[];
  summary: string;
  lastObservedArticleTitles?: string[];
};

type SourceSelection = {
  selected: SourceRecord[];
  skipped: Array<{ biz: string; displayName: string; reason: string }>;
  source: 'MODEL' | 'FALLBACK';
};

function readPositiveIntEnv(key: string, fallback: number) {
  const value = Number(process.env[key]);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.round(value);
}

function isValidBiz(value: string) {
  const biz = value.trim();
  if (!biz) return false;
  if (biz.includes('${') || biz.includes('window.') || biz.includes('{') || biz.includes('}')) return false;
  return /^(Mz[A-Za-z0-9+/_=-]{8,}|[A-Za-z0-9+/_=-]{12,})$/.test(biz);
}

function asList(payload: unknown) {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.data)) return root.data as Record<string, unknown>[];
  if (root.data && typeof root.data === 'object') {
    const d = root.data as Record<string, unknown>;
    if (Array.isArray(d.list)) return d.list as Record<string, unknown>[];
    if (Array.isArray(d.rows)) return d.rows as Record<string, unknown>[];
    if (Array.isArray(d.items)) return d.items as Record<string, unknown>[];
  }
  if (Array.isArray(root.list)) return root.list as Record<string, unknown>[];
  if (Array.isArray(root.rows)) return root.rows as Record<string, unknown>[];
  if (Array.isArray(root.items)) return root.items as Record<string, unknown>[];
  return [];
}

function pickFirstString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function toArticleCandidates(sourceName: string, biz: string, payload: unknown): ArticleCandidate[] {
  return asList(payload)
    .map((item) => ({
      sourceName,
      biz,
      title: pickFirstString(item, ['title', 'msg_title', 'name']) || 'instruction',
      url: pickFirstString(item, ['url', 'article_url', 'link', 'content_url']),
      publishAt: pickFirstString(item, ['publish_time', 'pub_time', 'datetime', 'time', 'date']) || null,
      summary: pickFirstString(item, ['digest', 'summary', 'abstract', 'desc']),
    }))
    .filter((item) => item.url);
}

function getProviderError(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const root = payload as Record<string, unknown>;
  const code = root.code;
  const failed =
    (typeof code === 'number' && code !== 0) ||
    (typeof code === 'string' && code.trim() && code.trim() !== '0');
  if (!failed) return '';
  const msg = typeof root.msg === 'string' ? root.msg : typeof root.message === 'string' ? root.message : '';
  return msg ? `code=${String(code)} ${msg}` : `code=${String(code)}`;
}

function getPayloadString(payload: unknown, keys: string[]) {
  if (!payload || typeof payload !== 'object') return '';
  const root = payload as Record<string, unknown>;
  const rootValue = pickFirstString(root, keys);
  if (rootValue) return rootValue;
  if (root.data && typeof root.data === 'object') {
    return pickFirstString(root.data as Record<string, unknown>, keys);
  }
  return '';
}

function getHistoryCursor(payload: unknown) {
  return getPayloadString(payload, ['cursor', 'next_cursor', 'nextCursor']);
}

function getResolvedWechatId(payload: unknown) {
  return getPayloadString(payload, ['resolvedWxid', 'wxid', 'user_name', 'origin_id', 'gh_id', 'wx_user']);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'unknown error';
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function compact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 5).map((item) => compact(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 10)) {
      out[key] = compact(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results: Array<R | undefined> = [];
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    })
  );
  return results.filter((item): item is R => item !== undefined);
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : [];
}

function parseSourceProfile(value: unknown): SourceProfile | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  return {
    topics: asStringArray(raw.topics).slice(0, 30),
    domains: asStringArray(raw.domains).slice(0, 20),
    style: typeof raw.style === 'string' ? raw.style : '',
    audience: typeof raw.audience === 'string' ? raw.audience : '',
    keywords: asStringArray(raw.keywords).slice(0, 50),
    negativeKeywords: asStringArray(raw.negativeKeywords).slice(0, 50),
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    lastObservedArticleTitles: asStringArray(raw.lastObservedArticleTitles).slice(0, 20),
  };
}

function shouldRefreshProfile(source: SourceRecord) {
  if (!parseSourceProfile(source.profile)) return true;
  if (!source.profileUpdatedAt) return true;
  return Date.now() - source.profileUpdatedAt.getTime() > PROFILE_STALE_DAYS * 24 * 60 * 60 * 1000;
}

function uniq(values: string[], limit: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function inferDomains(text: string) {
  const domains: string[] = [];
  if (/AI|instruction|agent|instruction|instruction|LLM|instruction|Claude|OpenAI|instruction/i.test(text)) domains.push('instruction');
  if (/instruction|instruction|instruction|VC|instruction|instruction|instruction|instruction|instruction/.test(text)) domains.push('instruction');
  if (/instruction|instruction|instruction|instruction|instruction|instruction|instruction/.test(text)) domains.push('instruction');
  if (/instruction|instruction|instruction|instruction|vibe|coding|IDE|instruction/i.test(text)) domains.push('instructiontool');
  if (/instruction|instruction|instruction|instruction|instruction|instruction/.test(text)) domains.push('instruction');
  return domains.length > 0 ? domains : ['instruction'];
}

function inferStyle(text: string) {
  if (/instruction|instruction|instruction/.test(text)) return 'instruction';
  if (/instruction|instruction|instruction|instruction/.test(text)) return 'instruction';
  if (/instruction|instruction|instruction|instruction/.test(text)) return 'instruction';
  if (/instruction|instruction|instruction|instruction/.test(text)) return 'instruction';
  return 'instruction';
}

function inferProfile(source: SourceRecord, articles: ArticleCandidate[] = []): SourceProfile {
  const existing = parseSourceProfile(source.profile);
  const titles = articles.map((item) => item.title).filter(Boolean).slice(0, 20);
  const text = [source.displayName, source.description || '', existing?.summary || '', ...titles].join('\n');
  const tokenCandidates = [
    source.displayName,
    ...(source.description || '').split(/[, .; , \s]+/),
    ...titles.flatMap((title) => title.split(/[, .; , ｜|\s:: ]+/)),
    ...(existing?.keywords || []),
  ].filter((item) => item.length >= 2 && item.length <= 30);

  return {
    topics: uniq([...(existing?.topics || []), ...inferDomains(text), ...titles.slice(0, 5)], 20),
    domains: uniq([...(existing?.domains || []), ...inferDomains(text)], 12),
    style: inferStyle(text) || existing?.style || 'instruction',
    audience: existing?.audience || (/instruction|instruction|VC|instruction/.test(text) ? 'instruction' : 'instruction'),
    keywords: uniq(tokenCandidates, 40),
    negativeKeywords: existing?.negativeKeywords || [],
    summary:
      source.description ||
      existing?.summary ||
      `${source.displayName} instruction ${inferDomains(text).join(', ')} instruction.`,
    lastObservedArticleTitles: titles.length > 0 ? titles : existing?.lastObservedArticleTitles || [],
  };
}

async function updateSourceProfile(source: SourceRecord, articles: ArticleCandidate[]) {
  if (!shouldRefreshProfile(source) && articles.length === 0) return null;
  const profile = inferProfile(source, articles);
  await prisma.investorWechatSource.update({
    where: { id: source.id },
    data: {
      profile,
      profileUpdatedAt: new Date(),
      profileConfidence: articles.length > 0 ? 0.7 : 0.45,
      lastProfileEvidence: {
        description: source.description,
        articleTitles: articles.map((item) => item.title).slice(0, 20),
      },
    },
  });
  return profile;
}

function defaultTaskSpec(input: AgentRunInput): AgentTaskSpec {
  return {
    objective: input.userQuery,
    sourceSelectionCriteria: [
      input.userQuery,
      'Information Digest',
    ],
    timeWindow: {
      type: 'rolling_hours',
      hours: 24,
      endAt: new Date().toISOString(),
    },
    returnFormat: {
      sections: ['Information Digest'],
      instructions: 'instructionInformation Digestinstruction, instruction, instruction.Today To-DosinstructionExecutive Assistantinstruction; Twin Recommendationsinstruction, instructionWeChat Assistantinstruction.',
    },
  };
}

function resolveTaskSpec(input: AgentRunInput) {
  const fromContext = input.context?.taskSpec;
  const base = fromContext?.objective ? fromContext : defaultTaskSpec(input);
  const endAt = base.timeWindow?.type === 'rolling_hours' ? new Date(base.timeWindow.endAt) : new Date();
  const safeEndAt = Number.isFinite(endAt.getTime()) ? endAt : new Date();
  const hours =
    base.timeWindow?.type === 'rolling_hours' && Number.isFinite(base.timeWindow.hours) && base.timeWindow.hours > 0
      ? base.timeWindow.hours
      : 24;
  const windowStart = new Date(safeEndAt.getTime() - hours * 60 * 60 * 1000);

  return {
    ...base,
    timeWindow: {
      type: 'rolling_hours' as const,
      hours,
      endAt: safeEndAt.toISOString(),
    },
    windowStart,
    windowEnd: safeEndAt,
  };
}

function sourceSummaryForSelection(source: SourceRecord) {
  const profile = parseSourceProfile(source.profile) || inferProfile(source);
  return {
    biz: source.biz,
    name: source.displayName,
    description: source.description || '',
    topics: profile.topics,
    domains: profile.domains,
    style: profile.style,
    audience: profile.audience,
    keywords: profile.keywords.slice(0, 20),
    summary: profile.summary,
  };
}

async function selectSourcesForTask(sources: SourceRecord[], taskSpec: AgentTaskSpec): Promise<SourceSelection> {
  const sourceCards = sources.map(sourceSummaryForSelection);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'instructionWeChat Official Accountsinstruction, instructionJSON.',
        'instruction, instruction.',
        'instruction; instruction.',
        'instruction, instruction.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: {
          objective: taskSpec.objective,
          sourceSelectionCriteria: taskSpec.sourceSelectionCriteria,
          timeWindow: taskSpec.timeWindow,
          returnFormat: taskSpec.returnFormat,
        },
        sources: sourceCards,
        outputSchema: {
          selectedBizes: ['biz'],
          skipped: [{ biz: 'biz', reason: 'instruction' }],
        },
      }),
    },
  ];

  const raw = await createJsonChatCompletion(
    messages,
    getOpenRouterModel('WECHAT_SOURCE_SELECTOR'),
    { maxTokens: 12000 }
  );

  try {
    const parsed = JSON.parse(raw) as { selectedBizes?: unknown; skipped?: unknown };
    const selectedBizes = new Set(asStringArray(parsed.selectedBizes));
    const selected = sources.filter((source) => selectedBizes.has(source.biz));
    if (selected.length > 0) {
      const skipped = Array.isArray(parsed.skipped)
        ? parsed.skipped
            .map((item) => {
              if (!item || typeof item !== 'object') return null;
              const rawItem = item as Record<string, unknown>;
              const biz = typeof rawItem.biz === 'string' ? rawItem.biz : '';
              const source = sources.find((it) => it.biz === biz);
              if (!source) return null;
              return {
                biz,
                displayName: source.displayName,
                reason: typeof rawItem.reason === 'string' ? rawItem.reason : 'instruction',
              };
            })
            .filter(Boolean) as Array<{ biz: string; displayName: string; reason: string }>
        : [];
      return { selected, skipped, source: 'MODEL' };
    }
    throw new Error('instruction.');
  } catch (error) {
    const detail = getErrorMessage(error);
    throw new Error(`instruction JSON instructionfailed: ${detail}.instruction: ${raw.slice(0, 800)}`);
  }
}

function parsePublishDate(value: string | null) {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000);
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw));
  const normalized = raw.replace(/\./g, '-').replace(/\//g, '-');
  const withTimeZone =
    /^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)
      ? `${normalized}T00:00:00+08:00`
      : /^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}/.test(normalized)
        ? `${normalized.replace(/\s+/, 'T')}+08:00`
        : raw;
  const parsed = new Date(withTimeZone);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isWithinWindow(article: ArticleCandidate, start: Date, end: Date) {
  const publishedAt = parsePublishDate(article.publishAt);
  if (!publishedAt) return false;
  return publishedAt.getTime() >= start.getTime() && publishedAt.getTime() <= end.getTime();
}

function shouldStopPaging(articles: ArticleCandidate[], windowStart: Date) {
  if (articles.length === 0) return true;
  const dated = articles.map((article) => parsePublishDate(article.publishAt)).filter(Boolean) as Date[];
  if (dated.length === 0) return true;
  return dated.every((date) => date.getTime() < windowStart.getTime());
}

function selectFortoolFetch<T>(candidates: T[], limit: number) {
  if (limit <= 0) return [];
  return candidates.slice(0, limit);
}

function classifyArticleByText(article: ArticleCandidate): WechatModuleTitle {
  return 'Information Digest';
}

function toSelectionCards(candidates: ArticleCandidate[], sources: SourceRecord[]) {
  const sourceByBiz = new Map(sources.map((source) => [source.biz, source]));
  return candidates.map((article, index) => {
    const source = sourceByBiz.get(article.biz);
    const profile = source ? parseSourceProfile(source.profile) || inferProfile(source) : null;
    return {
      index,
      title: article.title,
      source: article.sourceName,
      biz: article.biz,
      publishedAt: article.publishAt,
      digest: article.summary,
      sourceProfile: profile
        ? {
            domains: profile.domains,
            style: profile.style,
            audience: profile.audience,
            keywords: profile.keywords.slice(0, 12),
            summary: profile.summary,
          }
        : null,
    };
  });
}

function normalizeSelectedArticles(raw: unknown, candidates: ArticleCandidate[]) {
  if (!raw || typeof raw !== 'object') return [];
  const selected = Array.isArray((raw as Record<string, unknown>).selected)
    ? ((raw as Record<string, unknown>).selected as Record<string, unknown>[])
    : [];
  const byUrl = new Map(candidates.map((item) => [item.url, item]));
  const byIndex = new Map(candidates.map((item, index) => [index, item]));
  const seen = new Set<string>();
  const out: SelectedArticle[] = [];
  for (const item of selected) {
    const index = Number(item.index ?? item.i);
    const url = asString(item.url);
    const article = (Number.isInteger(index) ? byIndex.get(index) : undefined) || byUrl.get(url);
    if (!article || seen.has(article.url)) continue;
    seen.add(article.url);
    const rawCategory = item.category ?? item.c;
    const category = MODULE_TITLES.includes(rawCategory as WechatModuleTitle)
      ? (rawCategory as WechatModuleTitle)
      : classifyArticleByText(article);
    out.push({
      ...article,
      category,
      reason: asString(item.reason ?? item.r, 'instruction').slice(0, 80),
      priority: Number.isFinite(Number(item.priority ?? item.p)) ? Number(item.priority ?? item.p) : 50,
    });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

async function selectArticlesForDetail(input: {
  candidates: ArticleCandidate[];
  sources: SourceRecord[];
  taskSpec: AgentTaskSpec & { windowStart: Date; windowEnd: Date };
}) {
  if (input.candidates.length === 0) return { selected: [] as SelectedArticle[], raw: null, source: 'EMPTY' };
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'instructionWeChat Official Accountsinstruction, instructionJSON.',
        'instructionExecutive Assistantinstruction, instruction, instruction24instruction.',
        'instruction, instruction.',
        'WeChat Official Accountsinstruction"Information Digest"instruction; instructionToday To-DosinstructionTwin Recommendations.',
        'Today To-DosinstructionExecutive Assistantinstruction; Twin Recommendationsinstruction.',
        'instruction; instruction.',
        'instruction, selectedinstructionurl, instruction, instruction; instructionindexinstruction.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: {
          objective: input.taskSpec.objective,
          sourceSelectionCriteria: input.taskSpec.sourceSelectionCriteria,
          returnFormat: input.taskSpec.returnFormat,
          timeWindow: input.taskSpec.timeWindow,
        },
        maxSelected: SELECTED_DETAIL_LIMIT,
        articles: toSelectionCards(input.candidates, input.sources),
        outputSchema: {
          selected: [
            {
              i: 0,
              c: 'Information Digest',
              p: 0,
              r: '20instruction',
            },
          ],
          skippedReasonSummary: '30instructionSkippedinstruction',
        },
        hardRules: [
          'selectedinstruction i/c/p/r.',
          'instructionurl.',
          'instruction.',
          'instruction.',
          'rinstruction, instruction20instruction.',
        ],
      }),
    },
  ];

  const raw = await createJsonChatCompletion(
    messages,
    getOpenRouterModel('WECHAT_SOURCE_SELECTOR'),
    { maxTokens: 12000 }
  );

  try {
    const parsed = JSON.parse(raw);
    const selected = normalizeSelectedArticles(parsed, input.candidates).slice(0, SELECTED_DETAIL_LIMIT);
    return { selected, raw: parsed, source: 'MODEL' };
  } catch (error) {
    const detail = getErrorMessage(error);
    throw new Error(`instruction JSON instructionfailed: ${detail}.instruction: ${raw.slice(0, 800)}`);
  }
}

function extractDetailText(detail: unknown) {
  if (!detail || typeof detail !== 'object') return '';
  const root = detail as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : {};
  const text = pickFirstString(data, ['text', 'content', 'article_content', 'html', 'digest', 'summary']) ||
    pickFirstString(root, ['text', 'content', 'article_content', 'html', 'digest', 'summary']);
  return text.replace(/\s+/g, ' ').trim().slice(0, 3000);
}

function normalizeStructuredItem(raw: unknown, fallbackCategory: WechatModuleTitle): AgentBriefingItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const title = asString(item.title).slice(0, 160);
  const summary = asString(item.summary).slice(0, 700);
  const source = asString(item.source, 'WeChat Official Accountsinstruction').slice(0, 120);
  if (!title || !summary) return null;
  return {
    category: fallbackCategory,
    title,
    summary: asString(item.whyItMatters)
      ? `${summary}\ninstruction: ${asString(item.whyItMatters).slice(0, 300)}`
      : summary,
    source,
    url: asString(item.url) || undefined,
    publishedAt: asString(item.publishedAt) || undefined,
  };
}

function normalizeStructuredModule(raw: unknown, title: WechatModuleTitle): WechatStructuredModule {
  if (!raw || typeof raw !== 'object') return { title, content: `instruction${title}.`, items: [] };
  const rawModule = raw as Record<string, unknown>;
  const items = Array.isArray(rawModule.items)
    ? rawModule.items.map((item) => normalizeStructuredItem(item, title)).filter((item): item is AgentBriefingItem => Boolean(item))
    : [];
  return {
    title,
    content: asString(rawModule.content, items.map((item) => item.summary).join('\n')).slice(0, 2000),
    items,
  };
}

function normalizeWechatStructuredSummary(raw: string): WechatStructuredSummary {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const modules = parsed.modules && typeof parsed.modules === 'object' ? (parsed.modules as Record<string, unknown>) : {};
  return {
    summary: asString(parsed.summary, 'WeChat Official AccountsinstructionCompletedinstruction.').slice(0, 2000),
    modules: [
      normalizeStructuredModule(modules.informationSummary, 'Information Digest'),
    ],
  };
}

function emptyStructuredSummary(): WechatStructuredSummary {
  return {
    summary: 'WeChat Official Accountsinstruction.',
    modules: MODULE_TITLES.map((title) => ({
      title,
      content: `instruction${title}.`,
      items: [],
    })),
  };
}

function normalizeArticleInsight(raw: string, article: SelectedArticle): ArticleInsight {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const rawCategory = asString(parsed.category);
  const category = MODULE_TITLES.includes(rawCategory as WechatModuleTitle)
    ? (rawCategory as WechatModuleTitle)
    : article.category;
  return {
    article,
    include: parsed.include !== false,
    category,
    summary: asString(parsed.summary, article.summary || article.reason).slice(0, 700),
    whyItMatters: asString(parsed.whyItMatters, article.reason).slice(0, 300),
  };
}

async function summarizeArticleInsight(input: {
  taskSpec: AgentTaskSpec;
  article: SelectedArticle;
  detailText: string;
}) {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'instructionWeChat Official Accountsinstruction, instructionJSON.',
        'instruction, instruction, instruction.',
        'instructionWeChat Official AccountsinstructionDecideinstruction, instruction.',
        'instruction; instruction, instruction, instruction, instructionagentinstruction.',
        'instruction"Information Digest".Today To-DosinstructionExecutive Assistantinstruction; Twin Recommendationsinstruction.',
        'instruction, instruction.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        wechatTask: {
          objective: input.taskSpec.objective,
          sourceSelectionCriteria: input.taskSpec.sourceSelectionCriteria,
          timeWindow: input.taskSpec.timeWindow,
          returnFormat: input.taskSpec.returnFormat,
        },
        article: {
          title: input.article.title,
          source: input.article.sourceName,
          publishedAt: input.article.publishAt,
          digest: input.article.summary,
          selectedCategory: input.article.category,
          selectedReason: input.article.reason,
          detailText: input.detailText || input.article.summary,
        },
        outputSchema: {
          include: true,
          category: 'Information Digest',
          summary: '120instruction, instruction, instruction',
          whyItMatters: '80instruction, instructionInformation Digest',
        },
      }),
    },
  ];

  const raw = await createJsonChatCompletion(
    messages,
    getOpenRouterModel('WECHAT_AGENT'),
    { maxTokens: 1800 }
  );

  try {
    return normalizeArticleInsight(raw, input.article);
  } catch (error) {
    const detail = getErrorMessage(error);
    throw new Error(`instructionSummary JSON instructionfailed: ${detail}.instruction: ${input.article.title}.instruction: ${raw.slice(0, 800)}`);
  }
}

function buildModuleContent(title: WechatModuleTitle, items: AgentBriefingItem[]) {
  if (items.length === 0) return `instruction${title}.`;
  return items
    .slice(0, 50)
    .map((item, index) => `${index + 1}. ${item.title}: ${item.summary}`)
    .join('\n');
}

function buildWechatStructuredSummaryFromInsights(insights: ArticleInsight[]): WechatStructuredSummary {
  const included = insights.filter((item) => item.include && item.summary);
  if (included.length === 0) return emptyStructuredSummary();
  const modules = MODULE_TITLES.map((title) => {
    const items = included
      .filter((item) => item.category === title)
      .slice(0, 50)
      .map((item) => ({
        category: title,
        title: item.article.title,
        summary: item.whyItMatters ? `${item.summary}\ninstruction: ${item.whyItMatters}` : item.summary,
        source: item.article.sourceName,
        url: item.article.url,
        publishedAt: item.article.publishAt || undefined,
      }));
    return {
      title,
      content: buildModuleContent(title, items),
      items,
    };
  });
  return {
    summary: `WeChat Official Accountsinstruction ${included.length} instruction24instruction, instructionInformation DigestinstructionExecutive Assistant.`,
    modules,
  };
}

function renderStructuredSummary(structured: WechatStructuredSummary) {
  return [
    structured.summary,
    ...structured.modules.map((module) => [
      `## ${module.title}`,
      module.content,
      ...module.items.map((item, index) => `${index + 1}. ${item.title}\n${item.summary}\nSource: ${item.source}${item.url ? ` ${item.url}` : ''}`),
    ].join('\n')),
  ].join('\n\n');
}

function buildFallbackAnswer(candidates: ArticleCandidate[], failures: AgentRuntoolCall[]) {
  if (candidates.length === 0) {
    const failureText = failures
      .filter((item) => item.status === 'ERROR')
      .map((item) => `${item.toolName}: ${String(item.result || 'unknown error')}`)
      .join('\n');
    return failureText ? `WeChat Assistantinstruction, toolinstruction: \n${failureText}` : 'WeChat Assistantinstruction.';
  }

  return [
    `WeChat Assistantinstruction ${candidates.length} instruction/instruction.`,
    ...candidates.slice(0, 5).map((item, index) => `${index + 1}. ${item.title} (${item.sourceName}, ${item.publishAt || 'instruction'})\n${item.url}`),
  ].join('\n');
}

function toBriefingItems(candidates: ArticleCandidate[], answer: string, structured?: WechatStructuredSummary): AgentBriefingItem[] {
  const structuredItems = structured?.modules.flatMap((module) => module.items) || [];
  if (structuredItems.length > 0) return structuredItems;

  if (candidates.length === 0) {
    return [
      {
        category: 'Information Digest',
        title: 'WeChat Assistantinstruction',
        summary: answer.slice(0, 300),
        source: 'WeChat Assistant',
      },
    ];
  }

  return candidates.map((item) => ({
    category: 'Information Digest',
    title: item.title,
    summary: item.summary || `instruction ${item.sourceName} instruction, instructionDecide.`,
    source: item.sourceName,
    url: item.url,
    publishedAt: item.publishAt || undefined,
  }));
}

export async function runWechatAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const toolCalls: AgentRuntoolCall[] = [];
  const taskSpec = resolveTaskSpec(input);
  console.log('[wechat-agent] start', {
    investorId: input.investorId,
    objective: taskSpec.objective,
    windowStart: taskSpec.windowStart.toISOString(),
    windowEnd: taskSpec.windowEnd.toISOString(),
  });

  if (!isWechatProviderReady()) {
    return {
      agentType: WECHAT_AGENT_TYPE,
      answer: 'WeChat Assistantinstruction: WeChat Official Accountsinstruction.',
      briefingItems: [],
      toolCalls: [
        {
          toolName: 'wechat_provider_ready',
          status: 'ERROR',
          result: 'WeChat Official Accountsinstruction',
        },
      ],
    };
  }

  const sources = await prisma.investorWechatSource.findMany({
    where: { investorId: input.investorId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      displayName: true,
      biz: true,
      description: true,
      lastArticleUrl: true,
      profile: true,
      profileUpdatedAt: true,
      profileConfidence: true,
      updatedAt: true,
    },
  });

  const validSources = sources.filter((source) => isValidBiz(source.biz));
  if (validSources.length === 0) {
    return {
      agentType: WECHAT_AGENT_TYPE,
      answer: 'WeChat Assistantinstruction, instruction.',
      briefingItems: [],
      toolCalls,
      debug: { sourceCount: sources.length, validSourceCount: 0 },
    };
  }

  const sourcesNeedingProfile = validSources.filter(shouldRefreshProfile);
  await Promise.allSettled(sourcesNeedingProfile.map((source) => updateSourceProfile(source, [])));

  const refreshedSources = sourcesNeedingProfile.length
    ? await prisma.investorWechatSource.findMany({
        where: { investorId: input.investorId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          displayName: true,
          biz: true,
          description: true,
          lastArticleUrl: true,
          profile: true,
          profileUpdatedAt: true,
          profileConfidence: true,
          updatedAt: true,
        },
      })
    : validSources;
  const refreshedValidSources = refreshedSources.filter((source) => isValidBiz(source.biz));
  const sourceSelection = await selectSourcesForTask(refreshedValidSources, taskSpec);
  const selectedSources = [...new Map(sourceSelection.selected.map((source) => [source.biz, source])).values()];
  let candidates: ArticleCandidate[] = [];
  console.log('[wechat-agent] source selection', {
    validSourceCount: refreshedValidSources.length,
    selectedSourceCount: selectedSources.length,
    sourceConcurrency: SOURCE_CONCURRENCY,
    selector: sourceSelection.source,
    selectedSources: selectedSources.map((source) => source.displayName),
  });

  toolCalls.push({
    toolName: 'selectWechatSources',
    status: 'SUCCESS',
    args: {
      objective: taskSpec.objective,
      sourceSelectionCriteria: taskSpec.sourceSelectionCriteria,
      timeWindow: taskSpec.timeWindow,
    },
    result: {
      selector: sourceSelection.source,
      selectedCount: selectedSources.length,
      selectedSources: selectedSources.map((source) => source.displayName),
      skippedCount: sourceSelection.skipped.length,
      skippedSources: sourceSelection.skipped.slice(0, 20),
    },
  });

  const scanSource = async (source: SourceRecord) => {
    const localtoolCalls: AgentRuntoolCall[] = [];
    const localCandidates: ArticleCandidate[] = [];

    const sourceArticles: ArticleCandidate[] = [];
    const sourceSeenUrls = new Set<string>();
    let cursor: string | undefined;
    let resolvedWechatId: string | undefined;
    let page = 1;
    console.log('[wechat-agent] scan source start', {
      source: source.displayName,
      biz: source.biz,
    });
    while (true) {
      try {
        const result = await listArticlesByAccount({
          biz: source.biz,
          wechatId: resolvedWechatId,
          name: source.displayName,
          lastArticleUrl: resolvedWechatId ? undefined : source.lastArticleUrl,
          page,
          cursor,
          count: HISTORY_PAGE_SIZE,
        });
        const providerError = getProviderError(result);
        resolvedWechatId ||= getResolvedWechatId(result) || undefined;
        const nextCursor = getHistoryCursor(result) || undefined;
        const articles = toArticleCandidates(source.displayName, source.biz, result);
        console.log('[wechat-agent] list page', {
          source: source.displayName,
          page,
          cursor: cursor || null,
          nextCursor: nextCursor || null,
          resolvedWechatId: resolvedWechatId || null,
          count: articles.length,
          providerError: providerError || null,
        });
        const newArticles = articles.filter((article) => {
          const key = article.url;
          if (!key || sourceSeenUrls.has(key)) return false;
          sourceSeenUrls.add(key);
          return true;
        });
        if (articles.length > 0 && newArticles.length === 0) {
          console.log('[wechat-agent] stop source duplicate page', {
            source: source.displayName,
            page,
            count: articles.length,
          });
          localtoolCalls.push({
            toolName: 'listArticlesByAccount',
            status: 'SUCCESS',
            args: {
              biz: source.biz,
              name: source.displayName,
              page,
              count: HISTORY_PAGE_SIZE,
              rollingWindow: taskSpec.timeWindow,
            },
            result: {
              count: articles.length,
              recentCount: 0,
              stopped: 'duplicate_page',
              sample: articles.slice(0, 3),
            },
          });
          break;
        }
        const recentArticles = articles.filter((article) => isWithinWindow(article, taskSpec.windowStart, taskSpec.windowEnd));
        localCandidates.push(...recentArticles);
        sourceArticles.push(...newArticles);
        localtoolCalls.push({
          toolName: 'listArticlesByAccount',
          status: providerError && articles.length === 0 ? 'ERROR' : 'SUCCESS',
          args: {
            biz: source.biz,
            name: source.displayName,
            page,
            count: HISTORY_PAGE_SIZE,
            rollingWindow: taskSpec.timeWindow,
          },
          result: providerError
            ? { error: providerError, count: articles.length, newCount: newArticles.length, recentCount: recentArticles.length, sample: newArticles.slice(0, 3) }
            : { count: articles.length, newCount: newArticles.length, recentCount: recentArticles.length, sample: newArticles.slice(0, 3) },
        });
        if (providerError && articles.length === 0) break;
        if (shouldStopPaging(newArticles, taskSpec.windowStart)) {
          console.log('[wechat-agent] stop source older than window', {
            source: source.displayName,
            page,
            newCount: newArticles.length,
          });
          break;
        }
        if (articles.length > 0 && !nextCursor) {
          console.log('[wechat-agent] stop source no cursor', {
            source: source.displayName,
            page,
            count: articles.length,
          });
          break;
        }
        cursor = nextCursor;
        page += 1;
      } catch (error) {
        console.error('[wechat-agent] list page failed', {
          source: source.displayName,
          page,
          error: getErrorMessage(error),
        });
        localtoolCalls.push({
          toolName: 'listArticlesByAccount',
          status: 'ERROR',
          args: { biz: source.biz, name: source.displayName, page },
          result: getErrorMessage(error),
        });
        break;
      }
    }

    await prisma.investorWechatSource.update({
      where: { id: source.id },
      data: { lastScannedAt: new Date() },
    });
    const updatedProfile = await updateSourceProfile(source, sourceArticles);
    if (updatedProfile) {
      localtoolCalls.push({
        toolName: 'updateWechatSourceProfile',
        status: 'SUCCESS',
        args: { biz: source.biz, name: source.displayName },
        result: compact(updatedProfile),
      });
    }

    return { candidates: localCandidates, toolCalls: localtoolCalls };
  };

  const sourceResults: Array<{ candidates: ArticleCandidate[]; toolCalls: AgentRuntoolCall[] } | undefined> = [];
  let nextSourceIndex = 0;
  const workerCount = Math.max(1, Math.min(SOURCE_CONCURRENCY, selectedSources.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextSourceIndex;
      nextSourceIndex += 1;
      const source = selectedSources[index];
      if (!source) return;
      sourceResults[index] = await scanSource(source);
    }
  });
  await Promise.all(workers);
  for (const result of sourceResults) {
    if (!result) continue;
    candidates.push(...result.candidates);
    toolCalls.push(...result.toolCalls);
  }

  candidates = candidates
    .filter((candidate, index, arr) => arr.findIndex((item) => item.url === candidate.url) === index)
    .sort((a, b) => (parsePublishDate(b.publishAt)?.getTime() || 0) - (parsePublishDate(a.publishAt)?.getTime() || 0));
  console.log('[wechat-agent] candidates ready', {
    articleCount: candidates.length,
  });

  const articleSelection = await selectArticlesForDetail({
    candidates,
    sources: refreshedValidSources,
    taskSpec,
  });
  toolCalls.push({
    toolName: 'selectWechatArticlesForDetail',
    status: 'SUCCESS',
    args: {
      objective: taskSpec.objective,
      articleCount: candidates.length,
      selectedDetailLimit: SELECTED_DETAIL_LIMIT,
    },
    result: {
      selector: articleSelection.source,
      selectedCount: articleSelection.selected.length,
      selected: articleSelection.selected.map((article) => ({
        title: article.title,
        source: article.sourceName,
        url: article.url,
        category: article.category,
        reason: article.reason,
        priority: article.priority,
      })),
      raw: compact(articleSelection.raw),
    },
  });

  const details: Array<{ url: string; detail: unknown }> = [];
  const detailedArticles: DetailedArticle[] = [];
  const detailTextByUrl = new Map<string, string>();
  const detailTargets = selectFortoolFetch(articleSelection.selected, DETAIL_FETCH_LIMIT > 0 ? DETAIL_FETCH_LIMIT : SELECTED_DETAIL_LIMIT);
  const detailResults = await mapWithConcurrency(detailTargets, DETAIL_CONCURRENCY, async (article) => {
    try {
      const detail = await getArticleDetail({ url: article.url });
      return {
        article,
        detail,
        toolCall: {
          toolName: 'getArticleDetail',
          status: 'SUCCESS' as const,
          args: { url: article.url, title: article.title, category: article.category },
          result: compact(detail),
        },
      };
    } catch (error) {
      return {
        article,
        toolCall: {
          toolName: 'getArticleDetail',
          status: 'ERROR' as const,
          args: { url: article.url, title: article.title, category: article.category },
          result: getErrorMessage(error),
        },
      };
    }
  });
  for (const item of detailResults) {
    toolCalls.push(item.toolCall);
    if (item.detail !== undefined) {
      details.push({ url: item.article.url, detail: item.detail });
      const detailedArticle = {
        ...item.article,
        detail: item.detail,
        detailText: extractDetailText(item.detail),
      };
      detailedArticles.push(detailedArticle);
      detailTextByUrl.set(item.article.url, detailedArticle.detailText);
    }
  }

  const metrics: Array<{ url: string; metrics: unknown }> = [];
  const metricTargets = selectFortoolFetch(articleSelection.selected, METRICS_FETCH_LIMIT);
  for (const article of metricTargets) {
    try {
      const metric = await getArticleMetrics({ url: article.url });
      metrics.push({ url: article.url, metrics: metric });
      toolCalls.push({
        toolName: 'getArticleMetrics',
        status: 'SUCCESS',
        args: { url: article.url },
        result: compact(metric),
      });
    } catch (error) {
      toolCalls.push({
        toolName: 'getArticleMetrics',
        status: 'ERROR',
        args: { url: article.url },
        result: getErrorMessage(error),
      });
    }
  }

  let answer = '';
  let structuredSummary: WechatStructuredSummary | undefined;
  let articleInsights: ArticleInsight[] = [];
  if (candidates.length > 0) {
    articleInsights = await mapWithConcurrency(
      articleSelection.selected,
      ARTICLE_SUMMARY_CONCURRENCY,
      async (article) => summarizeArticleInsight({
        taskSpec,
        article,
        detailText: detailTextByUrl.get(article.url) || article.summary,
      })
    );
    structuredSummary = buildWechatStructuredSummaryFromInsights(articleInsights);
    toolCalls.push({
      toolName: 'summarizeWechatArticlesToModules',
      status: 'SUCCESS',
      args: {
        selectedCount: articleSelection.selected.length,
        detailedCount: detailedArticles.length,
        insightCount: articleInsights.length,
        articleSummaryConcurrency: ARTICLE_SUMMARY_CONCURRENCY,
        modules: MODULE_TITLES,
      },
      result: compact(structuredSummary),
    });
    answer = renderStructuredSummary(structuredSummary);
  } else {
    answer = buildFallbackAnswer(candidates, toolCalls);
  }

  return {
    agentType: WECHAT_AGENT_TYPE,
    answer,
    briefingItems: toBriefingItems(candidates, answer, structuredSummary),
    toolCalls,
    debug: {
      sourceCount: sources.length,
      validSourceCount: refreshedValidSources.length,
      selectedSourceCount: selectedSources.length,
      skippedSourceCount: sourceSelection.skipped.length,
      selector: sourceSelection.source,
      windowStart: taskSpec.windowStart.toISOString(),
      windowEnd: taskSpec.windowEnd.toISOString(),
      articleCount: candidates.length,
      selectedArticleCount: articleSelection.selected.length,
      detailCount: details.length,
      metricsCount: metrics.length,
      detailFetchLimit: DETAIL_FETCH_LIMIT,
      selectedDetailLimit: SELECTED_DETAIL_LIMIT,
      detailConcurrency: DETAIL_CONCURRENCY,
      articleSummaryConcurrency: ARTICLE_SUMMARY_CONCURRENCY,
      articleInsightCount: articleInsights.length,
      metricsFetchLimit: METRICS_FETCH_LIMIT,
      sourceConcurrency: SOURCE_CONCURRENCY,
      structuredModules: structuredSummary
        ? structuredSummary.modules.map((module) => ({ title: module.title, itemCount: module.items.length }))
        : [],
      pagingStopPolicy: 'stop on duplicate page, empty/error response, all page articles older than rolling window, or missing cursor',
      profileRefreshCount: sourcesNeedingProfile.length,
    },
  };
}
