import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createChatCompletion, type ChatMessage } from '@/lib/openrouter';
import { getInvestorOrNull } from '@/lib/investor-auth';

const WECHAT_PROVIDER = 'WECHAT';
const MAX_CUSTOM_PROMPT_LENGTH = 8000;

type ClientMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function buildSourceContext(
  sources: Array<{
    displayName: string;
    biz: string;
    lastArticleUrl: string;
    updatedAt: Date;
  }>
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

  const integration = await prisma.investorIntegration.findUnique({
    where: {
      investorId_provider: {
        investorId: investor.id,
        provider: WECHAT_PROVIDER,
      },
    },
    select: { assistantCustomPrompt: true },
  });

  return NextResponse.json({
    customPrompt: integration?.assistantCustomPrompt || '',
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
  if (messages.length === 0) {
    return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
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

  const modelMessages: ChatMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(integration?.assistantCustomPrompt),
    },
    {
      role: 'system',
      content: `当前公众号库：\n${buildSourceContext(sources)}`,
    },
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  try {
    const reply = await createChatCompletion(modelMessages);
    return NextResponse.json({ ok: true, reply: reply || '已收到，但暂无回复。' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: `AI员工暂时不可用：${detail}` }, { status: 500 });
  }
}
