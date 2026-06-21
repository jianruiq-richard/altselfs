import http from 'node:http';
import type { ServerConfig } from './config.js';
import type { MemoryReviewJobStore } from './memory-review-queue.js';
import { renderProductizationPage } from './productization-page.js';
import { isRecord } from './util.js';
import type { PersonalMainAgent } from './main-agent.js';

type OpenRouterChatContentPart = Record<string, unknown>;
type OpenRouterChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenRouterChatContentPart[];
};

export function createHttpServer(agent: PersonalMainAgent, config?: ServerConfig, memoryReviewQueue?: MemoryReviewJobStore) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, { ok: true });
      }

      if (req.method === 'GET' && url.pathname === '/productization') {
        if (!config) return json(res, 500, { error: 'config missing' });
        const jobs = memoryReviewQueue ? await memoryReviewQueue.listRecent(50) : [];
        return html(res, 200, renderProductizationPage(config, jobs));
      }

      if (req.method === 'GET' && url.pathname === '/v1/memory-review/jobs') {
        const limit = Number(url.searchParams.get('limit') || 50);
        return json(res, 200, {
          jobs: memoryReviewQueue ? await memoryReviewQueue.listRecent(Number.isFinite(limit) ? limit : 50) : [],
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/turns/start') {
        const body = await readJsonBody(req);
        if (!isRecord(body)) return json(res, 400, { error: 'JSON body must be an object' });
        const turnRequest = {
          userId: String(body.userId || ''),
          threadId: typeof body.threadId === 'string' ? body.threadId : undefined,
          message: String(body.message || ''),
          allowedAgents: Array.isArray(body.allowedAgents) ? body.allowedAgents.map(String) : undefined,
          metadata: isRecord(body.metadata) ? body.metadata : undefined,
        };
        if (url.searchParams.get('stream') === '1') {
          return streamTurnStart(res, agent, turnRequest);
        }

        const result = await agent.startTurn(turnRequest);
        if (url.searchParams.get('format') === 'text') {
          return text(res, 200, result.reply);
        }
        const includeEvents = body.includeEvents === true || url.searchParams.get('debug') === '1';
        return json(res, 200, includeEvents ? result : { ...result, events: [] });
      }

      if (req.method === 'POST' && url.pathname === '/openrouter-responses-proxy/v1/responses') {
        if (!config) return json(res, 500, { error: 'proxy config missing' });
        const body = await readJsonBody(req);
        if (!isRecord(body)) return json(res, 400, { error: 'JSON body must be an object' });
        return openRouterResponsesProxy(res, config, body);
      }

      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      return json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function streamTurnStart(
  res: http.ServerResponse,
  agent: PersonalMainAgent,
  request: {
    userId: string;
    threadId?: string;
    message: string;
    allowedAgents?: string[];
    metadata?: Record<string, unknown>;
  }
) {
  let closed = false;
  const write = (payload: unknown) => {
    if (closed || res.destroyed) return;
    res.write(`${JSON.stringify(payload)}\n`);
  };

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  const heartbeat = setInterval(() => {
    write({ type: 'heartbeat', timestamp: new Date().toISOString() });
  }, 15_000);

  res.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
  });

  void (async () => {
    try {
      write({ type: 'turn_started', timestamp: new Date().toISOString() });
      const result = await agent.startTurn({
        ...request,
        onEvent: async (event) => {
          write({ type: 'event', event });
        },
      });
      write({ type: 'final', result: { ...result, events: [] } });
    } catch (error) {
      write({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearInterval(heartbeat);
      if (!closed) {
        closed = true;
        res.end();
      }
    }
  })();
}

async function openRouterResponsesProxy(
  res: http.ServerResponse,
  config: ServerConfig,
  body: Record<string, unknown>
) {
  const apiKey = process.env[config.openRouterApiKeyEnv]?.trim();
  if (!apiKey) return json(res, 500, { error: `${config.openRouterApiKeyEnv} is missing` });

  const model = typeof body.model === 'string' && body.model.trim()
    ? body.model.trim()
    : config.codexModel || config.hermesModel;
  const messages = responsesBodyToChatMessages(body);
  console.log(
    `[openrouter-responses-proxy] request model=${model} messages=${messages.length} inputChars=${messages
      .map((message) => chatContentLength(message.content))
      .reduce((sum, length) => sum + length, 0)}`
  );
  if (body.stream === true) {
    return streamOpenRouterResponsesProxy(res, config, { model, messages, body });
  }

  const response = await fetch(`${config.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'x-title': config.openRouterAppTitle,
    },
      body: JSON.stringify({
        model,
        messages,
        temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
        ...openRouterFileParserOptions(messages),
        stream: false,
      }),
  });
  const raw = await response.text();
  if (!response.ok) {
    console.warn(`[openrouter-responses-proxy] upstream failed status=${response.status} body=${raw.slice(0, 500)}`);
    res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(raw || JSON.stringify({ error: `OpenRouter HTTP ${response.status}` }));
    return;
  }

  let text = '';
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
      const first = isRecord(choices[0]) ? choices[0] : {};
      const message = isRecord(first.message) ? first.message : {};
      text = extractOpenRouterMessageText(message.content);
      if (!text && typeof first.text === 'string') text = first.text;
    }
  } catch {
    text = raw;
  }
  console.log(`[openrouter-responses-proxy] upstream ok outputChars=${text.length} output=${JSON.stringify(text.slice(0, 200))}`);

  const responseId = `resp_${Date.now().toString(36)}`;
  const messageId = `msg_${Date.now().toString(36)}`;
  const events = [
    { type: 'response.created', response: { id: responseId } },
    {
      type: 'response.output_item.done',
      item: {
        type: 'message',
        role: 'assistant',
        id: messageId,
        content: [{ type: 'output_text', text }],
      },
    },
    {
      type: 'response.completed',
      response: { id: responseId },
    },
  ];

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  for (const event of events) {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

async function streamOpenRouterResponsesProxy(
  res: http.ServerResponse,
  config: ServerConfig,
  params: {
    model: string;
    messages: OpenRouterChatMessage[];
    body: Record<string, unknown>;
  }
) {
  const apiKey = process.env[config.openRouterApiKeyEnv]?.trim();
  if (!apiKey) return json(res, 500, { error: `${config.openRouterApiKeyEnv} is missing` });

  const responseId = `resp_${Date.now().toString(36)}`;
  const messageId = `msg_${Date.now().toString(36)}`;
  const createdAt = Math.floor(Date.now() / 1000);
  let sequence = 0;
  let text = '';
  const outputItem = {
    id: messageId,
    type: 'message',
    role: 'assistant',
    status: 'in_progress',
    content: [] as Array<{ type: 'output_text'; text: string; annotations: unknown[] }>,
  };
  const responseSnapshot = (status: 'in_progress' | 'completed' | 'failed') => ({
    id: responseId,
    object: 'response',
    created_at: createdAt,
    model: params.model,
    status,
    output: status === 'completed'
      ? [
          {
            ...outputItem,
            status: 'completed',
            content: [{ type: 'output_text', text, annotations: [] }],
          },
        ]
      : [],
  });
  const writeSse = (event: Record<string, unknown>) => {
    res.write(`event: ${String(event.type || 'message')}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  writeSse({
    type: 'response.created',
    sequence_number: nextSequence(),
    response: responseSnapshot('in_progress'),
  });
  writeSse({
    type: 'response.output_item.added',
    sequence_number: nextSequence(),
    output_index: 0,
    item: outputItem,
  });
  writeSse({
    type: 'response.content_part.added',
    sequence_number: nextSequence(),
    output_index: 0,
    content_index: 0,
    item_id: messageId,
    part: { type: 'output_text', text: '', annotations: [] },
  });

  try {
    const upstream = await fetch(`${config.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'x-title': config.openRouterAppTitle,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: typeof params.body.temperature === 'number' ? params.body.temperature : undefined,
        ...openRouterFileParserOptions(params.messages),
        stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const raw = await upstream.text().catch(() => '');
      console.warn(`[openrouter-responses-proxy] streaming upstream failed status=${upstream.status} body=${raw.slice(0, 500)}`);
      writeSse({
        type: 'response.failed',
        sequence_number: nextSequence(),
        response: {
          ...responseSnapshot('failed'),
          error: {
            code: `openrouter_http_${upstream.status}`,
            message: raw || `OpenRouter HTTP ${upstream.status}`,
          },
        },
      });
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneSeen = false;

    const handleSseBlock = (block: string) => {
      const data = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s?/, ''))
        .join('\n')
        .trim();
      if (!data) return;
      if (data === '[DONE]') {
        doneSeen = true;
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const delta = extractOpenRouterDeltaText(parsed);
      if (!delta) return;
      text += delta;
      writeSse({
        type: 'response.output_text.delta',
        sequence_number: nextSequence(),
        output_index: 0,
        content_index: 0,
        item_id: messageId,
        delta,
        logprobs: [],
      });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) handleSseBlock(block);
    }
    if (buffer.trim()) handleSseBlock(buffer);
    if (!doneSeen) {
      console.warn('[openrouter-responses-proxy] streaming upstream ended without [DONE]');
    }

    const completedText = { type: 'output_text', text, annotations: [] };
    const completedItem = {
      ...outputItem,
      status: 'completed',
      content: [completedText],
    };
    writeSse({
      type: 'response.output_text.done',
      sequence_number: nextSequence(),
      output_index: 0,
      content_index: 0,
      item_id: messageId,
      text,
      logprobs: [],
    });
    writeSse({
      type: 'response.content_part.done',
      sequence_number: nextSequence(),
      output_index: 0,
      content_index: 0,
      item_id: messageId,
      part: completedText,
    });
    writeSse({
      type: 'response.output_item.done',
      sequence_number: nextSequence(),
      output_index: 0,
      item: completedItem,
    });
    writeSse({
      type: 'response.completed',
      sequence_number: nextSequence(),
      response: responseSnapshot('completed'),
    });
    console.log(`[openrouter-responses-proxy] streaming upstream ok outputChars=${text.length} output=${JSON.stringify(text.slice(0, 200))}`);
  } catch (error) {
    writeSse({
      type: 'response.failed',
      sequence_number: nextSequence(),
      response: {
        ...responseSnapshot('failed'),
        error: {
          code: 'openrouter_stream_error',
          message: error instanceof Error ? error.message : String(error),
        },
      },
    });
  } finally {
    res.end();
  }
}

function extractOpenRouterMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!isRecord(part)) return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      if (typeof part.output_text === 'string') return part.output_text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractOpenRouterDeltaText(value: unknown): string {
  if (!isRecord(value)) return '';
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const first = isRecord(choices[0]) ? choices[0] : {};
  const delta = isRecord(first.delta) ? first.delta : {};
  return extractOpenRouterMessageText(delta.content);
}

function responsesBodyToChatMessages(body: Record<string, unknown>): OpenRouterChatMessage[] {
  const messages: OpenRouterChatMessage[] = [];
  if (typeof body.instructions === 'string' && body.instructions.trim()) {
    messages.push({ role: 'system', content: body.instructions });
  }
  const input = Array.isArray(body.input) ? body.input : [];
  for (const item of input) {
    if (!isRecord(item) || item.type !== 'message') continue;
    const role = item.role === 'assistant' ? 'assistant' : 'user';
    const content = Array.isArray(item.content)
      ? normalizeOpenRouterContentParts(item.content)
      : typeof item.content === 'string'
        ? item.content
        : '';
    if (typeof content === 'string' ? content.trim() : content.length > 0) messages.push({ role, content });
  }
  if (messages.length === 0) messages.push({ role: 'user', content: 'Continue.' });
  return messages;
}

function normalizeOpenRouterContentParts(parts: unknown[]) {
  const normalized = parts
    .map((part) => normalizeOpenRouterContentPart(part))
    .filter(Boolean) as OpenRouterChatContentPart[];
  if (normalized.length === 0) return '';
  if (normalized.every((part) => part.type === 'text')) {
    return normalized
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return normalized;
}

function normalizeOpenRouterContentPart(part: unknown): OpenRouterChatContentPart | null {
  if (typeof part === 'string') return { type: 'text', text: part };
  if (!isRecord(part)) return null;
  if (typeof part.text === 'string') return { type: 'text', text: part.text };
  if (typeof part.input_text === 'string') return { type: 'text', text: part.input_text };
  if (part.type === 'input_text' && typeof part.text === 'string') return { type: 'text', text: part.text };

  const imageUrl = typeof part.image_url === 'string'
    ? part.image_url
    : isRecord(part.image_url) && typeof part.image_url.url === 'string'
      ? part.image_url.url
      : '';
  if ((part.type === 'input_image' || part.type === 'image' || part.type === 'image_url') && imageUrl) {
    return {
      type: 'image_url',
      image_url: { url: imageUrl },
    };
  }

  if (part.type === 'file' && isRecord(part.file)) {
    const fileData = typeof part.file.file_data === 'string'
      ? part.file.file_data
      : typeof part.file.fileData === 'string'
        ? part.file.fileData
        : '';
    if (!fileData) return null;
    return {
      type: 'file',
      file: {
        filename: typeof part.file.filename === 'string' ? part.file.filename : 'attachment',
        file_data: fileData,
      },
    };
  }

  const videoUrl = part.type === 'video_url'
    ? isRecord(part.videoUrl) && typeof part.videoUrl.url === 'string'
      ? part.videoUrl.url
      : typeof part.video_url === 'string'
        ? part.video_url
        : ''
    : '';
  if (videoUrl) {
    return {
      type: 'video_url',
      videoUrl: { url: videoUrl },
    };
  }

  return null;
}

function chatContentLength(content: OpenRouterChatMessage['content']) {
  if (typeof content === 'string') return content.length;
  return content.reduce((sum, part) => sum + JSON.stringify(part).length, 0);
}

function openRouterFileParserOptions(messages: OpenRouterChatMessage[]) {
  const hasFile = messages.some((message) => {
    if (!Array.isArray(message.content)) return false;
    return message.content.some((part) => part.type === 'file');
  });
  if (!hasFile) return {};
  return {
    plugins: [
      {
        id: 'file-parser',
        pdf: {
          engine: process.env.OPENROUTER_MULTIMODAL_PDF_ENGINE || 'cloudflare-ai',
        },
      },
    ],
  };
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function text(res: http.ServerResponse, status: number, body: string) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function html(res: http.ServerResponse, status: number, body: string) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req: http.IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    let raw = '';
    const maxBodyBytes = readMaxBodyBytes();
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > maxBodyBytes) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function readMaxBodyBytes() {
  const value = Number(process.env.PERSONAL_AGENT_SERVER_MAX_BODY_BYTES || '');
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 80 * 1024 * 1024;
}
