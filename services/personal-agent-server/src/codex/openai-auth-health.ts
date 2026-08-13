import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerConfig } from '../config.js';
import { OpenAiAuthBroker } from './openai-auth-broker.js';

type CodexOpenAiAuthHealthStatus = 'healthy' | 'unhealthy' | 'skipped';

type CodexOpenAiAuthHealthCategory =
  | 'healthy'
  | 'disabled'
  | 'not_openai'
  | 'missing_auth_path'
  | 'missing_auth_file'
  | 'auth_lock_busy'
  | 'refresh_token_invalid'
  | 'network_or_provider'
  | 'codex_app_server'
  | 'unknown';

export type CodexOpenAiAuthHealthResult = {
  status: CodexOpenAiAuthHealthStatus;
  category: CodexOpenAiAuthHealthCategory;
  checkedAt: string;
  reason?: string;
  model?: string | null;
  provider?: string | null;
  authPath?: string;
  authMtimeMs?: number | null;
  authSize?: number | null;
  durationMs?: number;
  errorMessage?: string;
};

export class CodexOpenAiAuthHealthError extends Error {
  constructor(public result: CodexOpenAiAuthHealthResult) {
    super(formatCodexOpenAiAuthHealthError(result));
  }
}

type CodexOpenAiAuthHealthSelection = {
  model?: string;
  provider?: string;
};

type AuthFingerprint = {
  authPath: string;
  authMtimeMs: number | null;
  authSize: number | null;
};

const HEALTH_FILE_VERSION = 1;
const MIN_HEALTH_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 15 * 60_000;

let inFlightCheck: Promise<CodexOpenAiAuthHealthResult> | null = null;
let memoryHealth: CodexOpenAiAuthHealthResult | null = null;

export function shouldCheckCodexOpenAiAuth(
  config: ServerConfig,
  selection: CodexOpenAiAuthHealthSelection
) {
  if (!config.codexOpenAiAuthHealthCheckEnabled) return false;
  return normalizeProvider(selection.provider || config.codexModelProvider) === 'openai';
}

export async function ensureCodexOpenAiAuthHealthy(
  config: ServerConfig,
  selection: CodexOpenAiAuthHealthSelection,
  options: { reason?: string; force?: boolean } = {}
) {
  if (!shouldCheckCodexOpenAiAuth(config, selection)) {
    return skippedHealthResult(config, selection, options.reason, 'not_openai');
  }

  const sourcePath = config.codexOpenAiAuthJsonPath?.trim();
  if (!sourcePath) {
    const result = unhealthyResult(config, selection, options.reason, 'missing_auth_path', 'CODEX_OPENAI_AUTH_JSON_PATH is not configured.', {
      authPath: undefined,
      authMtimeMs: null,
      authSize: null,
    });
    throw new CodexOpenAiAuthHealthError(result);
  }

  const fingerprint = await readAuthFingerprint(sourcePath).catch((error) => ({
    authPath: path.resolve(sourcePath),
    authMtimeMs: null,
    authSize: null,
    errorMessage: error instanceof Error ? error.message : String(error),
  }));

  if ('errorMessage' in fingerprint) {
    const result = unhealthyResult(config, selection, options.reason, 'missing_auth_file', fingerprint.errorMessage, fingerprint);
    await writePersistedHealth(sourcePath, result).catch(() => undefined);
    throw new CodexOpenAiAuthHealthError(result);
  }

  const cached = await readBestCachedHealth(sourcePath);
  if (!options.force && cached && isReusableHealth(cached, fingerprint, healthCheckIntervalMs(config))) {
    if (cached.status === 'healthy') return cached;
    throw new CodexOpenAiAuthHealthError(cached);
  }

  if (inFlightCheck && !options.force) {
    const result = await inFlightCheck;
    if (result.status === 'healthy') return result;
    throw new CodexOpenAiAuthHealthError(result);
  }

  const checkPromise = runAndPersistCodexOpenAiAuthSmokeCheck(config, selection, {
    reason: options.reason,
    fingerprint,
    staleHealthyResult: cached?.status === 'healthy' && sameFingerprint(cached, fingerprint) ? cached : null,
  }).finally(() => {
    inFlightCheck = null;
  });
  inFlightCheck = checkPromise;

  const result = await checkPromise;
  if (result.status === 'healthy') return result;
  throw new CodexOpenAiAuthHealthError(result);
}

export async function markCodexOpenAiAuthUnhealthyFromError(
  config: ServerConfig,
  selection: CodexOpenAiAuthHealthSelection,
  error: unknown,
  options: { reason?: string } = {}
) {
  if (!shouldCheckCodexOpenAiAuth(config, selection) || !isCodexOpenAiAuthFailure(error)) return null;
  const sourcePath = config.codexOpenAiAuthJsonPath?.trim();
  if (!sourcePath) return null;
  const fingerprint = await readAuthFingerprint(sourcePath).catch(() => ({
    authPath: path.resolve(sourcePath),
    authMtimeMs: null,
    authSize: null,
  }));
  const result = unhealthyResult(
    config,
    selection,
    options.reason,
    classifyCodexOpenAiAuthError(error),
    redactErrorMessage(error),
    fingerprint
  );
  memoryHealth = result;
  await writePersistedHealth(sourcePath, result).catch(() => undefined);
  return result;
}

export function isCodexOpenAiAuthFailure(error: unknown) {
  const message = stringifyError(error).toLowerCase();
  return (
    message.includes('access token could not be refreshed') ||
    message.includes('refresh token was already used') ||
    message.includes('refresh token has been revoked') ||
    message.includes('refresh token expired') ||
    message.includes('invalid_grant') ||
    message.includes('please log out and sign in again')
  );
}

export function formatCodexOpenAiAuthHealthError(result: CodexOpenAiAuthHealthResult) {
  const base =
    result.category === 'refresh_token_invalid'
      ? 'Platform Codex OpenAI auth is unhealthy: refresh token is invalid or already used.'
      : result.category === 'missing_auth_path'
        ? 'Platform Codex OpenAI auth is unhealthy: CODEX_OPENAI_AUTH_JSON_PATH is not configured.'
        : result.category === 'missing_auth_file'
          ? 'Platform Codex OpenAI auth is unhealthy: auth file is missing or unreadable.'
          : result.category === 'auth_lock_busy'
            ? 'Platform Codex OpenAI auth health check could not run because another Codex auth operation is in progress.'
            : 'Platform Codex OpenAI auth health check failed.';
  const detail = result.errorMessage ? ` Detail: ${result.errorMessage}` : '';
  return `${base} Administrator must refresh CODEX_OPENAI_AUTH_JSON_PATH; no fallback was used.${detail}`;
}

async function runAndPersistCodexOpenAiAuthSmokeCheck(
  config: ServerConfig,
  selection: CodexOpenAiAuthHealthSelection,
  input: {
    reason?: string;
    fingerprint: AuthFingerprint;
    staleHealthyResult: CodexOpenAiAuthHealthResult | null;
  }
) {
  const startedAtMs = Date.now();
  try {
    const result = await runCodexOpenAiAuthSmokeCheck(config, selection, input.reason);
    memoryHealth = result;
    await writePersistedHealth(input.fingerprint.authPath, result).catch(() => undefined);
    return result;
  } catch (error) {
    const category = classifyCodexOpenAiAuthError(error);
    if (category === 'auth_lock_busy' && input.staleHealthyResult) {
      return input.staleHealthyResult;
    }
    const result = unhealthyResult(
      config,
      selection,
      input.reason,
      category,
      redactErrorMessage(error),
      input.fingerprint,
      Date.now() - startedAtMs
    );
    memoryHealth = result;
    if (category !== 'auth_lock_busy') {
      await writePersistedHealth(input.fingerprint.authPath, result).catch(() => undefined);
    }
    return result;
  }
}

async function runCodexOpenAiAuthSmokeCheck(
  config: ServerConfig,
  selection: CodexOpenAiAuthHealthSelection,
  reason?: string
) {
  const sourcePath = config.codexOpenAiAuthJsonPath;
  if (!sourcePath) {
    throw new Error('CODEX_OPENAI_AUTH_JSON_PATH is not configured.');
  }

  const startedAtMs = Date.now();
  const model = selection.model || config.codexModel || 'gpt-5.5';
  const broker = new OpenAiAuthBroker({
    sourcePath,
    proxyUrl: config.codexOpenAiProxyUrl,
  });
  await broker.getAuth();
  const fingerprint = await readAuthFingerprint(sourcePath);
  return {
    status: 'healthy' as const,
    category: 'healthy' as const,
    checkedAt: new Date().toISOString(),
    reason,
    model,
    provider: 'openai',
    authPath: fingerprint.authPath,
    authMtimeMs: fingerprint.authMtimeMs,
    authSize: fingerprint.authSize,
    durationMs: Date.now() - startedAtMs,
  };
}

function skippedHealthResult(
  config: ServerConfig,
  selection: CodexOpenAiAuthHealthSelection,
  reason: string | undefined,
  category: CodexOpenAiAuthHealthCategory
): CodexOpenAiAuthHealthResult {
  return {
    status: 'skipped',
    category: config.codexOpenAiAuthHealthCheckEnabled ? category : 'disabled',
    checkedAt: new Date().toISOString(),
    reason,
    model: selection.model || config.codexModel || null,
    provider: selection.provider || config.codexModelProvider || null,
  };
}

function unhealthyResult(
  config: ServerConfig,
  selection: CodexOpenAiAuthHealthSelection,
  reason: string | undefined,
  category: CodexOpenAiAuthHealthCategory,
  errorMessage: string,
  fingerprint: Partial<AuthFingerprint>,
  durationMs?: number
): CodexOpenAiAuthHealthResult {
  return {
    status: 'unhealthy',
    category,
    checkedAt: new Date().toISOString(),
    reason,
    model: selection.model || config.codexModel || null,
    provider: selection.provider || config.codexModelProvider || null,
    authPath: fingerprint.authPath,
    authMtimeMs: fingerprint.authMtimeMs ?? null,
    authSize: fingerprint.authSize ?? null,
    durationMs,
    errorMessage,
  };
}

async function readBestCachedHealth(sourcePath: string) {
  const persisted = await readPersistedHealth(sourcePath).catch(() => null);
  if (!memoryHealth) return persisted;
  if (!persisted) return memoryHealth;
  return Date.parse(memoryHealth.checkedAt) >= Date.parse(persisted.checkedAt)
    ? memoryHealth
    : persisted;
}

async function readPersistedHealth(sourcePath: string): Promise<CodexOpenAiAuthHealthResult | null> {
  const text = await fs.readFile(healthPath(sourcePath), 'utf8').catch((error) => {
    if (isNodeError(error) && error.code === 'ENOENT') return '';
    throw error;
  });
  if (!text) return null;
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || parsed.version !== HEALTH_FILE_VERSION || !isRecord(parsed.health)) return null;
  const health = parsed.health;
  const status = typeof health.status === 'string' ? health.status : '';
  const category = typeof health.category === 'string' ? health.category : '';
  const checkedAt = typeof health.checkedAt === 'string' ? health.checkedAt : '';
  if (!checkedAt || (status !== 'healthy' && status !== 'unhealthy' && status !== 'skipped')) return null;
  return {
    status,
    category: normalizeCategory(category),
    checkedAt,
    reason: typeof health.reason === 'string' ? health.reason : undefined,
    model: typeof health.model === 'string' ? health.model : null,
    provider: typeof health.provider === 'string' ? health.provider : null,
    authPath: typeof health.authPath === 'string' ? health.authPath : undefined,
    authMtimeMs: typeof health.authMtimeMs === 'number' ? health.authMtimeMs : null,
    authSize: typeof health.authSize === 'number' ? health.authSize : null,
    durationMs: typeof health.durationMs === 'number' ? health.durationMs : undefined,
    errorMessage: typeof health.errorMessage === 'string' ? health.errorMessage : undefined,
  };
}

async function writePersistedHealth(sourcePath: string, health: CodexOpenAiAuthHealthResult) {
  const targetPath = healthPath(sourcePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(
    tempPath,
    `${JSON.stringify({ version: HEALTH_FILE_VERSION, health }, null, 2)}\n`,
    'utf8'
  );
  await fs.chmod(tempPath, 0o600).catch(() => undefined);
  await fs.rename(tempPath, targetPath);
  await fs.chmod(targetPath, 0o600).catch(() => undefined);
}

async function readAuthFingerprint(sourcePath: string): Promise<AuthFingerprint> {
  const authPath = path.resolve(sourcePath);
  const stat = await fs.stat(authPath);
  return {
    authPath,
    authMtimeMs: stat.mtimeMs,
    authSize: stat.size,
  };
}

function isReusableHealth(
  health: CodexOpenAiAuthHealthResult | null,
  fingerprint: AuthFingerprint,
  intervalMs: number
) {
  if (!health) return false;
  if (!sameFingerprint(health, fingerprint)) return false;
  const checkedAtMs = Date.parse(health.checkedAt);
  if (!Number.isFinite(checkedAtMs)) return false;
  return Date.now() - checkedAtMs < intervalMs;
}

function sameFingerprint(health: CodexOpenAiAuthHealthResult, fingerprint: AuthFingerprint) {
  return (
    health.authPath === fingerprint.authPath &&
    health.authMtimeMs === fingerprint.authMtimeMs &&
    health.authSize === fingerprint.authSize
  );
}

function healthPath(sourcePath: string) {
  return `${path.resolve(sourcePath)}.health.json`;
}

function healthCheckIntervalMs(config: ServerConfig) {
  return Math.max(
    MIN_HEALTH_CHECK_INTERVAL_MS,
    config.codexOpenAiAuthHealthCheckIntervalMs || DEFAULT_HEALTH_CHECK_INTERVAL_MS
  );
}

function classifyCodexOpenAiAuthError(error: unknown): CodexOpenAiAuthHealthCategory {
  const message = stringifyError(error).toLowerCase();
  if (message.includes('timed out waiting for codex openai auth refresh lock')) return 'auth_lock_busy';
  if (isCodexOpenAiAuthFailure(error)) return 'refresh_token_invalid';
  if (
    message.includes('network') ||
    message.includes('proxy') ||
    message.includes('econn') ||
    message.includes('etimedout') ||
    message.includes('timeout') ||
    message.includes('dns')
  ) return 'network_or_provider';
  if (message.includes('codex app-server') || message.includes('thread/start') || message.includes('turn/start')) {
    return 'codex_app_server';
  }
  return 'unknown';
}

function normalizeCategory(value: string): CodexOpenAiAuthHealthCategory {
  const allowed = new Set<CodexOpenAiAuthHealthCategory>([
    'healthy',
    'disabled',
    'not_openai',
    'missing_auth_path',
    'missing_auth_file',
    'auth_lock_busy',
    'refresh_token_invalid',
    'network_or_provider',
    'codex_app_server',
    'unknown',
  ]);
  return allowed.has(value as CodexOpenAiAuthHealthCategory)
    ? value as CodexOpenAiAuthHealthCategory
    : 'unknown';
}

function redactErrorMessage(error: unknown) {
  return stringifyError(error)
    .replace(/Bearer\s+\S+/gi, 'Bearer REDACTED')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-REDACTED')
    .replace(/"access_token"\s*:\s*"[^"]+"/gi, '"access_token":"REDACTED"')
    .replace(/"refresh_token"\s*:\s*"[^"]+"/gi, '"refresh_token":"REDACTED"')
    .slice(0, 2000);
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizeProvider(value?: string) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'openrouter') return normalized;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
