import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createChatCompletion, type ChatMessage } from '@/lib/openrouter';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { parseProvider, providerToDb } from '@/lib/integrations';

type ClientMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function buildProviderContext(provider: 'gmail' | 'feishu', summary: string | null, raw: unknown) {
  const providerLabel = provider === 'gmail' ? 'Gmail' : '飞书';
  const lines: string[] = [];
  lines.push(`当前渠道：${providerLabel}`);
  lines.push(`最近摘要：${summary || '暂无摘要，请先点击“刷新摘要”。'}`);

  if (provider === 'gmail' && raw && typeof raw === 'object') {
    const r = raw as {
      profile?: { emailAddress?: string; messagesTotal?: number; threadsTotal?: number };
      recentMessages?: Array<{
        snippet?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      }>;
    };
    if (r.profile?.emailAddress) {
      lines.push(`邮箱账号：${r.profile.emailAddress}`);
    }
    if (typeof r.profile?.messagesTotal === 'number') {
      lines.push(`总邮件数：${r.profile.messagesTotal}`);
    }
    if (typeof r.profile?.threadsTotal === 'number') {
      lines.push(`总线程数：${r.profile.threadsTotal}`);
    }
    if (Array.isArray(r.recentMessages) && r.recentMessages.length > 0) {
      const top = r.recentMessages.slice(0, 5).map((m, idx) => {
        const headers = m.payload?.headers || [];
        const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || '无主题';
        const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value || '未知发件人';
        const snippet = (m.snippet || '').trim().slice(0, 100);
        return `${idx + 1}. ${subject}（${from}）${snippet ? ` - ${snippet}` : ''}`;
      });
      lines.push(`最近邮件片段：\n${top.join('\n')}`);
    }
  }

  return lines.join('\n');
}

function buildSystemPrompt(provider: 'gmail' | 'feishu') {
  const providerLabel = provider === 'gmail' ? 'Gmail' : '飞书';
  return [
    `你是投资人的“${providerLabel} 消息AI员工”。`,
    '你的工作是：',
    '1) 基于已提供的渠道数据回答问题并给出清晰下一步建议；',
    '2) 主动按优先级梳理待处理事项（高/中/低）；',
    '3) 输出尽量简洁，默认中文，优先给可执行建议。',
    '限制：',
    '1) 只能使用上下文中给出的信息，不要编造未给出的邮件/消息；',
    '2) 信息不足时明确指出缺失项，并提示用户点击“刷新摘要”；',
    '3) 当用户要求写回复时，给出可直接复制的草稿。',
  ].join('\n');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const investor = await getInvestorOrNull();
  if (!investor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { provider: rawProvider } = await params;
  const provider = parseProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { messages?: ClientMessage[] };
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages = incoming
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .filter((m) => m.content.length > 0)
    .slice(-20);

  if (messages.length === 0) {
    return NextResponse.json({ error: '缺少对话内容' }, { status: 400 });
  }

  const integration = await prisma.investorIntegration.findUnique({
    where: {
      investorId_provider: {
        investorId: investor.id,
        provider: providerToDb(provider),
      },
    },
  });

  if (!integration) {
    return NextResponse.json({ error: `请先绑定${provider === 'gmail' ? 'Gmail' : '飞书'}账号` }, { status: 400 });
  }

  const latestSnapshot = await prisma.integrationSnapshot.findFirst({
    where: { integrationId: integration.id },
    orderBy: { createdAt: 'desc' },
  });

  const context = buildProviderContext(provider, latestSnapshot?.summary || null, latestSnapshot?.raw);

  const aiMessages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(provider) },
    { role: 'system', content: `渠道上下文：\n${context}` },
    ...messages,
  ];

  try {
    const reply = await createChatCompletion(aiMessages);
    return NextResponse.json({ reply });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: `AI回复失败：${detail}` }, { status: 500 });
  }
}
