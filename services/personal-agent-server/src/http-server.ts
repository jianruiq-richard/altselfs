import http from 'node:http';
import { isRecord } from './util.js';
import type { PersonalMainAgent } from './main-agent.js';

export function createHttpServer(agent: PersonalMainAgent) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/v1/turns/start') {
        const body = await readJsonBody(req);
        if (!isRecord(body)) return json(res, 400, { error: 'JSON body must be an object' });
        const result = await agent.startTurn({
          userId: String(body.userId || ''),
          threadId: typeof body.threadId === 'string' ? body.threadId : undefined,
          message: String(body.message || ''),
          allowedAgents: Array.isArray(body.allowedAgents) ? body.allowedAgents.map(String) : undefined,
          metadata: isRecord(body.metadata) ? body.metadata : undefined,
        });
        if (url.searchParams.get('format') === 'text') {
          return text(res, 200, result.reply);
        }
        const includeEvents = body.includeEvents === true || url.searchParams.get('debug') === '1';
        return json(res, 200, includeEvents ? result : { ...result, events: [] });
      }

      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      return json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
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

function readJsonBody(req: http.IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
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
