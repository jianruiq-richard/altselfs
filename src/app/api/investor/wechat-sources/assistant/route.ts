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

const WECHAT_PROVIDER = 'WECHAT';
const MAX_CUSTOM_PROMPT_LENGTH = 8000;

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

type WechatToolPlan = {
  action: 'discover_articles' | 'fetch_article_content' | 'answer_only' | 'clarify';
  reason?: string;
  args?: {
    bizList?: string[];
    maxSources?: number;
    maxArticles?: number;
    keyword?: string;
    dateFrom?: string;
    dateTo?: string;
    focus?: string;
  };
};

type DiscoveredArticle = {
  biz: string;
  displayName: string;
  url: string;
  finalUrl: string;
  title: string;
  snippet: string;
  publishAt: string | null;
  fetchedAt: string;
  content?: string;
  error?: string;
};

function buildSourceContext(sources: SourceRecord[]) {
  if (sources.length === 0) {
    return '当前未录入任何公众号。先在上方添加公众号文章链接后再分析。';
  }

  return sources
    .map(
      (source, index) =>
        `${index + 1}. ${source.displayName}（biz: ${source.biz}）\n` +
        `   最近链接：${source.lastArticleUrl}\n` +
        `   更新时间：${source.updatedAt.toLocaleString('zh-CN')}`
    )
    .join('\n');
}

function buildSystemPrompt(customPrompt?: string | null) {
  const base = [
    '你是投资人的“微信公众号AI员工”。',
    '你的任务：',
    '1) 先基于用户问题决定是否要先“发现文章列表”再“抓全文”。',
    '2) 若用户询问某天/近几天/某主题，优先从候选文章中筛选后再回答。',
    '3) 默认中文，输出简洁、有层次。',
    '限制：',
    '1) 不要编造未抓取到的文章全文；',
    '2) 需要引用时优先给出具体标题和链接；',
    '3) 信息不足时明确说明并提出下一步。',
  ];

  if (customPrompt?.trim()) {
    base.push('用户自定义调教要求：');
    base.push(customPrompt.trim());
  }

  return base.join('\n');
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
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    const candidate = fenceMatch[1].trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) {
      return candidate;
    }
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function safeParsePlan(raw: string): WechatToolPlan {
  try {
    const parsed = JSON.parse(extractJsonObject(raw) ?? raw) as Partial<WechatToolPlan>;
    const allowed = new Set(['discover_articles', 'fetch_article_content', 'answer_only', 'clarify']);
    const action = allowed.has(parsed.action || '') ? parsed.action : 'clarify';
    const bizList = Array.isArray(parsed.args?.bizList)
      ? parsed.args.bizList.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : [];

    return {
      action: action as WechatToolPlan['action'],
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      args: {
        bizList,
        maxSources:
          typeof parsed.args?.maxSources === 'number' && Number.isFinite(parsed.args.maxSources)
            ? Math.max(1, Math.min(8, Math.round(parsed.args.maxSources)))
            : undefined,
        maxArticles:
          typeof parsed.args?.maxArticles === 'number' && Number.isFinite(parsed.args.maxArticles)
            ? Math.max(1, Math.min(10, Math.round(parsed.args.maxArticles)))
            : undefined,
        keyword: typeof parsed.args?.keyword === 'string' ? parsed.args.keyword.trim() : undefined,
        dateFrom: typeof parsed.args?.dateFrom === 'string' ? parsed.args.dateFrom.trim() : undefined,
        dateTo: typeof parsed.args?.dateTo === 'string' ? parsed.args.dateTo.trim() : undefined,
        focus: typeof parsed.args?.focus === 'string' ? parsed.args.focus.trim() : undefined,
      },
    };
  } catch {
    return { action: 'clarify', reason: 'planner parse failed', args: {} };
  }
}

function normalizeUrlWithoutHash(input: string) {
  const url = new URL(input);
  url.hash = '';
  return url.toString();
}

function extractBizFromUrl(rawUrl: string) {
  try {
    return (new URL(rawUrl).searchParams.get('__biz') || '').trim();
  } catch {
    return '';
  }
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  );
}

function extractArticleTitle(html: string) {
  const candidates = [
    html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1],
    html.match(/var\s+msg_title\s*=\s*'([^']+)'/i)?.[1],
    html.match(/var\s+msg_title\s*=\s*"([^"]+)"/i)?.[1],
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
  ].filter(Boolean) as string[];

  return decodeHtmlEntities((candidates[0] || '未识别标题').trim());
}

function extractPublishAt(html: string): string | null {
  const tsRaw = html.match(/var\s+ct\s*=\s*['\"]?(\d{10})['\"]?/i)?.[1];
  if (tsRaw) {
    const ts = Number(tsRaw) * 1000;
    if (Number.isFinite(ts)) return new Date(ts).toISOString();
  }

  const dateRaw = html.match(/"publish_time"\s*:\s*"([^"]+)"/i)?.[1];
  if (dateRaw) {
    const t = Date.parse(dateRaw);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }

  return null;
}

function extractArticleContent(html: string, maxLen = 12000) {
  const block =
    html.match(/<div[^>]+id="js_content"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
    html.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i)?.[1] ||
    '';

  return stripHtml(block || html).slice(0, maxLen);
}

function extractRelatedUrls(html: string, biz: string) {
  const urls = new Set<string>();
  const regex = /(https?:\/\/mp\.weixin\.qq\.com\/s\?[^"'\s<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const raw = decodeHtmlEntities(match[1]);
    try {
      const url = normalizeUrlWithoutHash(raw);
      const linkBiz = extractBizFromUrl(url);
      if (linkBiz && linkBiz === biz) {
        urls.add(url);
      }
    } catch {
      // ignore invalid URL
    }
  }

  return [...urls];
}

async function fetchAndParseArticle(
  input: {
    url: string;
    displayName: string;
    bizHint?: string;
    includeContent?: boolean;
  }
): Promise<DiscoveredArticle> {
  const fetchedAt = new Date().toISOString();

  try {
    const response = await fetch(input.url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      },
      signal: AbortSignal.timeout(15_000),
    });

    const html = await response.text();
    const finalUrl = normalizeUrlWithoutHash(response.url || input.url);
    const biz = extractBizFromUrl(finalUrl) || input.bizHint || '';
    const title = extractArticleTitle(html);
    const content = extractArticleContent(html, input.includeContent ? 12000 : 1200);

    return {
      biz,
      displayName: input.displayName,
      url: input.url,
      finalUrl,
      title,
      snippet: content.slice(0, 400),
      content: input.includeContent ? content : undefined,
      publishAt: extractPublishAt(html),
      fetchedAt,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    return {
      biz: input.bizHint || '',
      displayName: input.displayName,
      url: input.url,
      finalUrl: input.url,
      title: '抓取失败',
      snippet: '',
      publishAt: null,
      fetchedAt,
      error: detail,
    };
  }
}

function parseDateOnly(value?: string) {
  if (!value) return null;
  const normalized = value.trim();
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T00:00:00.000Z` : normalized;
  const t = Date.parse(withTime);
  if (Number.isNaN(t)) return null;
  return t;
}

function chooseSourcesByQuery(sources: SourceRecord[], query: string, maxSources: number) {
  const normalized = query.toLowerCase();
  const matched = sources.filter(
    (source) =>
      normalized.includes(source.displayName.toLowerCase()) || normalized.includes(source.biz.toLowerCase())
  );
  const base = matched.length > 0 ? matched : sources;
  return base.slice(0, maxSources);
}

function buildPlannerPrompt(input: { userQuery: string; sources: SourceRecord[]; messages: ClientMessage[] }) {
  const sourceList =
    input.sources.length === 0
      ? '无'
      : input.sources
          .map((source, idx) => `${idx + 1}. ${source.displayName} | biz=${source.biz}`)
          .join('\n');

  const history = input.messages
    .slice(-8)
    .map((message, idx) => `${idx + 1}. [${message.role}] ${message.content}`)
    .join('\n');

  return [
    '你是微信公众号AI员工的函数调度器。',
    '你负责决定本轮是否先发现文章列表，再抓全文。',
    '只输出 JSON，不要输出任何其他文字。',
    'action 可选：discover_articles | fetch_article_content | answer_only | clarify。',
    'JSON schema:',
    '{',
    '  "action": "discover_articles|fetch_article_content|answer_only|clarify",',
    '  "reason": "短原因",',
    '  "args": {',
    '    "bizList": ["可选，指定公众号biz"],',
    '    "maxSources": 1-8,',
    '    "maxArticles": 1-10,',
    '    "keyword": "可选，主题关键词",',
    '    "dateFrom": "可选，YYYY-MM-DD",',
    '    "dateTo": "可选，YYYY-MM-DD",',
    '    "focus": "可选，如 最新/某日/某主题"',
    '  }',
    '}',
    '规则：',
    '- 用户问“某一天/近几天/某主题有哪些文章”时，至少 discover_articles。',
    '- 用户问“全文/逐段分析/原文细节”时，优先 fetch_article_content。',
    '- 纯策略类问题可 answer_only。',
    `当前用户问题：${input.userQuery}`,
    `用户已录入公众号：\n${sourceList}`,
    `最近对话：\n${history || '无'}`,
  ].join('\n');
}

async function discoverArticles(input: {
  sources: SourceRecord[];
  maxArticles: number;
  keyword?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const discovered: DiscoveredArticle[] = [];
  const seenUrls = new Set<string>();

  for (const source of input.sources) {
    const seed = await fetchAndParseArticle({
      url: source.lastArticleUrl,
      displayName: source.displayName,
      bizHint: source.biz,
      includeContent: false,
    });

    const push = (item: DiscoveredArticle) => {
      const key = item.finalUrl || item.url;
      if (!key || seenUrls.has(key)) return;
      seenUrls.add(key);
      discovered.push(item);
    };

    push(seed);

    if (!seed.error) {
      try {
        const response = await fetch(seed.finalUrl || source.lastArticleUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
          },
          signal: AbortSignal.timeout(10_000),
        });
        const html = await response.text();
        const relatedUrls = extractRelatedUrls(html, source.biz).slice(0, 6);

        for (const relatedUrl of relatedUrls) {
          if (seenUrls.has(relatedUrl)) continue;
          const related = await fetchAndParseArticle({
            url: relatedUrl,
            displayName: source.displayName,
            bizHint: source.biz,
            includeContent: false,
          });
          push(related);
          if (discovered.length >= input.maxArticles * 2) break;
        }
      } catch {
        // ignore related link expansion failures
      }
    }

    if (discovered.length >= input.maxArticles * 2) break;
  }

  const keyword = (input.keyword || '').trim().toLowerCase();
  const fromTs = parseDateOnly(input.dateFrom);
  const toTs = parseDateOnly(input.dateTo);

  const filtered = discovered.filter((item) => {
    if (keyword) {
      const text = `${item.title} ${item.snippet}`.toLowerCase();
      if (!text.includes(keyword)) return false;
    }

    if (fromTs || toTs) {
      const published = item.publishAt ? Date.parse(item.publishAt) : NaN;
      if (Number.isNaN(published)) return false;
      if (fromTs && published < fromTs) return false;
      if (toTs && published > toTs + 24 * 3600 * 1000 - 1) return false;
    }

    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const ta = a.publishAt ? Date.parse(a.publishAt) : 0;
    const tb = b.publishAt ? Date.parse(b.publishAt) : 0;
    return tb - ta;
  });

  return sorted.slice(0, input.maxArticles);
}

function buildDiscoveryContext(articles: DiscoveredArticle[]) {
  if (articles.length === 0) return '本轮未发现符合条件的文章。';

  return articles
    .map((article, idx) => {
      const lines = [
        `${idx + 1}. ${article.title}`,
        `公众号：${article.displayName}（biz: ${article.biz || '未知'}）`,
        `发布时间：${article.publishAt || '未知'}`,
        `链接：${article.finalUrl}`,
      ];
      if (article.error) {
        lines.push(`状态：抓取失败（${article.error}）`);
      } else {
        lines.push(`摘要：${article.snippet || '无'}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

function buildFullContentContext(articles: DiscoveredArticle[]) {
  if (articles.length === 0) return '本轮未抓取全文。';

  return articles
    .map((article, idx) => {
      const lines = [
        `${idx + 1}. ${article.title}`,
        `链接：${article.finalUrl}`,
      ];
      if (article.error) {
        lines.push(`抓取失败：${article.error}`);
      } else {
        lines.push(`全文（截断）：\n${article.content || article.snippet || '无内容'}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

export async function GET() {
  const investor = await getInvestorOrNull();
  if (!investor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [integration, thread] = await Promise.all([
    prisma.investorIntegration.findUnique({
      where: {
        investorId_provider: {
          investorId: investor.id,
          provider: WECHAT_PROVIDER,
        },
      },
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
  if (!investor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const customPrompt = String((body as { customPrompt?: string })?.customPrompt || '');
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
  if (!investor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const messages = normalizeMessages((body as { messages?: unknown })?.messages);
  const threadId = typeof (body as { threadId?: unknown })?.threadId === 'string'
    ? String((body as { threadId?: string }).threadId)
    : null;
  if (messages.length === 0) {
    return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
  }

  const thread = await ensureThread({
    investorId: investor.id,
    agentType: WECHAT_PROVIDER,
    threadId,
  });

  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  let userMessageId: string | null = null;
  if (lastUser) {
    const saved = await appendThreadMessage({
      threadId: thread.id,
      role: 'USER',
      content: lastUser.content,
    });
    userMessageId = saved.id;
  }

  const [sources, integration] = await Promise.all([
    prisma.investorWechatSource.findMany({
      where: { investorId: investor.id },
      orderBy: { updatedAt: 'desc' },
      take: 40,
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
    const noSourceReply = '当前没有可用公众号源。请先在上方录入至少一个公众号文章链接。';
    await appendThreadMessage({
      threadId: thread.id,
      role: 'ASSISTANT',
      content: noSourceReply,
    });
    return NextResponse.json({ ok: true, reply: noSourceReply, threadId: thread.id });
  }

  const userQuery =
    [...messages].reverse().find((message) => message.role === 'user')?.content ||
    messages[messages.length - 1].content;

  let plan: WechatToolPlan = {
    action: 'discover_articles',
    reason: 'default',
    args: { maxSources: 3, maxArticles: 5 },
  };

  try {
    const plannerRaw = await createJsonChatCompletion([
      {
        role: 'system',
        content: '你是严格JSON输出的函数调度器。',
      },
      {
        role: 'user',
        content: buildPlannerPrompt({ userQuery, sources, messages }),
      },
    ]);
    plan = safeParsePlan(plannerRaw);
  } catch {
    plan = {
      action: 'discover_articles',
      reason: 'planner unavailable',
      args: { maxSources: 3, maxArticles: 5 },
    };
  }

  await appendToolCall({
    threadId: thread.id,
    messageId: userMessageId,
    toolName: 'wechat_planner',
    toolArgs: { userQuery },
    toolResult: plan,
    status: 'SUCCESS',
  });

  const maxSources = plan.args?.maxSources || 3;
  const maxArticles = plan.args?.maxArticles || 5;
  const selectedSources =
    plan.args?.bizList && plan.args.bizList.length > 0
      ? sources.filter((source) => plan.args?.bizList?.includes(source.biz)).slice(0, maxSources)
      : chooseSourcesByQuery(sources, userQuery, maxSources);

  const needsDiscover = plan.action === 'discover_articles' || plan.action === 'fetch_article_content';
  const discovered = needsDiscover
    ? await discoverArticles({
        sources: selectedSources,
        maxArticles,
        keyword: plan.args?.keyword,
        dateFrom: plan.args?.dateFrom,
        dateTo: plan.args?.dateTo,
      })
    : [];

  await appendToolCall({
    threadId: thread.id,
    messageId: userMessageId,
    toolName: 'wechat_discover_articles',
    toolArgs: {
      selectedSources: selectedSources.map((source) => ({ biz: source.biz, name: source.displayName })),
      keyword: plan.args?.keyword,
      dateFrom: plan.args?.dateFrom,
      dateTo: plan.args?.dateTo,
      maxArticles,
    },
    toolResult: discovered.map((item) => ({
      biz: item.biz,
      title: item.title,
      publishAt: item.publishAt,
      finalUrl: item.finalUrl,
      error: item.error || null,
    })),
    status: 'SUCCESS',
  });

  const needsFull = plan.action === 'fetch_article_content';
  const toFetchFull = needsFull ? discovered.slice(0, Math.min(maxArticles, 3)) : [];
  const fetchedFull = needsFull
    ? await Promise.all(
        toFetchFull.map((item) =>
          fetchAndParseArticle({
            url: item.finalUrl || item.url,
            displayName: item.displayName,
            bizHint: item.biz,
            includeContent: true,
          })
        )
      )
    : [];

  if (needsFull) {
    await appendToolCall({
      threadId: thread.id,
      messageId: userMessageId,
      toolName: 'wechat_fetch_article_content',
      toolArgs: {
        targets: toFetchFull.map((item) => ({ title: item.title, url: item.finalUrl })),
      },
      toolResult: fetchedFull.map((item) => ({
        biz: item.biz,
        title: item.title,
        finalUrl: item.finalUrl,
        publishAt: item.publishAt,
        error: item.error || null,
      })),
      status: 'SUCCESS',
    });
  }

  const modelMessages: ChatMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(integration?.assistantCustomPrompt),
    },
    {
      role: 'system',
      content: `当前公众号库：\n${buildSourceContext(sources)}`,
    },
    {
      role: 'system',
      content:
        `本轮函数调度：action=${plan.action}; reason=${plan.reason || 'n/a'}; focus=${plan.args?.focus || 'n/a'};` +
        ` keyword=${plan.args?.keyword || 'n/a'}; dateFrom=${plan.args?.dateFrom || 'n/a'}; dateTo=${plan.args?.dateTo || 'n/a'}`,
    },
    {
      role: 'system',
      content: `候选文章列表（discover）：\n${buildDiscoveryContext(discovered)}`,
    },
    {
      role: 'system',
      content: `全文抓取结果（fetch）：\n${buildFullContentContext(fetchedFull)}`,
    },
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  try {
    const reply = await createChatCompletion(modelMessages);
    const finalReply = reply || '已收到，但暂无回复。';
    await appendThreadMessage({
      threadId: thread.id,
      role: 'ASSISTANT',
      content: finalReply,
      meta: {
        plan,
        discoveredCount: discovered.length,
        fetchedFullCount: fetchedFull.length,
      },
    });
    return NextResponse.json({
      ok: true,
      reply: finalReply,
      threadId: thread.id,
      plan,
      discoveredCount: discovered.length,
      fetchedFullCount: fetchedFull.length,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: `AI员工暂时不可用：${detail}` }, { status: 500 });
  }
}
