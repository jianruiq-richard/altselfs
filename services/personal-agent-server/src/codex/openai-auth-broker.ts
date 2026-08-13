import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProxyAgent } from 'undici';
import type { CodexJsonRpcClient } from './json-rpc-client.js';

const DEFAULT_REFRESH_URL = 'https://auth.openai.com/oauth/token';
const DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEFAULT_REFRESH_DEADLINE_MS = 8_500;
const DEFAULT_REFRESH_EARLY_MS = 5 * 60_000;
const DEFAULT_STALE_LOCK_MS = 30_000;
const DEFAULT_LOCK_POLL_MS = 50;

type AuthFile = Record<string, unknown> & {
  tokens?: Record<string, unknown>;
};

type RefreshTokenResponse = {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
};

export type BrokeredOpenAiAuth = {
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType?: string;
};

export type OpenAiRefreshRequest = {
  url: string;
  clientId: string;
  refreshToken: string;
  proxyUrl?: string;
  timeoutMs: number;
};

export type OpenAiAuthBrokerOptions = {
  sourcePath: string;
  proxyUrl?: string;
  refreshUrl?: string;
  clientId?: string;
  refreshDeadlineMs?: number;
  refreshEarlyMs?: number;
  staleLockMs?: number;
  lockPollMs?: number;
  now?: () => number;
  refreshRequest?: (input: OpenAiRefreshRequest) => Promise<RefreshTokenResponse>;
};

/**
 * Owns the shared ChatGPT OAuth refresh token while Codex app-server instances
 * receive only short-lived access tokens through the external-auth protocol.
 */
export class OpenAiAuthBroker {
  private readonly sourcePath: string;
  private readonly proxyUrl?: string;
  private readonly refreshUrl: string;
  private readonly clientId: string;
  private readonly refreshDeadlineMs: number;
  private readonly refreshEarlyMs: number;
  private readonly staleLockMs: number;
  private readonly lockPollMs: number;
  private readonly now: () => number;
  private readonly refreshRequest: (input: OpenAiRefreshRequest) => Promise<RefreshTokenResponse>;

  constructor(options: OpenAiAuthBrokerOptions) {
    if (!options.sourcePath.trim()) throw new Error('CODEX_OPENAI_AUTH_JSON_PATH is not configured.');
    this.sourcePath = path.resolve(options.sourcePath);
    this.proxyUrl = options.proxyUrl?.trim() || undefined;
    this.refreshUrl = options.refreshUrl?.trim()
      || process.env.CODEX_REFRESH_TOKEN_URL_OVERRIDE?.trim()
      || DEFAULT_REFRESH_URL;
    this.clientId = options.clientId?.trim()
      || process.env.CODEX_APP_SERVER_LOGIN_CLIENT_ID?.trim()
      || DEFAULT_CLIENT_ID;
    this.refreshDeadlineMs = Math.max(1_000, options.refreshDeadlineMs ?? DEFAULT_REFRESH_DEADLINE_MS);
    this.refreshEarlyMs = Math.max(0, options.refreshEarlyMs ?? DEFAULT_REFRESH_EARLY_MS);
    this.staleLockMs = Math.max(this.refreshDeadlineMs + 1_000, options.staleLockMs ?? DEFAULT_STALE_LOCK_MS);
    this.lockPollMs = Math.max(10, options.lockPollMs ?? DEFAULT_LOCK_POLL_MS);
    this.now = options.now || Date.now;
    this.refreshRequest = options.refreshRequest || requestOpenAiTokenRefresh;
  }

  async getAuth(): Promise<BrokeredOpenAiAuth> {
    const authFile = await readAuthFile(this.sourcePath);
    const snapshot = parseBrokeredAuth(authFile);
    if (!accessTokenNeedsRefresh(snapshot.accessToken, this.now(), this.refreshEarlyMs)) return snapshot;
    return this.refreshSharedAuth(snapshot.accessToken, false);
  }

  async refreshAfterUnauthorized(failedAccessToken: string): Promise<BrokeredOpenAiAuth> {
    if (!failedAccessToken.trim()) throw new Error('Codex OpenAI auth refresh was requested without an access token.');
    return this.refreshSharedAuth(failedAccessToken, true);
  }

  private async refreshSharedAuth(observedAccessToken: string, requireChangedToken: boolean) {
    const deadlineAtMs = this.now() + this.refreshDeadlineMs;
    const releaseLock = await acquireRefreshLock(`${this.sourcePath}.refresh.lock`, {
      deadlineAtMs,
      staleLockMs: this.staleLockMs,
      pollMs: this.lockPollMs,
      now: this.now,
    });

    try {
      const latestFile = await readAuthFile(this.sourcePath);
      const latest = parseBrokeredAuth(latestFile);
      if (latest.accessToken !== observedAccessToken) return latest;
      if (!requireChangedToken && !accessTokenNeedsRefresh(latest.accessToken, this.now(), this.refreshEarlyMs)) {
        return latest;
      }

      const refreshToken = readRequiredString(latestFile.tokens, 'refresh_token', 'refresh token');
      const timeoutMs = deadlineAtMs - this.now();
      if (timeoutMs < 250) throw new Error('Timed out waiting for Codex OpenAI auth refresh lock.');

      const refreshed = await this.refreshRequest({
        url: this.refreshUrl,
        clientId: this.clientId,
        refreshToken,
        proxyUrl: this.proxyUrl,
        timeoutMs,
      });
      const nextAccessToken = refreshed.access_token?.trim() || latest.accessToken;
      if (requireChangedToken && nextAccessToken === observedAccessToken) {
        throw new Error('Codex OpenAI auth refresh returned the same access token after an unauthorized response.');
      }

      const currentTokens = isRecord(latestFile.tokens) ? latestFile.tokens : {};
      const nextFile: AuthFile = {
        ...latestFile,
        tokens: {
          ...currentTokens,
          id_token: refreshed.id_token?.trim() || currentTokens.id_token,
          access_token: nextAccessToken,
          refresh_token: refreshed.refresh_token?.trim() || refreshToken,
        },
        last_refresh: new Date(this.now()).toISOString(),
      };
      const next = parseBrokeredAuth(nextFile);
      await writeAuthFileAtomically(this.sourcePath, nextFile);
      return next;
    } finally {
      await releaseLock();
    }
  }
}

export class BrokeredOpenAiAuthSession {
  private current?: BrokeredOpenAiAuth;

  constructor(private readonly broker: OpenAiAuthBroker) {}

  async login(client: CodexJsonRpcClient) {
    this.current = await this.broker.getAuth();
    await client.request('account/login/start', loginParams(this.current), 10_000);
  }

  async handleServerRequest(client: CodexJsonRpcClient, request: Record<string, unknown>) {
    if (request.method !== 'account/chatgptAuthTokens/refresh') return false;
    const requestId = request.id;
    if (requestId === undefined || requestId === null) return true;

    try {
      if (!this.current) throw new Error('Codex OpenAI external auth session was not initialized.');
      this.current = await this.broker.refreshAfterUnauthorized(this.current.accessToken);
      client.respond(requestId, refreshResponse(this.current));
    } catch (error) {
      client.respondError(requestId, -32001, redactAuthError(error));
    }
    return true;
  }
}

function loginParams(auth: BrokeredOpenAiAuth) {
  return {
    type: 'chatgptAuthTokens',
    accessToken: auth.accessToken,
    chatgptAccountId: auth.chatgptAccountId,
    chatgptPlanType: auth.chatgptPlanType ?? null,
  };
}

function refreshResponse(auth: BrokeredOpenAiAuth) {
  return {
    accessToken: auth.accessToken,
    chatgptAccountId: auth.chatgptAccountId,
    chatgptPlanType: auth.chatgptPlanType ?? null,
  };
}

async function requestOpenAiTokenRefresh(input: OpenAiRefreshRequest): Promise<RefreshTokenResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, input.timeoutMs));
  const proxyAgent = input.proxyUrl ? new ProxyAgent(input.proxyUrl) : undefined;
  try {
    const init: RequestInit & { dispatcher?: ProxyAgent } = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: input.clientId,
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
      }),
      signal: controller.signal,
      ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
    };
    const response = await fetch(input.url, init);
    const text = await response.text();
    if (!response.ok) throw new Error(formatRefreshFailure(response.status, text));
    const parsed = parseJsonRecord(text, 'OpenAI OAuth refresh response');
    const result: RefreshTokenResponse = {
      id_token: readOptionalString(parsed.id_token),
      access_token: readOptionalString(parsed.access_token),
      refresh_token: readOptionalString(parsed.refresh_token),
    };
    if (!result.access_token) throw new Error('OpenAI OAuth refresh response did not include an access token.');
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Codex OpenAI auth refresh timed out after ${input.timeoutMs}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
    await proxyAgent?.close().catch(() => undefined);
  }
}

async function readAuthFile(sourcePath: string): Promise<AuthFile> {
  const text = await fs.readFile(sourcePath, 'utf8');
  const parsed = parseJsonRecord(text, 'Codex OpenAI auth file');
  if (!isRecord(parsed.tokens)) throw new Error('Codex OpenAI auth file is missing token data.');
  return parsed as AuthFile;
}

function parseBrokeredAuth(authFile: AuthFile): BrokeredOpenAiAuth {
  const tokens = authFile.tokens;
  const accessToken = readRequiredString(tokens, 'access_token', 'access token');
  const idToken = readOptionalString(tokens?.id_token);
  const accessClaims = parseJwtClaims(accessToken);
  const idClaims = parseJwtClaims(idToken);
  const accessAuthClaims = readOpenAiAuthClaims(accessClaims);
  const idAuthClaims = readOpenAiAuthClaims(idClaims);
  const chatgptAccountId = readOptionalString(tokens?.account_id)
    || readOptionalString(accessAuthClaims?.chatgpt_account_id)
    || readOptionalString(idAuthClaims?.chatgpt_account_id);
  if (!chatgptAccountId) throw new Error('Codex OpenAI auth file does not identify a ChatGPT account.');
  const chatgptPlanType = readOptionalString(accessAuthClaims?.chatgpt_plan_type)
    || readOptionalString(idAuthClaims?.chatgpt_plan_type);
  return { accessToken, chatgptAccountId, ...(chatgptPlanType ? { chatgptPlanType } : {}) };
}

function accessTokenNeedsRefresh(accessToken: string, nowMs: number, earlyMs: number) {
  const claims = parseJwtClaims(accessToken);
  const expSeconds = typeof claims?.exp === 'number' ? claims.exp : undefined;
  return expSeconds !== undefined && expSeconds * 1000 <= nowMs + earlyMs;
}

function parseJwtClaims(token?: string) {
  if (!token) return undefined;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readOpenAiAuthClaims(claims?: Record<string, unknown>) {
  const value = claims?.['https://api.openai.com/auth'];
  return isRecord(value) ? value : undefined;
}

async function writeAuthFileAtomically(sourcePath: string, value: AuthFile) {
  const tempPath = `${sourcePath}.tmp-${process.pid}-${randomUUID()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.chmod(tempPath, 0o600).catch(() => undefined);
    await fs.rename(tempPath, sourcePath);
    await fs.chmod(sourcePath, 0o600).catch(() => undefined);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function acquireRefreshLock(
  lockPath: string,
  input: { deadlineAtMs: number; staleLockMs: number; pollMs: number; now: () => number }
) {
  while (true) {
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(
        path.join(lockPath, 'owner.json'),
        `${JSON.stringify({ pid: process.pid, createdAt: new Date(input.now()).toISOString() })}\n`,
        { encoding: 'utf8', mode: 0o600 }
      ).catch(() => undefined);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await fs.rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      const stat = await fs.stat(lockPath).catch(() => undefined);
      if (stat && input.now() - stat.mtimeMs > input.staleLockMs) {
        await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      if (input.now() + input.pollMs >= input.deadlineAtMs) {
        throw new Error('Timed out waiting for Codex OpenAI auth refresh lock.');
      }
      await delay(input.pollMs);
    }
  }
}

function formatRefreshFailure(status: number, body: string) {
  const parsed = tryParseJsonRecord(body);
  const errorValue = parsed?.error;
  const errorObject = isRecord(errorValue) ? errorValue : undefined;
  const code = readOptionalString(errorObject?.code)
    || (typeof errorValue === 'string' ? errorValue : undefined)
    || readOptionalString(parsed?.code);
  const message = readOptionalString(errorObject?.message) || readOptionalString(parsed?.message);
  const normalizedCode = code?.toLowerCase();
  if (normalizedCode === 'refresh_token_expired') return 'Codex OpenAI refresh token expired. Please log out and sign in again.';
  if (normalizedCode === 'refresh_token_reused') return 'Codex OpenAI refresh token was already used. Please log out and sign in again.';
  if (normalizedCode === 'refresh_token_invalidated') return 'Codex OpenAI refresh token has been revoked. Please log out and sign in again.';
  const detail = [code, message].filter(Boolean).join(': ').slice(0, 500);
  return `OpenAI OAuth refresh failed with HTTP ${status}${detail ? ` (${detail})` : ''}.`;
}

function redactAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer REDACTED')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-REDACTED')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, 'JWT_REDACTED')
    .slice(0, 1_000);
}

function readRequiredString(record: Record<string, unknown> | undefined, key: string, label: string) {
  const value = readOptionalString(record?.[key]);
  if (!value) throw new Error(`Codex OpenAI auth file is missing its ${label}.`);
  return value;
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseJsonRecord(text: string, label: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) throw new Error('expected a JSON object');
    return parsed;
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function tryParseJsonRecord(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
