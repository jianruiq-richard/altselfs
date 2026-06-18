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

type PersonalAgentStreamResult = PersonalAgentResponse & {
  threadId?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTransientAgentFailureMessage(message: ClientMessage) {
  return (
    message.role === 'assistant' &&
    /^(Codex app-server 执行失败|个人 Agent 服务不可用|个人 Agent 已完成本轮处理，但没有返回可展示的回复)/.test(
      message.content.trim()
    )
  );
}

function getPersonalAgentToolStatus(reply: string, route?: string) {
  if (/^(Codex app-server 执行失败|个人 Agent 服务不可用|个人 Agent 已完成本轮处理，但没有返回可展示的回复)/.test(reply.trim())) {
    return 'ERROR';
  }
  return route ? 'SUCCESS' : 'UNKNOWN';
}

function buildAgentTurnMessage(messages: ClientMessage[]) {
  const recent = messages.filter((message) => !isTransientAgentFailureMessage(message)).slice(-12);
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

  if (req.nextUrl.searchParams.get('stream') === '1') {
    return streamPersonalAgentTurn({
      threadId: thread.id,
      payload,
      messages,
    });
  }

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
    status: getPersonalAgentToolStatus(reply, result.route),
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

function streamPersonalAgentTurn(params: {
  threadId: string;
  payload: {
    userId: string;
    threadId: string;
    message: string;
    allowedAgents: string[];
    metadata: {
      currentUserMessage: string;
    };
  };
  messages: ClientMessage[];
}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const write = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The client may have disconnected after receiving the final event.
        }
      };

      void (async () => {
        let finalResult: PersonalAgentStreamResult | null = null;
        try {
          write({ type: 'turn_started', timestamp: new Date().toISOString() });
          const response = await fetch(`${getPersonalAgentServerUrl()}/v1/turns/start?stream=1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params.payload),
            cache: 'no-store',
          });

          if (!response.ok || !response.body) {
            const errorPayload = (await response.json().catch(() => ({}))) as PersonalAgentResponse;
            write({
              type: 'final',
              status: response.ok ? 500 : response.status,
              data: { error: errorPayload.error || `personal-agent-server HTTP ${response.status}` },
            });
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const parsed = parseStreamLine(line);
              if (!parsed) continue;
              if (parsed.type === 'final' && isRecord(parsed.result)) {
                finalResult = parsed.result as PersonalAgentStreamResult;
                continue;
              }
              write(parsed);
            }
          }

          if (buffer.trim()) {
            const parsed = parseStreamLine(buffer);
            if (parsed?.type === 'final' && isRecord(parsed.result)) {
              finalResult = parsed.result as PersonalAgentStreamResult;
            } else if (parsed) {
              write(parsed);
            }
          }

          const reply = typeof finalResult?.reply === 'string' && finalResult.reply.trim()
            ? finalResult.reply.trim()
            : '个人 Agent 已完成本轮处理，但没有返回可展示的回复。';

          const assistantMessage = await appendThreadMessage({
            threadId: params.threadId,
            role: 'ASSISTANT',
            content: reply,
            meta: {
              route: finalResult?.route,
              raw: finalResult?.raw,
            },
          });

          await appendToolCall({
            threadId: params.threadId,
            messageId: assistantMessage.id,
            toolName: 'personal_agent_server.turn',
            status: getPersonalAgentToolStatus(reply, finalResult?.route),
            toolArgs: {
              allowedAgents: params.payload.allowedAgents,
              messageLength: params.payload.message.length,
            },
            toolResult: {
              route: finalResult?.route,
              eventCount: Array.isArray(finalResult?.events) ? finalResult.events.length : 0,
              raw: finalResult?.raw,
            },
          });

          write({
            type: 'final',
            status: 200,
            data: {
              threadId: params.threadId,
              reply,
              route: finalResult?.route,
              messages: displayMessages([...params.messages, { role: 'assistant', content: reply }]),
            },
          });
        } catch (error) {
          write({
            type: 'final',
            status: 502,
            data: {
              error: `个人 Agent 服务不可用：${error instanceof Error ? error.message : String(error)}`,
            },
          });
        } finally {
          close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function parseStreamLine(line: string) {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}
