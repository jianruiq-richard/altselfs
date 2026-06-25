import { Buffer } from 'node:buffer';
import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import {
  appendThreadMessage,
  ensureThread,
  getLatestThreadWithMessages,
  getThreadMessagesPage,
  toClientMessages,
} from '@/lib/agent-session';

export const maxDuration = 800;

const PERSONAL_AGENT_TYPE = 'PERSONAL';
const DEFAULT_MULTIMODAL_MAX_FILES = 6;
const DEFAULT_MULTIMODAL_MAX_FILE_BYTES = 20 * 1024 * 1024;

type ClientMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
};

type PersonalAgentResponse = {
  route?: string;
  reply?: string;
  events?: unknown[];
  raw?: unknown;
  runId?: string;
  error?: string;
};

type PersonalAgentStreamResult = PersonalAgentResponse & {
  threadId?: string;
  cancelled?: boolean;
  error?: string;
};

type AttachmentKind = 'image' | 'video' | 'pdf' | 'document' | 'file';

type UploadedAttachment = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  kind: AttachmentKind;
};

type ParsedPostBody = {
  threadId?: string | null;
  messages: ClientMessage[];
  userMessage: string;
  displayUserMessage: string;
  attachments: UploadedAttachment[];
};

function getPersonalAgentServerUrl() {
  return (process.env.PERSONAL_AGENT_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
}

function getOpenRouterMultimodalMaxFiles() {
  const parsed = Number(process.env.OPENROUTER_MULTIMODAL_MAX_FILES || '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MULTIMODAL_MAX_FILES;
}

function getOpenRouterMultimodalMaxFileBytes() {
  const parsed = Number(process.env.OPENROUTER_MULTIMODAL_MAX_FILE_BYTES || '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MULTIMODAL_MAX_FILE_BYTES;
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
      return {
        ...(typeof record.id === 'string' ? { id: record.id } : {}),
        role,
        content,
        ...(typeof record.createdAt === 'string' ? { createdAt: record.createdAt } : {}),
      };
    })
    .filter(Boolean) as ClientMessage[];
}

function latestUserMessage(messages: ClientMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'user')?.content.trim() || '';
}

function getStringFormValue(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseMessagesJson(value: string) {
  if (!value) return [];
  try {
    return normalizeMessages(JSON.parse(value) as unknown);
  } catch {
    throw Object.assign(new Error('messages 字段不是有效的 JSON。'), { status: 400 });
  }
}

function inferMimeType(name: string, providedType: string) {
  const lowerName = name.toLowerCase();
  const normalizedType = providedType.trim().toLowerCase();
  if (normalizedType === 'video/quicktime') return 'video/mov';
  if (normalizedType) return normalizedType;
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.doc')) return 'application/msword';
  if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  if (lowerName.endsWith('.mp4')) return 'video/mp4';
  if (lowerName.endsWith('.mpeg') || lowerName.endsWith('.mpg')) return 'video/mpeg';
  if (lowerName.endsWith('.mov')) return 'video/mov';
  if (lowerName.endsWith('.webm')) return 'video/webm';
  return 'application/octet-stream';
}

function getAttachmentKind(name: string, mimeType: string): AttachmentKind {
  const lowerName = name.toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.doc') ||
    lowerName.endsWith('.docx')
  ) {
    return 'document';
  }
  return 'file';
}

async function fileToAttachment(file: File): Promise<UploadedAttachment> {
  const type = inferMimeType(file.name || 'attachment', file.type || '');
  const buffer = Buffer.from(await file.arrayBuffer());
  return {
    name: file.name || 'attachment',
    type,
    size: file.size,
    dataUrl: `data:${type};base64,${buffer.toString('base64')}`,
    kind: getAttachmentKind(file.name || 'attachment', type),
  };
}

async function parsePostBody(req: NextRequest): Promise<ParsedPostBody> {
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    const body = (await req.json().catch(() => ({}))) as {
      threadId?: string | null;
      message?: unknown;
      displayMessage?: unknown;
      messages?: unknown;
    };
    const messages = normalizeMessages(body.messages);
    const explicitMessage = typeof body.message === 'string' ? body.message.trim() : '';
    const displayMessage = typeof body.displayMessage === 'string' ? body.displayMessage.trim() : '';
    const userMessage = explicitMessage || latestUserMessage(messages);
    return {
      threadId: body.threadId || null,
      messages: userMessage ? [{ role: 'user', content: userMessage }] : messages,
      userMessage,
      displayUserMessage: displayMessage || userMessage,
      attachments: [],
    };
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw Object.assign(
      new Error('附件上传请求解析失败：PDF 可能超过上传上限，或请求体被 Next 代理截断。请重启 npm run dev 后重试；单个附件请控制在 20MB 内。'),
      { status: 413 }
    );
  }
  const explicitMessage = getStringFormValue(form.get('message'));
  const displayMessage = getStringFormValue(form.get('displayMessage'));
  const rawMessages = getStringFormValue(form.get('messages'));
  const messages = parseMessagesJson(rawMessages);
  const maxFiles = getOpenRouterMultimodalMaxFiles();
  const maxFileBytes = getOpenRouterMultimodalMaxFileBytes();
  const files = form
    .getAll('attachments')
    .filter((value): value is File => typeof File !== 'undefined' && value instanceof File && value.size > 0);

  if (files.length > maxFiles) {
    throw Object.assign(new Error(`最多支持一次上传 ${maxFiles} 个附件。`), { status: 400 });
  }

  const oversized = files.find((file) => file.size > maxFileBytes);
  if (oversized) {
    throw Object.assign(new Error(`附件 ${oversized.name} 超过大小限制。`), { status: 400 });
  }

  const attachments = await Promise.all(files.map(fileToAttachment));
  const fallbackMessage = attachments.length > 0 ? '请分析我上传的附件。' : '';
  const userMessage = explicitMessage || latestUserMessage(messages) || fallbackMessage;
  const displayUserMessage = displayMessage || latestUserMessage(messages) || userMessage;

  return {
    threadId: getStringFormValue(form.get('threadId')) || null,
    messages: [{ role: 'user', content: userMessage }],
    userMessage,
    displayUserMessage,
    attachments,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getAttachmentMetadata(attachments: UploadedAttachment[]) {
  return attachments.map((attachment) => ({
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    kind: attachment.kind,
  }));
}

function getAttachmentPayloads(attachments: UploadedAttachment[]) {
  return attachments.map((attachment) => ({
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    kind: attachment.kind,
    dataUrl: attachment.dataUrl,
  }));
}


function buildCurrentTurnMessage(messages: ClientMessage[]) {
  return latestUserMessage(messages);
}

function displayMessages(messages: ClientMessage[]) {
  return messages.map((message) => ({
    ...(message.id ? { id: message.id } : {}),
    role: message.role,
    content: message.content,
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
  }));
}

export async function GET(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const requestedThreadId = req.nextUrl.searchParams.get('threadId')?.trim();
  const statusRequested = req.nextUrl.searchParams.get('status') === '1';
  if (statusRequested) {
    const thread = requestedThreadId
      ? await getThreadMessagesPage({
          investorId: investor.id,
          agentType: PERSONAL_AGENT_TYPE,
          threadId: requestedThreadId,
          limit: 1,
        })
      : await getLatestThreadWithMessages(investor.id, PERSONAL_AGENT_TYPE);
    const threadId = requestedThreadId || (thread && 'id' in thread ? thread.id : null);
    if (!threadId || !thread) {
      return NextResponse.json({
        threadId: threadId || null,
        status: 'IDLE',
        activeRunId: null,
        activeSessionId: null,
        diskBytes: null,
        recentEvents: [],
      });
    }

    try {
      const query = new URLSearchParams({
        threadId,
        investorId: investor.id,
        userId: investor.email || investor.id,
        recentEventLimit: '30',
      });
      const response = await fetch(`${getPersonalAgentServerUrl()}/v1/threads/status?${query.toString()}`, {
        cache: 'no-store',
      });
      const statusPayload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        return NextResponse.json(
          { error: typeof statusPayload.error === 'string' ? statusPayload.error : `personal-agent-server HTTP ${response.status}` },
          { status: 502 }
        );
      }
      return NextResponse.json({ threadId, ...statusPayload });
    } catch (error) {
      return NextResponse.json(
        { error: `个人 Agent 状态服务不可用：${error instanceof Error ? error.message : String(error)}` },
        { status: 502 }
      );
    }
  }

  if (requestedThreadId) {
    const beforeMessageId = req.nextUrl.searchParams.get('before')?.trim() || null;
    const parsedLimit = Number(req.nextUrl.searchParams.get('limit') || '');
    const page = await getThreadMessagesPage({
      investorId: investor.id,
      agentType: PERSONAL_AGENT_TYPE,
      threadId: requestedThreadId,
      beforeMessageId,
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 60,
    });

    if (!page) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

    return NextResponse.json({
      threadId: requestedThreadId,
      messages: toClientMessages(page.messages),
      hasMore: page.hasMore,
      nextBefore: page.nextBeforeMessageId,
    });
  }

  const thread = await getLatestThreadWithMessages(investor.id, PERSONAL_AGENT_TYPE);
  return NextResponse.json({
    threadId: thread?.id || null,
    messages: thread ? toClientMessages(thread.messages) : [],
    hasMore: thread ? thread._count.messages > thread.messages.length : false,
  });
}

export async function POST(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let parsedBody: ParsedPostBody;
  try {
    parsedBody = await parsePostBody(req);
  } catch (error) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 400;
    const detail = error instanceof Error ? error.message : '请求格式不正确';
    return NextResponse.json({ error: detail }, { status });
  }

  const { messages, userMessage, displayUserMessage, attachments } = parsedBody;
  if (!userMessage && attachments.length === 0) return NextResponse.json({ error: '消息不能为空' }, { status: 400 });

  const thread = await ensureThread({
    investorId: investor.id,
    agentType: PERSONAL_AGENT_TYPE,
    threadId: parsedBody.threadId || null,
  });

  const userMessageMeta = attachments.length > 0
    ? {
        attachments: getAttachmentMetadata(attachments),
        storedInAgentWorkspace: true,
      }
    : undefined;

  const userThreadMessage = await appendThreadMessage({
    threadId: thread.id,
    role: 'USER',
    content: displayUserMessage || userMessage,
    meta: userMessageMeta,
  });

  const payload = {
    userId: investor.email || investor.id,
    threadId: thread.id,
    message: buildCurrentTurnMessage(messages),
    allowedAgents: ['codex-general'],
    metadata: {
      currentMessageId: userThreadMessage.id,
      investorId: investor.id,
      contextMode: 'ecs_database_context',
      currentUserMessage: userMessage,
      displayUserMessage: displayUserMessage || userMessage,
      currentMessageMetadata: userMessageMeta,
      attachments: getAttachmentMetadata(attachments),
      workspaceAttachments: getAttachmentPayloads(attachments),
    },
  };

  if (req.nextUrl.searchParams.get('stream') === '1') {
    return streamPersonalAgentTurn({
      threadId: thread.id,
      userMessage,
      payload,
      messages,
    });
  }

  let result: PersonalAgentResponse;
  try {
    const response = await fetch(`${getPersonalAgentServerUrl()}/v1/turns/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, includeEvents: true }),
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

  await appendThreadMessage({
    threadId: thread.id,
    role: 'ASSISTANT',
    content: reply,
    meta: {
      route: result.route,
      raw: result.raw,
    },
  });

  return NextResponse.json({
    threadId: thread.id,
    runId: result.runId,
    reply,
    route: result.route,
    messages: displayMessages([...messages, { role: 'assistant', content: reply }]),
  });
}

export async function DELETE(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { runId?: unknown; threadId?: unknown };
  const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
  const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
  if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 });
  if (threadId) {
    const thread = await getThreadMessagesPage({
      investorId: investor.id,
      agentType: PERSONAL_AGENT_TYPE,
      threadId,
      limit: 1,
    });
    if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  try {
    const response = await fetch(`${getPersonalAgentServerUrl()}/v1/runs/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        threadId: threadId || undefined,
        investorId: investor.id,
        userId: investor.email || investor.id,
      }),
      cache: 'no-store',
    });
    const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json(
        { error: typeof result.error === 'string' ? result.error : `personal-agent-server HTTP ${response.status}` },
        { status: 502 }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: `停止个人 Agent 失败：${error instanceof Error ? error.message : String(error)}` },
      { status: 502 }
    );
  }
}

function streamPersonalAgentTurn(params: {
  threadId: string;
  userMessage: string;
  payload: {
    userId: string;
    threadId: string;
    message: string;
    allowedAgents: string[];
    metadata: Record<string, unknown>;
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

          if (finalResult?.cancelled || finalResult?.error) {
            write({
              type: 'final',
              status: finalResult.cancelled ? 499 : 500,
              data: {
                threadId: params.threadId,
                runId: finalResult.runId,
                cancelled: Boolean(finalResult.cancelled),
                error: finalResult.error || '发送失败',
                messages: displayMessages(params.messages),
              },
            });
            return;
          }

          await appendThreadMessage({
            threadId: params.threadId,
            role: 'ASSISTANT',
            content: reply,
            meta: {
              route: finalResult?.route,
              raw: finalResult?.raw,
            },
          });

          write({
            type: 'final',
            status: 200,
            data: {
              threadId: params.threadId,
              runId: finalResult?.runId,
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
