import { prisma } from '@/lib/prisma';
import { createChatCompletion, createJsonChatCompletion, getOpenRouterModel, type ChatMessage } from '@/lib/openrouter';
import {
  getArticleDetail,
  getArticleMetrics,
  listArticlesByAccount,
} from '@/lib/wechat-tools/agent';
import { isWechatProviderReady } from '@/lib/wechat-data-provider/raw';
import type { AgentBriefingItem, AgentRunInput, AgentRunResult, AgentRunToolCall, AgentTaskSpec } from '@/lib/agents/types';

const WECHAT_AGENT_TYPE = 'WECHAT';
const HISTORY_PAGE_SIZE = readPositiveIntEnv('EXECUTIVE_WECHAT_SUBAGENT_HISTORY_PAGE_SIZE', 20);
const MAX_PAGES_PER_SOURCE = readPositiveIntEnv('EXECUTIVE_WECHAT_SUBAGENT_MAX_PAGES_PER_SOURCE', 50);
const RUN_BUDGET_MS = readPositiveIntEnv('EXECUTIVE_WECHAT_SUBAGENT_RUN_BUDGET_MS', 240_000);
const PROFILE_STALE_DAYS = readPositiveIntEnv('EXECUTIVE_WECHAT_SOURCE_PROFILE_STALE_DAYS', 30);

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
      title: pickFirstString(item, ['title', 'msg_title', 'name']) || '未命名文章',
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'unknown error';
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
  if (/AI|人工智能|agent|智能体|大模型|LLM|模型|Claude|OpenAI|机器人/i.test(text)) domains.push('人工智能');
  if (/投资|融资|资本|VC|基金|创业|商业|公司|市场/.test(text)) domains.push('创业投资');
  if (/产品|用户|增长|消费|硬件|出海|电商/.test(text)) domains.push('产品与商业');
  if (/代码|编程|开发者|工程|vibe|coding|IDE|开源/i.test(text)) domains.push('开发者工具');
  if (/芯片|算力|硬科技|机器人|制造|硬件/.test(text)) domains.push('硬科技');
  return domains.length > 0 ? domains : ['综合信息'];
}

function inferStyle(text: string) {
  if (/访谈|对话|专访/.test(text)) return '深度访谈';
  if (/日报|快讯|新闻|动态/.test(text)) return '资讯快讯';
  if (/观点|评论|思考|复盘/.test(text)) return '观点评论';
  if (/研究|报告|分析|拆解/.test(text)) return '研究分析';
  return '综合内容';
}

function inferProfile(source: SourceRecord, articles: ArticleCandidate[] = []): SourceProfile {
  const existing = parseSourceProfile(source.profile);
  const titles = articles.map((item) => item.title).filter(Boolean).slice(0, 20);
  const text = [source.displayName, source.description || '', existing?.summary || '', ...titles].join('\n');
  const tokenCandidates = [
    source.displayName,
    ...(source.description || '').split(/[，。；、\s]+/),
    ...titles.flatMap((title) => title.split(/[，。；、｜|\s:：]+/)),
    ...(existing?.keywords || []),
  ].filter((item) => item.length >= 2 && item.length <= 30);

  return {
    topics: uniq([...(existing?.topics || []), ...inferDomains(text), ...titles.slice(0, 5)], 20),
    domains: uniq([...(existing?.domains || []), ...inferDomains(text)], 12),
    style: inferStyle(text) || existing?.style || '综合内容',
    audience: existing?.audience || (/投资|融资|VC|资本/.test(text) ? '投资人与创业者' : '关注相关领域的决策者'),
    keywords: uniq(tokenCandidates, 40),
    negativeKeywords: existing?.negativeKeywords || [],
    summary:
      source.description ||
      existing?.summary ||
      `${source.displayName} 主要围绕 ${inferDomains(text).join('、')} 发布内容。`,
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
      'AI agent',
      'vibe coding',
      '技术趋势',
      '竞品监控',
      '投资机会',
    ],
    timeWindow: {
      type: 'rolling_hours',
      hours: 24,
      endAt: new Date().toISOString(),
    },
    returnFormat: {
      sections: ['核心结论', '证据文章', '机会/风险', '建议动作'],
      instructions: '返回可被晨报秘书合并的结构化中文摘要，必须附来源、链接和发布时间。',
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

function localSourceMatch(source: SourceRecord, taskSpec: AgentTaskSpec) {
  const haystack = JSON.stringify(sourceSummaryForSelection(source)).toLowerCase();
  const criteria = [taskSpec.objective, ...taskSpec.sourceSelectionCriteria].map((item) => item.toLowerCase());
  return criteria.some((item) => item && haystack.includes(item)) || /ai|agent|智能体|大模型|llm|coding|技术|竞品|投资/i.test(haystack);
}

async function selectSourcesForTask(sources: SourceRecord[], taskSpec: AgentTaskSpec): Promise<SourceSelection> {
  const sourceCards = sources.map(sourceSummaryForSelection);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是微信公众号源选择器，只输出JSON。',
        '根据晨报秘书下发的任务，从用户已录入的公众号中选择所有可能相关的源。',
        '不要为了节省数量而截断；只排除明显不相关的源。',
        '如果信息不足但可能相关，应选择。',
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
          skipped: [{ biz: 'biz', reason: '短原因' }],
        },
      }),
    },
  ];

  try {
    const raw = await createJsonChatCompletion(
      messages,
      getOpenRouterModel('WECHAT_SOURCE_SELECTOR'),
      { maxTokens: 4000 }
    );
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
                reason: typeof rawItem.reason === 'string' ? rawItem.reason : '模型判定不相关',
              };
            })
            .filter(Boolean) as Array<{ biz: string; displayName: string; reason: string }>
        : [];
      return { selected, skipped, source: 'MODEL' };
    }
  } catch {
    // Fall back to local profile matching.
  }

  const selected = sources.filter((source) => localSourceMatch(source, taskSpec));
  return {
    selected: selected.length > 0 ? selected : sources,
    skipped: sources
      .filter((source) => selected.length > 0 && !selected.some((item) => item.biz === source.biz))
      .map((source) => ({ biz: source.biz, displayName: source.displayName, reason: '本地画像关键词不匹配' })),
    source: 'FALLBACK',
  };
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

function renderArticles(candidates: ArticleCandidate[]) {
  if (candidates.length === 0) return '无候选文章。';
  return candidates
    .map(
      (item, index) =>
        `${index + 1}. ${item.title}\n来源：${item.sourceName}\n发布时间：${item.publishAt || '未知'}\n链接：${item.url}\n摘要：${item.summary || '无'}`
    )
    .join('\n\n');
}

function buildFallbackAnswer(candidates: ArticleCandidate[], failures: AgentRunToolCall[]) {
  if (candidates.length === 0) {
    const failureText = failures
      .filter((item) => item.status === 'ERROR')
      .map((item) => `${item.toolName}: ${String(item.result || 'unknown error')}`)
      .join('\n');
    return failureText ? `公众号助手没有拿到可用文章，工具异常如下：\n${failureText}` : '公众号助手没有拿到可用文章。';
  }

  return [
    `公众号助手已检索到 ${candidates.length} 篇相关文章/最新文章。`,
    ...candidates.slice(0, 5).map((item, index) => `${index + 1}. ${item.title}（${item.sourceName}，${item.publishAt || '时间未知'}）\n${item.url}`),
  ].join('\n');
}

function toBriefingItems(candidates: ArticleCandidate[], answer: string): AgentBriefingItem[] {
  if (candidates.length === 0) {
    return [
      {
        category: '公众号动态',
        title: '公众号助手未检索到可用文章',
        summary: answer.slice(0, 300),
        source: '公众号助手',
      },
    ];
  }

  return candidates.map((item) => ({
    category: '公众号动态',
    title: item.title,
    summary: item.summary || `来自 ${item.sourceName} 的公众号文章，建议结合正文与指标进一步判断。`,
    source: item.sourceName,
    url: item.url,
    publishedAt: item.publishAt || undefined,
  }));
}

export async function runWechatAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const toolCalls: AgentRunToolCall[] = [];
  const taskSpec = resolveTaskSpec(input);
  const deadlineAt = Date.now() + RUN_BUDGET_MS;

  if (!isWechatProviderReady()) {
    return {
      agentType: WECHAT_AGENT_TYPE,
      answer: '公众号助手不可用：微信公众号数据源未配置。',
      briefingItems: [],
      toolCalls: [
        {
          toolName: 'wechat_provider_ready',
          status: 'ERROR',
          result: '微信公众号数据源未配置',
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
      answer: '公众号助手没有可用公众号源，请先录入公众号。',
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
  const selectedSources = sourceSelection.selected;
  let candidates: ArticleCandidate[] = [];

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

  for (const source of selectedSources) {
    if (Date.now() >= deadlineAt) {
      toolCalls.push({
        toolName: 'wechat_run_budget',
        status: 'ERROR',
        result: `Stopped before scanning all sources after ${RUN_BUDGET_MS}ms budget.`,
      });
      break;
    }

    const sourceArticles: ArticleCandidate[] = [];
    for (let page = 1; page <= MAX_PAGES_PER_SOURCE; page += 1) {
      if (Date.now() >= deadlineAt) break;
      try {
        const result = await listArticlesByAccount({
          biz: source.biz,
          name: source.displayName,
          lastArticleUrl: source.lastArticleUrl,
          page,
          count: HISTORY_PAGE_SIZE,
        });
        const providerError = getProviderError(result);
        const articles = toArticleCandidates(source.displayName, source.biz, result);
        const recentArticles = articles.filter((article) => isWithinWindow(article, taskSpec.windowStart, taskSpec.windowEnd));
        candidates.push(...recentArticles);
        sourceArticles.push(...articles);
        toolCalls.push({
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
            ? { error: providerError, count: articles.length, recentCount: recentArticles.length, sample: articles.slice(0, 3) }
            : { count: articles.length, recentCount: recentArticles.length, sample: articles.slice(0, 3) },
        });
        if (providerError && articles.length === 0) break;
        if (shouldStopPaging(articles, taskSpec.windowStart)) break;
      } catch (error) {
        toolCalls.push({
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
      toolCalls.push({
        toolName: 'updateWechatSourceProfile',
        status: 'SUCCESS',
        args: { biz: source.biz, name: source.displayName },
        result: compact(updatedProfile),
      });
    }
  }

  candidates = candidates
    .filter((candidate, index, arr) => arr.findIndex((item) => item.url === candidate.url) === index)
    .sort((a, b) => (parsePublishDate(b.publishAt)?.getTime() || 0) - (parsePublishDate(a.publishAt)?.getTime() || 0));

  const details: Array<{ url: string; detail: unknown }> = [];
  for (const article of candidates) {
    if (Date.now() >= deadlineAt) break;
    try {
      const detail = await getArticleDetail({ url: article.url });
      details.push({ url: article.url, detail });
      toolCalls.push({
        toolName: 'getArticleDetail',
        status: 'SUCCESS',
        args: { url: article.url },
        result: compact(detail),
      });
    } catch (error) {
      toolCalls.push({
        toolName: 'getArticleDetail',
        status: 'ERROR',
        args: { url: article.url },
        result: getErrorMessage(error),
      });
    }
  }

  const metrics: Array<{ url: string; metrics: unknown }> = [];
  for (const article of candidates) {
    if (Date.now() >= deadlineAt) break;
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
  if (candidates.length > 0) {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          '你是微信公众号AI员工，是总裁秘书Momo的子agent。',
          '你只基于工具拿到的最近24小时公众号文章、正文和指标做摘要，不编造。',
          '必须严格服务总裁秘书下发的整理目标和格式要求。',
          '输出中文，给出外界信息、技术趋势、竞品/机会信号，并附关键来源。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `总裁秘书请求：${input.userQuery}`,
          `微信agent任务：${JSON.stringify(taskSpec)}`,
          `选中的公众号：${selectedSources.map((source) => `${source.displayName}(${source.biz})`).join('、')}`,
          `跳过的公众号：${sourceSelection.skipped.map((source) => `${source.displayName}: ${source.reason}`).join('；') || '无'}`,
          `候选文章：\n${renderArticles(candidates)}`,
          `正文抓取结果：\n${JSON.stringify(details.map((item) => ({ url: item.url, detail: compact(item.detail) })))}`,
          `指标抓取结果：\n${JSON.stringify(metrics.map((item) => ({ url: item.url, metrics: compact(item.metrics) })))}`,
        ].join('\n\n'),
      },
    ];
    try {
      answer = (await createChatCompletion(messages, getOpenRouterModel('WECHAT_AGENT'))).trim();
    } catch {
      answer = buildFallbackAnswer(candidates, toolCalls);
    }
  } else {
    answer = buildFallbackAnswer(candidates, toolCalls);
  }

  return {
    agentType: WECHAT_AGENT_TYPE,
    answer,
    briefingItems: toBriefingItems(candidates, answer),
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
      detailCount: details.length,
      metricsCount: metrics.length,
      profileRefreshCount: sourcesNeedingProfile.length,
    },
  };
}
