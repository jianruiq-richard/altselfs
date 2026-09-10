import http from 'node:http';
import path from 'node:path';
import { BoundedSerialTaskQueue, QueueFullError } from './bounded-task-queue.js';
import { SemrushBrowserProvider } from './browser-provider.js';
import { startDispatcherServer } from './dispatcher.js';
import { bearerToken, json, readJsonBody } from './http-utils.js';
import { startPoolWorker } from './pool-worker.js';
import {
  DailyQuotaExhaustedError,
  DailyQuotaUnavailableError,
} from './quota.js';
import { createProvider, queryPaymentDestinations, type ServiceConfig } from './service.js';

const role = (process.env.SEMRUSH_ROLE || 'standalone').trim().toLowerCase();
const port = readPositiveInt('PORT', 8791);
const serviceToken = process.env.SEMRUSH_SERVICE_TOKEN?.trim();

if (role === 'dispatcher') {
  startDispatcherServer({
    port,
    serviceToken,
    heartbeatStaleMs: readPositiveInt('SEMRUSH_DISPATCH_HEARTBEAT_STALE_MS', 90_000),
    jobTimeoutMs: readPositiveInt('SEMRUSH_DISPATCH_JOB_TIMEOUT_MS', 900_000),
    maxQueued: readNonNegativeInt('SEMRUSH_DISPATCH_MAX_QUEUED', 30),
  });
} else {
  const config = loadConfig();
  const provider = createProvider(config);
  if (role === 'pool-worker') {
    if (!(provider instanceof SemrushBrowserProvider)) {
      throw new Error('SEMRUSH_ROLE=pool-worker requires SEMRUSH_PROVIDER=browser');
    }
    startPoolWorker({
      port,
      serviceToken,
      workerId: readRequiredEnv('SEMRUSH_WORKER_ID'),
      dispatcherUrl: readRequiredEnv('SEMRUSH_DISPATCHER_URL'),
      provider,
      config,
      maxWaiting: readNonNegativeInt('SEMRUSH_QUEUE_MAX_WAITING', 3),
      heartbeatMs: readPositiveInt('SEMRUSH_WORKER_HEARTBEAT_MS', 15_000),
      pollMs: readPositiveInt('SEMRUSH_WORKER_POLL_MS', 2_000),
      quotaRefreshMs: readPositiveInt('SEMRUSH_WORKER_QUOTA_REFRESH_MS', 300_000),
      version: process.env.SEMRUSH_WORKER_VERSION?.trim(),
    });
  } else if (role === 'standalone') {
    startStandaloneServer({ config, provider, port, serviceToken });
  } else {
    throw new Error(`Unsupported SEMRUSH_ROLE: ${role}`);
  }
}

function startStandaloneServer(input: {
  config: ServiceConfig;
  provider: ReturnType<typeof createProvider>;
  port: number;
  serviceToken?: string;
}) {
  const { config, provider, port, serviceToken } = input;
  const quotaProvider = provider instanceof SemrushBrowserProvider ? provider : undefined;
  const queryQueue = new BoundedSerialTaskQueue(readNonNegativeInt('SEMRUSH_QUEUE_MAX_WAITING', 3));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/healthz') {
        const quota = quotaProvider?.getDailyQuotaSnapshot();
        return json(res, 200, {
          ok: true,
          role: 'standalone',
          acceptingQueries: quota?.acceptingQueries ?? true,
          providerMode: config.providerMode,
          apiConfigured: Boolean(config.apiKey),
          browserProfileConfigured: Boolean(config.browser.userDataDir),
          queue: queryQueue.snapshot(),
          ...(quota ? { quota } : {}),
        });
      }
      if (req.method === 'GET' && url.pathname === '/v1/quota') {
        if (serviceToken && bearerToken(req) !== serviceToken) return json(res, 403, { error: 'Forbidden' });
        if (!quotaProvider) return json(res, 404, { error: 'Daily quota is unavailable for this provider mode' });
        const quota = await queryQueue.enqueue(() => quotaProvider.refreshDailyQuota());
        return json(res, 200, quota);
      }
      if (req.method === 'POST' && url.pathname === '/v1/payment-destinations') {
        if (serviceToken && bearerToken(req) !== serviceToken) return json(res, 403, { error: 'Forbidden' });
        const cachedQuota = quotaProvider?.getDailyQuotaSnapshot();
        if (cachedQuota?.status === 'exhausted') throw new DailyQuotaExhaustedError(cachedQuota);
        const body = await readJsonBody(req);
        const result = await queryQueue.enqueue(() => queryPaymentDestinations(provider, body));
        return json(res, 200, result);
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      if (error instanceof DailyQuotaExhaustedError) {
        return json(res, 429, { error: error.message, code: error.code, quota: error.quota });
      }
      if (error instanceof DailyQuotaUnavailableError) {
        return json(res, 503, { error: error.message, code: error.code, quota: error.quota });
      }
      if (error instanceof QueueFullError) {
        return json(res, 429, {
          error: 'Semrush query queue is full', code: error.code, queue: error.queue,
        }, { 'retry-after': '60' });
      }
      const message = error instanceof Error ? error.message : String(error);
      const status = /required|must be|valid hostname|country/i.test(message) ? 400 : 502;
      return json(res, status, { error: message });
    }
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`[semrush-traffic] listening on :${port} using ${config.providerMode} mode; maxWaiting=${queryQueue.maxWaiting}`);
    if (quotaProvider) {
      void quotaProvider.refreshDailyQuota().catch((error) => {
        console.warn(`[semrush-traffic] initial quota refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  });
  return server;
}

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
      pacing: {
        actionDelayMs: readNonNegativeInt('SEMRUSH_BROWSER_ACTION_DELAY_MS', 2_500),
        monthSwitchDelayMs: readNonNegativeInt('SEMRUSH_BROWSER_MONTH_SWITCH_DELAY_MS', 2_500),
        monthGapDelayMs: readNonNegativeInt('SEMRUSH_BROWSER_MONTH_GAP_DELAY_MS', 4_000),
        requestGapDelayMs: readNonNegativeInt('SEMRUSH_BROWSER_REQUEST_GAP_DELAY_MS', 6_000),
        retryDelayMs: readNonNegativeInt('SEMRUSH_BROWSER_RETRY_DELAY_MS', 12_000),
        rateLimitDelayMs: readNonNegativeInt('SEMRUSH_BROWSER_RATE_LIMIT_DELAY_MS', 35_000),
      },
      quotaGuard: {
        enabled: readBool('SEMRUSH_QUOTA_GUARD_ENABLED', true),
        stopAtUsedPercent: readPercentage('SEMRUSH_QUOTA_STOP_AT_USED_PERCENT', 100),
      },
    },
  };
}

function readPercentage(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : fallback;
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

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
