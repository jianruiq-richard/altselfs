import http from 'node:http';
import path from 'node:path';
import { BoundedSerialTaskQueue, QueueFullError } from './bounded-task-queue.js';
import { createProvider, queryPaymentDestinations, type ServiceConfig } from './service.js';

const config = loadConfig();
const provider = createProvider(config);
const port = readPositiveInt('PORT', 8791);
const serviceToken = process.env.SEMRUSH_SERVICE_TOKEN?.trim();
const queryQueue = new BoundedSerialTaskQueue(readNonNegativeInt('SEMRUSH_QUEUE_MAX_WAITING', 3));

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return json(res, 200, {
        ok: true,
        providerMode: config.providerMode,
        apiConfigured: Boolean(config.apiKey),
        browserProfileConfigured: Boolean(config.browser.userDataDir),
        queue: queryQueue.snapshot(),
      });
    }
    if (req.method === 'POST' && url.pathname === '/v1/payment-destinations') {
      if (serviceToken && bearerToken(req) !== serviceToken) return json(res, 403, { error: 'Forbidden' });
      const body = await readJsonBody(req);
      const result = await queryQueue.enqueue(() => queryPaymentDestinations(provider, body));
      return json(res, 200, result);
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    if (error instanceof QueueFullError) {
      return json(res, 429, {
        error: 'Semrush query queue is full',
        code: error.code,
        queue: error.queue,
      }, { 'retry-after': '60' });
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = /required|must be|valid hostname|country/i.test(message) ? 400 : 502;
    return json(res, status, { error: message });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(
    `[semrush-traffic] listening on :${port} using ${config.providerMode} mode; maxWaiting=${queryQueue.maxWaiting}`,
  );
});

function loadConfig(): ServiceConfig {
  const providerValue = (process.env.SEMRUSH_PROVIDER || 'auto').trim().toLowerCase();
  const providerMode = providerValue === 'api' || providerValue === 'browser' ? providerValue : 'auto';
  const browserConnectionValue = (process.env.SEMRUSH_BROWSER_CONNECTION || 'cdp').trim().toLowerCase();
  const connectionMode = browserConnectionValue === 'launch' ? 'launch' : 'cdp';
  return {
    providerMode,
    apiKey: process.env.SEMRUSH_TRENDS_API_KEY?.trim() || undefined,
    browser: {
      reportUrl: process.env.SEMRUSH_BROWSER_REPORT_URL?.trim()
        || 'https://sem.3ue.com/analytics/traffic/sources-destinations',
      dashboardUrl: process.env.SEMRUSH_BROWSER_DASHBOARD_URL?.trim()
        || 'https://dash.3ue.com/zh-Hans/#/page/m/home',
      userDataDir: path.resolve(process.env.SEMRUSH_BROWSER_PROFILE_DIR?.trim() || '/data/semrush-browser-profile'),
      connectionMode,
      cdpEndpoint: process.env.SEMRUSH_BROWSER_CDP_ENDPOINT?.trim() || 'http://127.0.0.1:9222',
      channel: process.env.SEMRUSH_BROWSER_CHANNEL?.trim() || undefined,
      headless: readBool('SEMRUSH_BROWSER_HEADLESS', true),
      manageSelectedDomains: readBool('SEMRUSH_BROWSER_MANAGE_FILTERS', false),
      timeoutMs: readPositiveInt('SEMRUSH_BROWSER_TIMEOUT_MS', 90_000),
      artifactDir: path.resolve(process.env.SEMRUSH_BROWSER_ARTIFACT_DIR?.trim() || '/data/semrush-browser-artifacts'),
    },
  };
}

function readBool(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function readPositiveInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function readNonNegativeInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function bearerToken(req: http.IncomingMessage) {
  const header = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  return header?.match(/^Bearer\s+(.+)$/i)?.[1];
}

async function readJsonBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const value = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(value),
    ...extraHeaders,
  });
  res.end(value);
}
