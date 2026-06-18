import http from 'node:http';
import { renderProductizationPage } from './productization-page.js';
import { isRecord } from './util.js';
export function createHttpServer(agent, config, memoryReviewQueue) {
    return http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            if (req.method === 'GET' && url.pathname === '/healthz') {
                return json(res, 200, { ok: true });
            }
            if (req.method === 'GET' && url.pathname === '/productization') {
                if (!config)
                    return json(res, 500, { error: 'config missing' });
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
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
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
                if (!config)
                    return json(res, 500, { error: 'proxy config missing' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                return openRouterResponsesProxy(res, config, body);
            }
            return json(res, 404, { error: 'Not found' });
        }
        catch (error) {
            return json(res, 500, {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
}
function streamTurnStart(res, agent, request) {
    let closed = false;
    const write = (payload) => {
        if (closed || res.destroyed)
            return;
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
        }
        catch (error) {
            write({
                type: 'error',
                error: error instanceof Error ? error.message : String(error),
            });
        }
        finally {
            clearInterval(heartbeat);
            if (!closed) {
                closed = true;
                res.end();
            }
        }
    })();
}
async function openRouterResponsesProxy(res, config, body) {
    const apiKey = process.env[config.openRouterApiKeyEnv]?.trim();
    if (!apiKey)
        return json(res, 500, { error: `${config.openRouterApiKeyEnv} is missing` });
    const model = typeof body.model === 'string' && body.model.trim()
        ? body.model.trim()
        : config.codexModel || config.hermesModel;
    const messages = responsesBodyToChatMessages(body);
    console.log(`[openrouter-responses-proxy] request model=${model} messages=${messages.length} inputChars=${messages
        .map((message) => message.content.length)
        .reduce((sum, length) => sum + length, 0)}`);
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
        const parsed = JSON.parse(raw);
        if (isRecord(parsed)) {
            const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
            const first = isRecord(choices[0]) ? choices[0] : {};
            const message = isRecord(first.message) ? first.message : {};
            text = extractOpenRouterMessageText(message.content);
            if (!text && typeof first.text === 'string')
                text = first.text;
        }
    }
    catch {
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
function extractOpenRouterMessageText(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    return content
        .map((part) => {
        if (typeof part === 'string')
            return part;
        if (!isRecord(part))
            return '';
        if (typeof part.text === 'string')
            return part.text;
        if (typeof part.content === 'string')
            return part.content;
        if (typeof part.output_text === 'string')
            return part.output_text;
        return '';
    })
        .filter(Boolean)
        .join('\n');
}
function responsesBodyToChatMessages(body) {
    const messages = [];
    if (typeof body.instructions === 'string' && body.instructions.trim()) {
        messages.push({ role: 'system', content: body.instructions });
    }
    const input = Array.isArray(body.input) ? body.input : [];
    for (const item of input) {
        if (!isRecord(item) || item.type !== 'message')
            continue;
        const role = item.role === 'assistant' ? 'assistant' : 'user';
        const content = Array.isArray(item.content)
            ? item.content
                .map((part) => {
                if (!isRecord(part))
                    return '';
                if (typeof part.text === 'string')
                    return part.text;
                if (typeof part.input_text === 'string')
                    return part.input_text;
                return '';
            })
                .filter(Boolean)
                .join('\n')
            : typeof item.content === 'string'
                ? item.content
                : '';
        if (content.trim())
            messages.push({ role, content });
    }
    if (messages.length === 0)
        messages.push({ role: 'user', content: 'Continue.' });
    return messages;
}
function json(res, status, body) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
}
function text(res, status, body) {
    res.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(body);
}
function html(res, status, body) {
    res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(body);
}
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > 2_000_000) {
                reject(new Error('request body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!raw.trim())
                return resolve(null);
            try {
                resolve(JSON.parse(raw));
            }
            catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}
