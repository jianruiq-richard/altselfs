import { Buffer } from 'node:buffer';
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
const DEFAULT_MULTIMODAL_MODEL = 'qwen/qwen3.6-flash';
const DEFAULT_MULTIMODAL_MAX_FILES = 6;
const DEFAULT_MULTIMODAL_MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_FILE_PARSER_MAX_CHARS = 60000;

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

function getOpenRouterMultimodalModel() {
  return process.env.OPENROUTER_MULTIMODAL_MODEL || DEFAULT_MULTIMODAL_MODEL;
}

function getOpenRouterMultimodalMaxFiles() {
  const parsed = Number(process.env.OPENROUTER_MULTIMODAL_MAX_FILES || '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MULTIMODAL_MAX_FILES;
}

function getOpenRouterMultimodalMaxFileBytes() {
  const parsed = Number(process.env.OPENROUTER_MULTIMODAL_MAX_FILE_BYTES || '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MULTIMODAL_MAX_FILE_BYTES;
}

function getOpenRouterFileParserModel() {
  return process.env.OPENROUTER_FILE_PARSER_MODEL || process.env.OPENROUTER_MULTIMODAL_MODEL || DEFAULT_MULTIMODAL_MODEL;
}

function getOpenRouterFileParserMaxChars() {
  const parsed = Number(process.env.OPENROUTER_FILE_PARSER_MAX_CHARS || '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_FILE_PARSER_MAX_CHARS;
}

function getOpenRouterFileParserEngine() {
  return process.env.OPENROUTER_MULTIMODAL_PDF_ENGINE || 'cloudflare-ai';
}

function getOpenRouterHeaders() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw Object.assign(new Error('缺少 OPENROUTER_API_KEY，无法调用 OpenRouter 文件解析工具。'), { status: 500 });
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.OPENROUTER_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'X-Title': process.env.OPENROUTER_APP_NAME || 'Altselfs Personal Agent',
  };
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
    const body = (await req.json().catch(() => ({}))) as { threadId?: string | null; messages?: unknown };
    const messages = normalizeMessages(body.messages);
    const userMessage = latestUserMessage(messages);
    return {
      threadId: body.threadId || null,
      messages,
      userMessage,
      displayUserMessage: userMessage,
      attachments: [],
    };
  }

  const form = await req.formData();
  const rawMessages = getStringFormValue(form.get('messages'));
  const messages = parseMessagesJson(rawMessages);
  const explicitMessage = getStringFormValue(form.get('message'));
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
  const displayUserMessage = latestUserMessage(messages) || userMessage;

  return {
    threadId: getStringFormValue(form.get('threadId')) || null,
    messages: latestUserMessage(messages) ? messages : [...messages, { role: 'user', content: displayUserMessage }],
    userMessage,
    displayUserMessage,
    attachments,
  };
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

function getOpenRouterParserContentPart(attachment: UploadedAttachment) {
  if (attachment.kind === 'video') {
    return {
      type: 'video_url',
      videoUrl: {
        url: attachment.dataUrl,
      },
    };
  }

  return {
    type: 'file',
    file: {
      filename: attachment.name,
      file_data: attachment.dataUrl,
    },
  };
}

function extractOpenRouterMessageText(payload: unknown) {
  if (!isRecord(payload)) return '';
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices.find(isRecord);
  if (!firstChoice) return '';
  const message = isRecord(firstChoice.message) ? firstChoice.message : {};
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!isRecord(part)) return '';
      return typeof part.text === 'string' ? part.text : '';
    })
    .join('')
    .trim();
}

function getOpenRouterErrorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  if (typeof payload.error === 'string') return payload.error;
  if (isRecord(payload.error)) {
    if (typeof payload.error.message === 'string') return payload.error.message;
    if (typeof payload.error.code === 'string') return `${fallback}：${payload.error.code}`;
  }
  if (typeof payload.message === 'string') return payload.message;
  return fallback;
}

async function parseAttachmentsWithOpenRouter(attachments: UploadedAttachment[], userMessage: string) {
  const parseTargets = attachments.filter((attachment) => attachment.kind !== 'image');
  if (parseTargets.length === 0) return '';

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: getOpenRouterHeaders(),
    body: JSON.stringify({
      model: getOpenRouterFileParserModel(),
      temperature: 0,
      max_tokens: Number(process.env.OPENROUTER_FILE_PARSER_MAX_TOKENS || 12000),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                '请作为文件解析工具处理附件。',
                '目标：尽可能逐字提取附件中的可读文本，不要总结，不要补充解释。',
                '如果附件包含表格、签署页、标题、编号或日期，请保留结构和换行。',
                '如果某个附件无法解析，请在对应文件名下写明无法解析的原因。',
                `用户本轮问题：${userMessage || '请分析附件内容。'}`,
              ].join('\n'),
            },
            ...parseTargets.map(getOpenRouterParserContentPart),
          ],
        },
      ],
      plugins: [
        {
          id: 'file-parser',
          pdf: {
            engine: getOpenRouterFileParserEngine(),
          },
        },
      ],
    }),
    cache: 'no-store',
  }).catch((error) => {
    throw Object.assign(new Error(`OpenRouter 文件解析工具不可用：${error instanceof Error ? error.message : String(error)}`), {
      status: 502,
    });
  });

  const raw = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    throw Object.assign(new Error(getOpenRouterErrorMessage(raw, `OpenRouter 文件解析 HTTP ${response.status}`)), {
      status: 502,
    });
  }

  const text = extractOpenRouterMessageText(raw);
  if (!text) {
    throw Object.assign(new Error('OpenRouter 文件解析完成，但没有返回可用文本。'), { status: 502 });
  }
  return text.slice(0, getOpenRouterFileParserMaxChars());
}

function buildAgentTurnMessageWithParsedAttachments(messages: ClientMessage[], parsedAttachmentText: string) {
  const base = buildAgentTurnMessage(messages);
  if (!parsedAttachmentText.trim()) return base;
  return [
    base,
    '',
    '以下附件内容已由 OpenRouter 文件解析工具提取。请把它作为本轮用户输入的一部分使用；不要声称你无法读取附件。',
    '<parsed_attachments>',
    parsedAttachmentText.trim(),
    '</parsed_attachments>',
  ].join('\n');
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
  let parsedAttachmentText = '';
  try {
    parsedAttachmentText = await parseAttachmentsWithOpenRouter(attachments, userMessage);
  } catch (error) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 502;
    const detail = error instanceof Error ? error.message : '附件解析失败';
    return NextResponse.json({ error: detail }, { status });
  }
  const codexInputAttachments = attachments.filter((attachment) => attachment.kind === 'image');

  const thread = await ensureThread({
    investorId: investor.id,
    agentType: PERSONAL_AGENT_TYPE,
    threadId: parsedBody.threadId || null,
  });

  await appendThreadMessage({
    threadId: thread.id,
    role: 'USER',
    content: displayUserMessage || userMessage,
    meta: attachments.length > 0
      ? {
          attachments: getAttachmentMetadata(attachments),
          parsedByOpenRouter: Boolean(parsedAttachmentText),
        }
      : undefined,
  });

  const payload = {
    userId: investor.email || investor.id,
    threadId: thread.id,
    message: buildAgentTurnMessageWithParsedAttachments(messages, parsedAttachmentText),
    allowedAgents: ['codex-general'],
    metadata: {
      currentUserMessage: userMessage,
      ...(codexInputAttachments.length > 0
        ? {
            codexModel: getOpenRouterMultimodalModel(),
            multimodal: true,
            attachments: getAttachmentPayloads(codexInputAttachments),
          }
        : {}),
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
