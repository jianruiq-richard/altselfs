import { prisma } from '@/lib/prisma';
import { createChatCompletion, type ChatMessage } from '@/lib/openrouter';
import {
  getArticleDetail,
  getArticleMetrics,
  listArticlesByAccount,
} from '@/lib/wechat-tools/agent';
import { isWechatProviderReady } from '@/lib/wechat-data-provider/raw';
import type { AgentBriefingItem, AgentRunInput, AgentRunResult, AgentRunToolCall } from '@/lib/agents/types';

const WECHAT_AGENT_TYPE = 'WECHAT';
const DEFAULT_SOURCE_LIMIT = readPositiveIntEnv('EXECUTIVE_WECHAT_SUBAGENT_MAX_SOURCES', 8);
const DEFAULT_ARTICLE_LIMIT = readPositiveIntEnv('EXECUTIVE_WECHAT_SUBAGENT_MAX_ARTICLES', 24);
const DEFAULT_DETAIL_LIMIT = readPositiveIntEnv('EXECUTIVE_WECHAT_SUBAGENT_DETAIL_FETCHES', 4);
const DEFAULT_METRICS_LIMIT = readPositiveIntEnv('EXECUTIVE_WECHAT_SUBAGENT_METRICS_FETCHES', 6);

type SourceRecord = {
  displayName: string;
  biz: string;
  description: string | null;
  lastArticleUrl: string;
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

function chooseSources(sources: SourceRecord[], query: string) {
  const normalized = query.toLowerCase();
  const matched = sources.filter(
    (source) =>
      normalized.includes(source.displayName.toLowerCase()) ||
      normalized.includes(source.biz.toLowerCase())
  );
  return (matched.length > 0 ? matched : sources).slice(0, DEFAULT_SOURCE_LIMIT);
}

function maybeTodayArticles(candidates: ArticleCandidate[], query: string) {
  if (!/今天|今日|当天|24小时|最新/.test(query)) return candidates;
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const tokens = [`${yyyy}-${mm}-${dd}`, `${yyyy}/${mm}/${dd}`, `${mm}-${dd}`, `${mm}/${dd}`];
  const filtered = candidates.filter((item) => item.publishAt && tokens.some((token) => item.publishAt?.includes(token)));
  return filtered.length > 0 ? filtered : candidates;
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
  const top = candidates.slice(0, 6);
  if (top.length === 0) {
    return [
      {
        category: '公众号动态',
        title: '公众号助手未检索到可用文章',
        summary: answer.slice(0, 300),
        source: '公众号助手',
      },
    ];
  }

  return top.map((item) => ({
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
    take: 100,
    select: {
      displayName: true,
      biz: true,
      description: true,
      lastArticleUrl: true,
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

  const selectedSources = chooseSources(validSources, input.userQuery);
  let candidates: ArticleCandidate[] = [];
  const listSettled = await Promise.allSettled(
    selectedSources.map(async (source) => {
      const result = await listArticlesByAccount({
        biz: source.biz,
        name: source.displayName,
        page: 1,
        count: Math.min(DEFAULT_ARTICLE_LIMIT, 20),
      });
      return { source, result };
    })
  );

  for (const item of listSettled) {
    if (item.status !== 'fulfilled') {
      toolCalls.push({
        toolName: 'listArticlesByAccount',
        status: 'ERROR',
        result: getErrorMessage(item.reason),
      });
      continue;
    }
    const articles = toArticleCandidates(item.value.source.displayName, item.value.source.biz, item.value.result);
    candidates.push(...articles);
    toolCalls.push({
      toolName: 'listArticlesByAccount',
      status: 'SUCCESS',
      args: { biz: item.value.source.biz, name: item.value.source.displayName },
      result: { count: articles.length, sample: articles.slice(0, 3) },
    });
  }

  candidates = maybeTodayArticles(candidates, input.userQuery)
    .filter((candidate, index, arr) => arr.findIndex((item) => item.url === candidate.url) === index)
    .slice(0, DEFAULT_ARTICLE_LIMIT);

  const detailTargets = candidates.slice(0, DEFAULT_DETAIL_LIMIT);
  const detailSettled = await Promise.allSettled(
    detailTargets.map(async (article) => ({
      url: article.url,
      detail: await getArticleDetail({ url: article.url }),
    }))
  );
  const details: Array<{ url: string; detail: unknown }> = [];
  for (const item of detailSettled) {
    if (item.status !== 'fulfilled') {
      toolCalls.push({
        toolName: 'getArticleDetail',
        status: 'ERROR',
        result: getErrorMessage(item.reason),
      });
      continue;
    }
    details.push(item.value);
    toolCalls.push({
      toolName: 'getArticleDetail',
      status: 'SUCCESS',
      args: { url: item.value.url },
      result: compact(item.value.detail),
    });
  }

  const metricTargets = candidates.slice(0, DEFAULT_METRICS_LIMIT);
  const metricsSettled = await Promise.allSettled(
    metricTargets.map(async (article) => ({
      url: article.url,
      metrics: await getArticleMetrics({ url: article.url }),
    }))
  );
  const metrics: Array<{ url: string; metrics: unknown }> = [];
  for (const item of metricsSettled) {
    if (item.status !== 'fulfilled') {
      toolCalls.push({
        toolName: 'getArticleMetrics',
        status: 'ERROR',
        result: getErrorMessage(item.reason),
      });
      continue;
    }
    metrics.push(item.value);
    toolCalls.push({
      toolName: 'getArticleMetrics',
      status: 'SUCCESS',
      args: { url: item.value.url },
      result: compact(item.value.metrics),
    });
  }

  let answer = '';
  if (candidates.length > 0) {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          '你是微信公众号AI员工，是总裁秘书Momo的子agent。',
          '你只基于工具拿到的公众号文章、正文和指标做摘要，不编造。',
          '输出中文，给出外界信息、技术趋势、竞品/机会信号，并附关键来源。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `总裁秘书请求：${input.userQuery}`,
          `候选文章：\n${renderArticles(candidates)}`,
          `正文抓取结果：\n${JSON.stringify(details.map((item) => ({ url: item.url, detail: compact(item.detail) })))}`,
          `指标抓取结果：\n${JSON.stringify(metrics.map((item) => ({ url: item.url, metrics: compact(item.metrics) })))}`,
        ].join('\n\n'),
      },
    ];
    try {
      answer = (await createChatCompletion(messages)).trim();
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
      validSourceCount: validSources.length,
      selectedSourceCount: selectedSources.length,
      articleCount: candidates.length,
      detailCount: details.length,
      metricsCount: metrics.length,
    },
  };
}
