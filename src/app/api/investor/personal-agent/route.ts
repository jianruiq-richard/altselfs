import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import {
  appendThreadMessage,
  appendToolCall,
  ensureThread,
  getLatestThreadWithMessages,
  toClientMessages,
} from '@/lib/agent-session';

export const maxDuration = 800;

const PERSONAL_AGENT_TYPE = 'PERSONAL';

type ClientMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type PersonalAgentResponse = {
  route?: string;
  reply?: string;
  events?: unknown[];
  raw?: unknown;
  error?: string;
};

function getPersonalAgentServerUrl() {
  return (process.env.PERSONAL_AGENT_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
}

function normalizeMessages(value: unknown): ClientMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null;
      const content = typeof record.content === 'string' ? record.content.trim() : '';
      if (!role || !content) return null;
      return { role, content };
    })
    .filter(Boolean) as ClientMessage[];
}

function latestUserMessage(messages: ClientMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'user')?.content.trim() || '';
}

function buildAgentTurnMessage(messages: ClientMessage[]) {
  const recent = messages.slice(-12);
  const latest = latestUserMessage(messages);
  const history = recent
    .slice(0, -1)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
    .join('\n\n');

  if (!history) return latest;
  return ['以下是本会话最近上下文，请作为上下文参考，不要逐字复述：', history, '', '用户本轮问题：', latest].join('\n');
}

function displayMessages(messages: ClientMessage[]) {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

export async function GET() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const thread = await getLatestThreadWithMessages(investor.id, PERSONAL_AGENT_TYPE);
  return NextResponse.json({
    threadId: thread?.id || null,
    messages: thread ? toClientMessages(thread.messages) : [],
  });
}

export async function POST(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { threadId?: string | null; messages?: unknown };
  const messages = normalizeMessages(body.messages);
  const userMessage = latestUserMessage(messages);
  if (!userMessage) return NextResponse.json({ error: '消息不能为空' }, { status: 400 });

  const thread = await ensureThread({
    investorId: investor.id,
    agentType: PERSONAL_AGENT_TYPE,
    threadId: body.threadId || null,
  });

  await appendThreadMessage({
    threadId: thread.id,
    role: 'USER',
    content: userMessage,
  });

  const payload = {
    userId: investor.email || investor.id,
    threadId: thread.id,
    message: buildAgentTurnMessage(messages),
    allowedAgents: ['codex-general'],
    metadata: {
      currentUserMessage: userMessage,
    },
  };

  let result: PersonalAgentResponse;
  try {
    const response = await fetch(`${getPersonalAgentServerUrl()}/v1/turns/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    result = (await response.json().catch(() => ({}))) as PersonalAgentResponse;
    if (!response.ok) {
      return NextResponse.json(
        { error: result.error || `personal-agent-server HTTP ${response.status}` },
        { status: 502 }
      );
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `个人 Agent 服务不可用：${detail}` }, { status: 502 });
  }

  const reply = typeof result.reply === 'string' && result.reply.trim()
    ? result.reply.trim()
    : '个人 Agent 已完成本轮处理，但没有返回可展示的回复。';

  const assistantMessage = await appendThreadMessage({
    threadId: thread.id,
    role: 'ASSISTANT',
    content: reply,
    meta: {
      route: result.route,
      raw: result.raw,
    },
  });

  await appendToolCall({
    threadId: thread.id,
    messageId: assistantMessage.id,
    toolName: 'personal_agent_server.turn',
    status: result.route ? 'SUCCESS' : 'UNKNOWN',
    toolArgs: {
      allowedAgents: payload.allowedAgents,
      messageLength: payload.message.length,
    },
    toolResult: {
      route: result.route,
      eventCount: Array.isArray(result.events) ? result.events.length : 0,
      raw: result.raw,
    },
  });

  return NextResponse.json({
    threadId: thread.id,
    reply,
    route: result.route,
    messages: displayMessages([...messages, { role: 'assistant', content: reply }]),
  });
}
