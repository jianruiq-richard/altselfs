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
  action: 'fetch_articles' | 'answer_only' | 'clarify';
  reason?: string;
  args?: {
    bizList?: string[];
    maxSources?: number;
    focus?: string;
  };
};

type FetchedArticle = {
  biz: string;
  displayName: string;
  url: string;
  finalUrl: string;
  title: string;
  content: string;
  fetchedAt: string;
  error?: string;
};

function buildSourceContext(
  sources: SourceRecord[]
) {
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
    '1) 基于公众号库与用户问题，给出可执行的内容分析；',
    '2) 当信息不足时，明确指出缺失数据，并告诉用户下一步需要提供什么；',
    '3) 默认中文，输出简洁、有层次。',
    '限制：',
    '1) 不要编造未提供的文章全文；',
    '2) 需要引用文章时，优先引用已录入的链接；',
    '3) 可给出“选题总结/行业洞察/风险点/可投性判断”等结构化结论。',
  ];

  if (customPrompt?.trim()) {
    base.push('用户自定义调教要求：');
    base.push(customPrompt.trim());
  }

  return base.join('\n');
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
    const allowed = new Set(['fetch_articles', 'answer_only', 'clarify']);
    const action = allowed.has(parsed.action || '') ? parsed.action : 'clarify';
    const bizList = Array.isArray(parsed.args?.bizList)
      ? parsed.args?.bizList.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
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
        focus: typeof parsed.args?.focus === 'string' ? parsed.args.focus.trim() : undefined,
      },
    };
  } catch {
    return { action: 'clarify', reason: 'planner parse failed', args: {} };
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

function extractArticleContent(html: string) {
  const block =
    html.match(/<div[^>]+id="js_content"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
    html.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i)?.[1] ||
    '';

  const text = stripHtml(block || html).trim();
  return text.slice(0, 12000);
}

function buildPlannerPrompt(input: { userQuery: string; sources: SourceRecord[]; messages: ClientMessage[] }) {
  const sourceList =
    input.sources.length === 0
      ? '无'
      : input.sources
          .map((source, idx) => `${idx + 1}. ${source.displayName} | biz=${source.biz}`)
          .join('\n');

  const history = input.messages
    .slice(-6)
    .map((message, idx) => `${idx + 1}. [${message.role}] ${message.content}`)
    .join('\n');

  return [
    '你是微信公众号 AI 员工的函数调度器，决定是否需要实时抓取文章内容。',
    '只输出 JSON，不要输出任何其他文字。',
    '可选 action：',
    '1) fetch_articles: 需要实时拉取文章内容再回答',
    '2) answer_only: 不需要抓取，直接回答',
    '3) clarify: 信息不足，需要追问',
    'JSON schema:',
    '{',
    '  "action": "fetch_articles|answer_only|clarify",',
    '  "reason": "简短原因",',
    '  "args": {',
    '    "bizList": ["可选，指定要抓取的公众号biz列表"],',
    '    "maxSources": 1-8,',
    '    "focus": "抓取重点，例如最新一篇/某主题"',
    '  }',
    '}',
    '规则：',
    '- 用户询问“最新文章、全文、原文内容、具体细节、逐段分析”时，优先 fetch_articles。',
    '- 用户只问抽象策略、流程、泛化建议时，可 answer_only。',
    '- 用户问题不明确且无法确定抓取范围时，用 clarify。',
    `当前用户问题：${input.userQuery}`,
    `用户已录入公众号：\n${sourceList}`,
    `最近对话：\n${history || '无'}`,
  ].join('\n');
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

async function fetchArticleForSource(source: SourceRecord): Promise<FetchedArticle> {
  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetch(source.lastArticleUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      },
      signal: AbortSignal.timeout(15_000),
    });

    const html = await response.text();
    const finalUrl = response.url || source.lastArticleUrl;
    const title = extractArticleTitle(html);
    const content = extractArticleContent(html);

    if (!content.trim()) {
      return {
        biz: source.biz,
        displayName: source.displayName,
        url: source.lastArticleUrl,
        finalUrl,
        title,
        content: '',
        fetchedAt,
        error: '正文解析为空',
      };
    }

    return {
      biz: source.biz,
      displayName: source.displayName,
      url: source.lastArticleUrl,
      finalUrl,
      title,
      content,
      fetchedAt,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    return {
      biz: source.biz,
      displayName: source.displayName,
      url: source.lastArticleUrl,
      finalUrl: source.lastArticleUrl,
      title: '抓取失败',
      content: '',
      fetchedAt,
      error: detail,
    };
  }
}

function buildFetchedContext(articles: FetchedArticle[]) {
  if (articles.length === 0) {
    return '本轮未触发抓取。';
  }

  return articles
    .map((article, idx) => {
      const parts = [
        `${idx + 1}. ${article.displayName}（biz: ${article.biz}）`,
        `抓取时间：${article.fetchedAt}`,
        `标题：${article.title}`,
        `链接：${article.finalUrl}`,
      ];

      if (article.error) {
        parts.push(`抓取状态：失败（${article.error}）`);
      } else {
        parts.push(`正文（截断）：\n${article.content}`);
      }
      return parts.join('\n');
    })
    .join('\n\n');
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
      take: 20,
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

  const userQuery =
    [...messages].reverse().find((message) => message.role === 'user')?.content || messages[messages.length - 1].content;

  const plannerPrompt = buildPlannerPrompt({ userQuery, sources, messages });
  let plan: WechatToolPlan = { action: 'fetch_articles', reason: 'default', args: { maxSources: 3 } };
  try {
    const plannerRaw = await createJsonChatCompletion([
      {
        role: 'system',
        content: '你是严格JSON输出的函数调度器。',
      },
      {
        role: 'user',
        content: plannerPrompt,
      },
    ]);
    plan = safeParsePlan(plannerRaw);
    await appendToolCall({
      threadId: thread.id,
      messageId: userMessageId,
      toolName: 'wechat_planner',
      toolArgs: { query: userQuery },
      toolResult: plan,
      status: 'SUCCESS',
    });
  } catch {
    plan = { action: 'fetch_articles', reason: 'planner unavailable', args: { maxSources: 3 } };
  }

  const maxSources = plan.args?.maxSources || 3;
  const selectedSources =
    plan.args?.bizList && plan.args.bizList.length > 0
      ? sources.filter((source) => plan.args?.bizList?.includes(source.biz)).slice(0, maxSources)
      : chooseSourcesByQuery(sources, userQuery, maxSources);

  const shouldFetch = plan.action === 'fetch_articles' && selectedSources.length > 0;
  const fetchedArticles = shouldFetch
    ? await Promise.all(selectedSources.map((source) => fetchArticleForSource(source)))
    : [];
  await appendToolCall({
    threadId: thread.id,
    messageId: userMessageId,
    toolName: 'wechat_fetch_articles',
    toolArgs: {
      selectedSources: selectedSources.map((source) => ({ biz: source.biz, name: source.displayName })),
      shouldFetch,
    },
    toolResult: fetchedArticles.map((article) => ({
      biz: article.biz,
      title: article.title,
      finalUrl: article.finalUrl,
      fetchedAt: article.fetchedAt,
      error: article.error || null,
    })),
    status: 'SUCCESS',
  });

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
        `本轮函数调度结果：action=${plan.action}; reason=${plan.reason || 'n/a'};` +
        ` focus=${plan.args?.focus || 'n/a'}; selected=${selectedSources.map((source) => source.displayName).join(', ') || 'none'}`,
    },
    {
      role: 'system',
      content: `本轮实时抓取结果：\n${buildFetchedContext(fetchedArticles)}`,
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
        fetchedCount: fetchedArticles.length,
      },
    });
    return NextResponse.json({ ok: true, reply: finalReply, threadId: thread.id });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: `AI员工暂时不可用：${detail}` }, { status: 500 });
  }
}
