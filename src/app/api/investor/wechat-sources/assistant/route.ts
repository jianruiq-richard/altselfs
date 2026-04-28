import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createChatCompletion, createJsonChatCompletion, type ChatMessage } from '@/lib/openrouter';
import { getInvestorOrNull } from '@/lib/investor-auth';
import {
  appendThreadMessage,
  appendToolCall,
  ensureThread,
  getLatestThreadWithMessages,
  toClientMessages,
} from '@/lib/agent-session';
import {
  getArticleComments,
  getArticleDetail,
  getArticleMetrics,
  listArticlesByAccount,
  searchArticles,
  searchRealtimeArticles,
} from '@/lib/wechat-tools/agent';
import {
  getWechatDataProviderLabel,
  getWechatProviderRequiredEnv,
  isWechatProviderReady,
} from '@/lib/wechat-data-provider/raw';

export const maxDuration = 300;

const WECHAT_PROVIDER = 'WECHAT';
const MAX_CUSTOM_PROMPT_LENGTH = 8000;
const DEFAULT_MAX_SOURCES = readPositiveIntEnv('WECHAT_ASSISTANT_DEFAULT_MAX_SOURCES', 12);
const DEFAULT_MAX_ARTICLES = readPositiveIntEnv('WECHAT_ASSISTANT_DEFAULT_MAX_ARTICLES', 40);
const DEFAULT_DETAIL_FETCHES = readPositiveIntEnv('WECHAT_ASSISTANT_DEFAULT_DETAIL_FETCHES', 8);
const DEFAULT_METRICS_FETCHES = readPositiveIntEnv('WECHAT_ASSISTANT_DEFAULT_METRICS_FETCHES', 12);
const MAX_PLAN_SOURCES = readPositiveIntEnv('WECHAT_ASSISTANT_MAX_PLAN_SOURCES', 50);
const MAX_PLAN_ARTICLES = readPositiveIntEnv('WECHAT_ASSISTANT_MAX_PLAN_ARTICLES', 120);
const SOURCE_QUERY_LIMIT = readPositiveIntEnv('WECHAT_ASSISTANT_SOURCE_QUERY_LIMIT', 100);
const PER_SOURCE_HISTORY_LIMIT = readPositiveIntEnv('WECHAT_ASSISTANT_PER_SOURCE_HISTORY_LIMIT', 20);
const MAX_TOOL_LOG_DEPTH = 4;
const MAX_TOOL_LOG_KEYS = 12;
const MAX_TOOL_LOG_ITEMS = 4;
const MAX_TOOL_LOG_STRING = 600;

type ClientMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type SourceRecord = {
  displayName: string;
  biz: string;
  lastArticleUrl: string;
  updatedAt: Date;
};

type PlannerAction =
  | 'list_source_articles'
  | 'search_global_articles'
  | 'get_article_detail'
  | 'get_article_metrics'
  | 'get_article_comments'
  | 'mixed_analysis'
  | 'clarify';

type WechatToolPlan = {
  action: PlannerAction;
  reason?: string;
  args?: {
    bizList?: string[];
    keyword?: string;
    dateFrom?: string;
    dateTo?: string;
    targetUrl?: string;
    articleUrls?: string[];
    commentId?: string;
    buffer?: string;
    contentId?: string;
    maxReplyId?: string;
    offset?: number;
    maxSources?: number;
    maxArticles?: number;
    realtime?: boolean;
  };
};

type ArticleCandidate = {
  sourceName: string;
  biz: string;
  title: string;
  url: string;
  publishAt: string | null;
  summary: string;
};

type ToolResultEntry = {
  tool: string;
  result: unknown;
};

type ToolFailureEntry = {
  tool: string;
  target?: string;
  detail: string;
};

function readPositiveIntEnv(key: string, fallback: number) {
  const value = Number(process.env[key]);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.round(value);
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isValidBiz(value: string) {
  const biz = value.trim();
  if (!biz) return false;
  if (biz.includes('${') || biz.includes('window.') || biz.includes('{') || biz.includes('}')) return false;
  return /^(Mz[A-Za-z0-9+/_=-]{8,}|[A-Za-z0-9+/_=-]{12,})$/.test(biz);
}

function normalizeMessages(raw: unknown): ClientMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const role = (item as { role?: string })?.role;
      const content = (item as { content?: string })?.content;
      if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()) {
        return { role, content: content.trim() } as ClientMessage;
      }
      return null;
    })
    .filter(Boolean) as ClientMessage[];
}

function extractJsonObject(raw: string): string | null {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fence && fence.trim().startsWith('{') && fence.trim().endsWith('}')) return fence.trim();
  const left = raw.indexOf('{');
  const right = raw.lastIndexOf('}');
  if (left >= 0 && right > left) return raw.slice(left, right + 1);
  return null;
}

function safeParsePlan(raw: string): WechatToolPlan {
  try {
    const parsed = JSON.parse(extractJsonObject(raw) ?? raw) as Partial<WechatToolPlan>;
    const allowed = new Set<PlannerAction>([
      'list_source_articles',
      'search_global_articles',
      'get_article_detail',
      'get_article_metrics',
      'get_article_comments',
      'mixed_analysis',
      'clarify',
    ]);
    const action = allowed.has(parsed.action as PlannerAction)
      ? (parsed.action as PlannerAction)
      : 'clarify';
    const bizList = Array.isArray(parsed.args?.bizList)
      ? parsed.args.bizList
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((x) => x.trim())
      : [];
    const articleUrls = Array.isArray(parsed.args?.articleUrls)
      ? parsed.args.articleUrls
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((x) => x.trim())
      : [];

    return {
      action,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      args: {
        bizList,
        keyword: typeof parsed.args?.keyword === 'string' ? parsed.args.keyword.trim() : undefined,
        dateFrom: typeof parsed.args?.dateFrom === 'string' ? parsed.args.dateFrom.trim() : undefined,
        dateTo: typeof parsed.args?.dateTo === 'string' ? parsed.args.dateTo.trim() : undefined,
        targetUrl: typeof parsed.args?.targetUrl === 'string' ? parsed.args.targetUrl.trim() : undefined,
        articleUrls,
        commentId: typeof parsed.args?.commentId === 'string' ? parsed.args.commentId.trim() : undefined,
        buffer: typeof parsed.args?.buffer === 'string' ? parsed.args.buffer.trim() : undefined,
        contentId: typeof parsed.args?.contentId === 'string' ? parsed.args.contentId.trim() : undefined,
        maxReplyId: typeof parsed.args?.maxReplyId === 'string' ? parsed.args.maxReplyId.trim() : undefined,
        offset:
          typeof parsed.args?.offset === 'number'
            ? Math.max(0, Math.round(parsed.args.offset))
            : undefined,
        maxSources:
          typeof parsed.args?.maxSources === 'number'
            ? clampInt(parsed.args.maxSources, 1, MAX_PLAN_SOURCES)
            : undefined,
        maxArticles:
          typeof parsed.args?.maxArticles === 'number'
            ? clampInt(parsed.args.maxArticles, 1, MAX_PLAN_ARTICLES)
            : undefined,
        realtime: Boolean(parsed.args?.realtime),
      },
    };
  } catch {
    return { action: 'clarify', reason: 'planner parse failed', args: {} };
  }
}

function buildSystemPrompt(customPrompt?: string | null) {
  const lines = [
    '你是投资人的微信公众号AI员工。',
    '你会先通过工具获取文章列表/正文/指标，再给出结论。',
    '必须基于工具结果回答，不可编造。',
    '输出简洁中文，优先给可执行结论。',
  ];
  if (customPrompt?.trim()) {
    lines.push('用户自定义调教要求：');
    lines.push(customPrompt.trim());
  }
  return lines.join('\n');
}

function buildPlannerPrompt(input: { userQuery: string; sources: SourceRecord[]; messages: ClientMessage[] }) {
  const sourceText =
    input.sources.length === 0
      ? '无'
      : input.sources.map((source, i) => `${i + 1}. ${source.displayName} | biz=${source.biz}`).join('\n');
  const history = input.messages
    .slice(-8)
    .map((message, i) => `${i + 1}. [${message.role}] ${message.content}`)
    .join('\n');

  return [
    '你是函数规划器，只返回 JSON。',
    '你要选择 action 并提供 args，驱动后端工具执行。',
    'action 候选：',
    '1) list_source_articles: 在用户已录入公众号里查文章列表（按日期/关键词）',
    '2) search_global_articles: 用全网搜索查文章',
    '3) get_article_detail: 抓单篇或多篇文章正文',
    '4) get_article_metrics: 抓文章阅读/点赞等指标',
    '5) get_article_comments: 抓文章留言（支持自动先解析 comment_id）',
    '6) mixed_analysis: 先列文章再抓正文/指标（推荐默认）',
    '7) clarify: 信息不足，先追问',
    'JSON Schema:',
    '{',
    '  "action":"list_source_articles|search_global_articles|get_article_detail|get_article_metrics|get_article_comments|mixed_analysis|clarify",',
    '  "reason":"短原因",',
    '  "args":{',
    '    "bizList":["可选"],',
    '    "keyword":"可选关键词",',
    '    "dateFrom":"可选 YYYY-MM-DD",',
    '    "dateTo":"可选 YYYY-MM-DD",',
    '    "targetUrl":"可选，单篇 URL",',
    '    "articleUrls":["可选，多个 URL"],',
    '    "commentId":"可选，已知留言ID时可直接用",',
    '    "buffer":"可选，留言翻页游标",',
    '    "contentId":"可选，一级留言ID（拉回复）",',
    '    "maxReplyId":"可选，最大回复ID（拉回复）",',
    '    "offset":0,',
    `    "maxSources":"可选，1-${MAX_PLAN_SOURCES}",`,
    `    "maxArticles":"可选，1-${MAX_PLAN_ARTICLES}",`,
    '    "realtime":true/false',
    '  }',
    '}',
    `用户问题：${input.userQuery}`,
    `用户录入公众号：\n${sourceText}`,
    `最近对话：\n${history || '无'}`,
  ].join('\n');
}

function pickFirstString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
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

function toArticleCandidates(sourceName: string, biz: string, payload: unknown): ArticleCandidate[] {
  const list = asList(payload);
  return list
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

function chooseSources(sources: SourceRecord[], plan: WechatToolPlan, userQuery: string) {
  const maxSources = plan.args?.maxSources || DEFAULT_MAX_SOURCES;
  if (plan.args?.bizList && plan.args.bizList.length > 0) {
    return sources.filter((source) => plan.args?.bizList?.includes(source.biz)).slice(0, maxSources);
  }
  const normalized = userQuery.toLowerCase();
  const matched = sources.filter(
    (source) =>
      normalized.includes(source.displayName.toLowerCase()) || normalized.includes(source.biz.toLowerCase())
  );
  return (matched.length > 0 ? matched : sources).slice(0, maxSources);
}

function renderCandidates(candidates: ArticleCandidate[]) {
  if (candidates.length === 0) return '无候选文章。';
  return candidates
    .map(
      (item, i) =>
        `${i + 1}. ${item.title}\n` +
        `来源：${item.sourceName}（biz: ${item.biz}）\n` +
        `发布时间：${item.publishAt || '未知'}\n` +
        `链接：${item.url}\n` +
        `摘要：${item.summary || '无'}`
    )
    .join('\n\n');
}

function renderToolResults(results: Array<{ tool: string; result: unknown }>) {
  if (results.length === 0) return '无工具结果。';
  return results.map((r, i) => `${i + 1}. ${r.tool}\n${JSON.stringify(r.result)}`).join('\n\n');
}

function renderToolFailures(failures: ToolFailureEntry[]) {
  if (failures.length === 0) return '无工具异常。';
  return failures
    .map((item, index) => `${index + 1}. ${item.tool}${item.target ? `(${item.target})` : ''}: ${item.detail}`)
    .join('\n');
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'unknown error';
}

function compactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length <= MAX_TOOL_LOG_STRING) return value;
    return `${value.slice(0, MAX_TOOL_LOG_STRING)}...[truncated ${value.length - MAX_TOOL_LOG_STRING} chars]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_TOOL_LOG_DEPTH) return '[truncated depth]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_TOOL_LOG_ITEMS).map((item) => compactValue(item, depth + 1));
    if (value.length > MAX_TOOL_LOG_ITEMS) {
      items.push(`[truncated ${value.length - MAX_TOOL_LOG_ITEMS} items]`);
    }
    return items;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_TOOL_LOG_KEYS);
    const next: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      next[key] = compactValue(item, depth + 1);
    }
    const totalKeys = Object.keys(value as Record<string, unknown>).length;
    if (totalKeys > MAX_TOOL_LOG_KEYS) {
      next.__truncatedKeys = totalKeys - MAX_TOOL_LOG_KEYS;
    }
    return next;
  }
  return String(value);
}

function summarizeToolPayload(payload: unknown) {
  return compactValue(payload, 0);
}

async function logToolCallSafe(params: {
  threadId: string;
  messageId?: string | null;
  toolName: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  status?: 'SUCCESS' | 'ERROR';
}) {
  try {
    await appendToolCall({
      threadId: params.threadId,
      messageId: params.messageId,
      toolName: params.toolName,
      toolArgs: summarizeToolPayload(params.toolArgs),
      toolResult: summarizeToolPayload(params.toolResult),
      status: params.status || 'SUCCESS',
    });
  } catch (error) {
    console.error(`[wechat-assistant] failed to append tool log (${params.toolName}):`, error);
  }
}

function pushToolFailure(
  failures: ToolFailureEntry[],
  tool: string,
  error: unknown,
  target?: string
) {
  failures.push({
    tool,
    target,
    detail: getErrorMessage(error),
  });
}

function extractCommentIdFromDetail(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
  const commentId = data.comment_id;
  if (typeof commentId === 'string' && commentId.trim()) return commentId.trim();
  if (typeof commentId === 'number') return String(commentId);
  return '';
}

export async function DELETE() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const deleted = await prisma.agentThread.deleteMany({
    where: {
      investorId: investor.id,
      agentType: WECHAT_PROVIDER,
    },
  });

  return NextResponse.json({ ok: true, deletedThreads: deleted.count });
}

export async function GET() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [integration, thread] = await Promise.all([
    prisma.investorIntegration.findUnique({
      where: { investorId_provider: { investorId: investor.id, provider: WECHAT_PROVIDER } },
      select: { assistantCustomPrompt: true },
    }),
    getLatestThreadWithMessages(investor.id, WECHAT_PROVIDER),
  ]);

  return NextResponse.json({
    customPrompt: integration?.assistantCustomPrompt || '',
    thread: thread
      ? {
          id: thread.id,
          messages: toClientMessages(thread.messages),
        }
      : null,
  });
}

export async function PUT(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { customPrompt?: string };
  const customPrompt = String(body.customPrompt || '');
  if (customPrompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `调教内容过长，最多 ${MAX_CUSTOM_PROMPT_LENGTH} 字符` },
      { status: 400 }
    );
  }

  const integration = await prisma.investorIntegration.upsert({
    where: {
      investorId_provider: {
        investorId: investor.id,
        provider: WECHAT_PROVIDER,
      },
    },
    create: {
      investorId: investor.id,
      provider: WECHAT_PROVIDER,
      status: 'CONNECTED',
      accountName: '微信公众号AI员工',
      assistantCustomPrompt: customPrompt,
    },
    update: {
      assistantCustomPrompt: customPrompt,
    },
    select: {
      assistantCustomPrompt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    integration: {
      customPrompt: integration.assistantCustomPrompt || '',
    },
  });
}

export async function POST(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { messages?: unknown; threadId?: string };
  const messages = normalizeMessages(body.messages);
  if (messages.length === 0) return NextResponse.json({ error: '消息不能为空' }, { status: 400 });

  const thread = await ensureThread({
    investorId: investor.id,
    agentType: WECHAT_PROVIDER,
    threadId: typeof body.threadId === 'string' ? body.threadId : null,
  });

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  let userMessageId: string | null = null;
  if (lastUser) {
    const saved = await appendThreadMessage({
      threadId: thread.id,
      role: 'USER',
      content: lastUser.content,
    });
    userMessageId = saved.id;
  }

  if (!isWechatProviderReady()) {
    const provider = getWechatDataProviderLabel();
    const requiredEnv = getWechatProviderRequiredEnv();
    const reply = `公众号数据源未配置（provider=${provider}，缺少 ${requiredEnv}），请先配置后再使用。`;
    await appendThreadMessage({ threadId: thread.id, role: 'ASSISTANT', content: reply });
    return NextResponse.json({ ok: true, reply, threadId: thread.id });
  }

  const [sources, integration] = await Promise.all([
    prisma.investorWechatSource.findMany({
      where: { investorId: investor.id },
      orderBy: { updatedAt: 'desc' },
      take: SOURCE_QUERY_LIMIT,
      select: {
        displayName: true,
        biz: true,
        lastArticleUrl: true,
        updatedAt: true,
      },
    }),
    prisma.investorIntegration.findUnique({
      where: {
        investorId_provider: {
          investorId: investor.id,
          provider: WECHAT_PROVIDER,
        },
      },
      select: {
        assistantCustomPrompt: true,
      },
    }),
  ]);

  if (sources.length === 0) {
    const reply = '当前没有可用公众号源。请先录入公众号，再进行文章检索。';
    await appendThreadMessage({ threadId: thread.id, role: 'ASSISTANT', content: reply });
    return NextResponse.json({ ok: true, reply, threadId: thread.id });
  }

  const validSources = sources.filter((source) => isValidBiz(source.biz));
  const invalidSources = sources.filter((source) => !isValidBiz(source.biz));
  if (validSources.length === 0) {
    const names = invalidSources.map((item) => item.displayName).join('、');
    const reply = `当前录入的公众号标识异常（例如包含模板占位符），请删除并重录。异常项：${names || '未知'}`;
    await appendThreadMessage({ threadId: thread.id, role: 'ASSISTANT', content: reply });
    return NextResponse.json({ ok: true, reply, threadId: thread.id });
  }

  const userQuery =
    [...messages].reverse().find((m) => m.role === 'user')?.content || messages[messages.length - 1].content;

  const plannerInput: ChatMessage[] = [
    { role: 'system', content: '你是严格JSON输出规划器。' },
    {
      role: 'user',
      content: buildPlannerPrompt({ userQuery, sources, messages }),
    },
  ];

  let plan: WechatToolPlan = {
    action: 'mixed_analysis',
    reason: 'default',
    args: { maxSources: DEFAULT_MAX_SOURCES, maxArticles: DEFAULT_MAX_ARTICLES },
  };
  try {
    const raw = await createJsonChatCompletion(plannerInput);
    plan = safeParsePlan(raw);
  } catch {
    plan = {
      action: 'mixed_analysis',
      reason: 'planner failed',
      args: { maxSources: DEFAULT_MAX_SOURCES, maxArticles: DEFAULT_MAX_ARTICLES },
    };
  }

  await logToolCallSafe({
    threadId: thread.id,
    messageId: userMessageId,
    toolName: 'wechat_planner',
    toolArgs: { userQuery },
    toolResult: plan,
    status: 'SUCCESS',
  });

  const selectedSources = chooseSources(validSources, plan, userQuery);
  const maxArticles = plan.args?.maxArticles || DEFAULT_MAX_ARTICLES;
  const keyword = plan.args?.keyword || '';
  const toolResults: ToolResultEntry[] = [];
  const toolFailures: ToolFailureEntry[] = [];
  let candidates: ArticleCandidate[] = [];

  const needList = ['list_source_articles', 'mixed_analysis'].includes(plan.action);
  if (needList) {
    const listResults = await Promise.allSettled(
      selectedSources.map(async (source) => {
        const result = await listArticlesByAccount({
          biz: source.biz,
          name: source.displayName,
          page: 1,
          count: Math.min(PER_SOURCE_HISTORY_LIMIT, maxArticles),
        });
        return { source, result };
      })
    );
    for (const item of listResults) {
      if (item.status !== 'fulfilled') {
        pushToolFailure(toolFailures, 'listArticlesByAccount', item.reason);
        continue;
      }
      const { source, result } = item.value;
      const arr = toArticleCandidates(source.displayName, source.biz, result);
      candidates.push(...arr);
      toolResults.push({
        tool: 'listArticlesByAccount',
        result: {
          source: source.displayName,
          biz: source.biz,
          count: arr.length,
          sample: arr.slice(0, 3),
        },
      });
      await logToolCallSafe({
        threadId: thread.id,
        messageId: userMessageId,
        toolName: 'listArticlesByAccount',
        toolArgs: { biz: source.biz, name: source.displayName },
        toolResult: result,
        status: 'SUCCESS',
      });
    }
  }

  if (plan.action === 'search_global_articles') {
    try {
      const result = plan.args?.realtime
        ? await searchRealtimeArticles({ keyword: keyword || userQuery, mode: 1, page: 1, limit: maxArticles })
        : await searchArticles({ keyword: keyword || userQuery, page: 1, limit: maxArticles });
      const arr = toArticleCandidates('全网搜索', '', result);
      candidates.push(...arr);
      toolResults.push({
        tool: plan.args?.realtime ? 'searchRealtimeArticles' : 'searchArticles',
        result: { count: arr.length, sample: arr.slice(0, 5) },
      });
      await logToolCallSafe({
        threadId: thread.id,
        messageId: userMessageId,
        toolName: plan.args?.realtime ? 'searchRealtimeArticles' : 'searchArticles',
        toolArgs: { keyword: keyword || userQuery, limit: maxArticles },
        toolResult: result,
        status: 'SUCCESS',
      });
    } catch (error) {
      pushToolFailure(
        toolFailures,
        plan.args?.realtime ? 'searchRealtimeArticles' : 'searchArticles',
        error,
        keyword || userQuery
      );
    }
  }

  if (keyword) {
    candidates = candidates.filter((c) => `${c.title} ${c.summary}`.toLowerCase().includes(keyword.toLowerCase()));
  }
  candidates = candidates
    .filter((c, index, arr) => arr.findIndex((x) => x.url === c.url) === index)
    .slice(0, maxArticles);

  const detailTargets = new Set<string>();
  if (plan.action === 'get_article_detail' || plan.action === 'mixed_analysis') {
    if (plan.args?.targetUrl) detailTargets.add(plan.args.targetUrl);
    for (const url of plan.args?.articleUrls || []) detailTargets.add(url);
    if (detailTargets.size === 0) {
      for (const c of candidates.slice(0, Math.min(DEFAULT_DETAIL_FETCHES, maxArticles))) detailTargets.add(c.url);
    }
  }

  const metricsTargets = new Set<string>();
  if (plan.action === 'get_article_metrics' || plan.action === 'mixed_analysis') {
    if (plan.args?.targetUrl) metricsTargets.add(plan.args.targetUrl);
    for (const url of plan.args?.articleUrls || []) metricsTargets.add(url);
    if (metricsTargets.size === 0) {
      for (const c of candidates.slice(0, Math.min(DEFAULT_METRICS_FETCHES, maxArticles))) metricsTargets.add(c.url);
    }
  }

  const detailResults: Array<{ url: string; detail: unknown }> = [];
  const detailSettled = await Promise.allSettled(
    [...detailTargets].map(async (url) => ({
      url,
      detail: await getArticleDetail({ url }),
    }))
  );
  for (const item of detailSettled) {
    if (item.status !== 'fulfilled') {
      pushToolFailure(toolFailures, 'getArticleDetail', item.reason);
      continue;
    }
    detailResults.push(item.value);
    await logToolCallSafe({
      threadId: thread.id,
      messageId: userMessageId,
      toolName: 'getArticleDetail',
      toolArgs: { url: item.value.url },
      toolResult: item.value.detail,
      status: 'SUCCESS',
    });
  }
  if (detailResults.length > 0) {
    toolResults.push({
      tool: 'getArticleDetail',
      result: {
        count: detailResults.length,
        sample: detailResults.slice(0, 2).map((item) => ({
          url: item.url,
          detail: summarizeToolPayload(item.detail),
        })),
      },
    });
  }

  const metricResults: Array<{ url: string; metrics: unknown }> = [];
  const metricsSettled = await Promise.allSettled(
    [...metricsTargets].map(async (url) => ({
      url,
      metrics: await getArticleMetrics({ url }),
    }))
  );
  for (const item of metricsSettled) {
    if (item.status !== 'fulfilled') {
      pushToolFailure(toolFailures, 'getArticleMetrics', item.reason);
      continue;
    }
    metricResults.push(item.value);
    await logToolCallSafe({
      threadId: thread.id,
      messageId: userMessageId,
      toolName: 'getArticleMetrics',
      toolArgs: { url: item.value.url },
      toolResult: item.value.metrics,
      status: 'SUCCESS',
    });
  }
  if (metricResults.length > 0) {
    toolResults.push({
      tool: 'getArticleMetrics',
      result: {
        count: metricResults.length,
        sample: metricResults.slice(0, 3).map((item) => ({
          url: item.url,
          metrics: summarizeToolPayload(item.metrics),
        })),
      },
    });
  }

  const commentResults: Array<{ url: string; commentId: string; comments: unknown }> = [];
  const shouldFetchComments = plan.action === 'get_article_comments';
  if (shouldFetchComments) {
    const detailCache = new Map<string, unknown>(detailResults.map((item) => [item.url, item.detail]));
    const commentInputs: Array<{ url: string; commentId: string }> = [];

    if (plan.args?.commentId) {
      commentInputs.push({ url: plan.args?.targetUrl || '', commentId: plan.args.commentId });
    }

    const commentUrlTargets = new Set<string>();
    if (plan.args?.targetUrl) commentUrlTargets.add(plan.args.targetUrl);
    for (const url of plan.args?.articleUrls || []) commentUrlTargets.add(url);
    if (commentUrlTargets.size === 0) {
      for (const c of candidates.slice(0, Math.min(DEFAULT_DETAIL_FETCHES, maxArticles))) commentUrlTargets.add(c.url);
    }

    for (const url of commentUrlTargets) {
      let detail = detailCache.get(url);
      if (!detail) {
        try {
          detail = await getArticleDetail({ url });
          detailCache.set(url, detail);
          await logToolCallSafe({
            threadId: thread.id,
            messageId: userMessageId,
            toolName: 'getArticleDetail',
            toolArgs: { url, reason: 'resolve_comment_id' },
            toolResult: detail,
            status: 'SUCCESS',
          });
        } catch (error) {
          pushToolFailure(toolFailures, 'getArticleDetail', error, url);
          continue;
        }
      }
      const commentId = extractCommentIdFromDetail(detail);
      if (commentId) {
        commentInputs.push({ url, commentId });
      }
    }

    const dedupMap = new Map<string, { url: string; commentId: string }>();
    for (const item of commentInputs) {
      const key = item.commentId;
      if (!key || dedupMap.has(key)) continue;
      dedupMap.set(key, item);
    }

    const commentsSettled = await Promise.allSettled(
      [...dedupMap.values()].map(async (item) => ({
        url: item.url,
        commentId: item.commentId,
        comments: await getArticleComments({
          commentId: item.commentId,
          buffer: plan.args?.buffer,
          contentId: plan.args?.contentId,
          maxReplyId: plan.args?.maxReplyId,
          offset: plan.args?.offset,
        }),
      }))
    );
    for (const item of commentsSettled) {
      if (item.status !== 'fulfilled') {
        pushToolFailure(toolFailures, 'getArticleComments', item.reason);
        continue;
      }
      commentResults.push(item.value);
      await logToolCallSafe({
        threadId: thread.id,
        messageId: userMessageId,
        toolName: 'getArticleComments',
        toolArgs: {
          url: item.value.url,
          commentId: item.value.commentId,
          buffer: plan.args?.buffer,
          contentId: plan.args?.contentId,
          maxReplyId: plan.args?.maxReplyId,
          offset: plan.args?.offset,
        },
        toolResult: item.value.comments,
        status: 'SUCCESS',
      });
    }
  }
  if (commentResults.length > 0) {
    toolResults.push({
      tool: 'getArticleComments',
      result: {
        count: commentResults.length,
        sample: commentResults.slice(0, 2).map((item) => ({
          url: item.url,
          commentId: item.commentId,
          comments: summarizeToolPayload(item.comments),
        })),
      },
    });
  }

  if (toolResults.length === 0 && toolFailures.length > 0) {
    const reply = `公众号数据抓取失败，当前未拿到可用结果：\n${renderToolFailures(toolFailures)}`;
    await appendThreadMessage({
      threadId: thread.id,
      role: 'ASSISTANT',
      content: reply,
      meta: {
        plan,
        failures: toolFailures,
      },
    });
    return NextResponse.json({
      ok: true,
      reply,
      threadId: thread.id,
      planner: plan,
      debug: {
        candidateCount: candidates.length,
        detailCount: detailResults.length,
        metricsCount: metricResults.length,
        commentCount: commentResults.length,
        failures: toolFailures.length,
      },
    });
  }

  const responseMessages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(integration?.assistantCustomPrompt) },
    {
      role: 'system',
      content: [
        `用户有效公众号源：${validSources.map((s) => `${s.displayName}(${s.biz})`).join(', ')}`,
        invalidSources.length > 0
          ? `检测到无效公众号标识，已自动跳过：${invalidSources.map((s) => `${s.displayName}(${s.biz})`).join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { role: 'system', content: `本轮执行计划：${JSON.stringify(plan)}` },
    { role: 'system', content: `候选文章：\n${renderCandidates(candidates)}` },
    { role: 'system', content: `工具结果：\n${renderToolResults(toolResults)}` },
    { role: 'system', content: `工具异常：\n${renderToolFailures(toolFailures)}` },
    ...messages.map((message) => ({ role: message.role, content: message.content })),
  ];

  try {
    const reply = await createChatCompletion(responseMessages);
    const finalReply = reply || '已收到，但暂无回复。';
    await appendThreadMessage({
      threadId: thread.id,
      role: 'ASSISTANT',
      content: finalReply,
      meta: {
        plan,
        candidateCount: candidates.length,
        detailCount: detailResults.length,
        metricsCount: metricResults.length,
        commentCount: commentResults.length,
      },
    });
    return NextResponse.json({
      ok: true,
      reply: finalReply,
      threadId: thread.id,
      planner: plan,
      debug: {
        candidateCount: candidates.length,
        detailCount: detailResults.length,
        metricsCount: metricResults.length,
        commentCount: commentResults.length,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: `AI员工暂时不可用：${detail}` }, { status: 500 });
  }
}
