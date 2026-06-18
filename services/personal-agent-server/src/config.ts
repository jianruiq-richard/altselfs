import fs from 'node:fs';
import path from 'node:path';

export type ServerConfig = {
  port: number;
  env: string;
  hermesRouterEnabled: boolean;
  hermesModel: string;
  hermesOpenRouterApiKeyEnv: string;
  codexBin: string;
  codexHomeRoot: string;
  workspaceRoot: string;
  codexModel?: string;
  codexModelProvider?: string;
  openRouterBaseUrl: string;
  openRouterApiKeyEnv: string;
  openRouterAppTitle: string;
  codexWebSearchMode: 'live' | 'cached' | 'disabled';
  webSearchProvider: 'auto' | 'serpapi' | 'serper' | 'google_cse' | 'bing' | 'duckduckgo';
  serpApiKeyEnv: string;
  serperApiKeyEnv: string;
  googleCseApiKeyEnv: string;
  googleCseIdEnv: string;
  bingSearchApiKeyEnv: string;
  bingSearchEndpoint: string;
  disableLocalEnvironmentForGeneral: boolean;
  hermesSourceRuntimeEnabled: boolean;
  hermesSourceRoot: string;
  uvBin: string;
  hermesHomeRoot: string;
  hermesWorkspaceRoot: string;
  hermesMemoryNudgeInterval: number;
  hermesMaxTurns: number;
  hermesCodexResponsesProxyEnabled: boolean;
  hermesBackgroundReviewInline: boolean;
  memoryReviewMode: 'async' | 'inline' | 'disabled';
  memoryReviewJobStorePath: string;
  memoryReviewPollMs: number;
  memoryReviewMaxTurns: number;
  profileStorePath: string;
};

function readIntEnv(key: string, fallback: number) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function readEnv(key: string, fallback: string) {
  const raw = process.env[key]?.trim();
  return raw || fallback;
}

function readBoolEnv(key: string, fallback: boolean) {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function readWebSearchModeEnv(key: string, fallback: 'live' | 'cached' | 'disabled') {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === 'live' || raw === 'cached' || raw === 'disabled') return raw;
  return fallback;
}

function readWebSearchProviderEnv(key: string, fallback: ServerConfig['webSearchProvider']) {
  const raw = process.env[key]?.trim().toLowerCase();
  if (
    raw === 'auto' ||
    raw === 'serpapi' ||
    raw === 'serper' ||
    raw === 'google_cse' ||
    raw === 'bing' ||
    raw === 'duckduckgo'
  ) {
    return raw;
  }
  return fallback;
}

function readMemoryReviewModeEnv(key: string, fallback: ServerConfig['memoryReviewMode']) {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === 'async' || raw === 'inline' || raw === 'disabled') return raw;
  return fallback;
}

function loadLocalEnvFiles() {
  const merged: Record<string, string> = {};
  for (const file of findLocalEnvFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const index = line.indexOf('=');
      const key = line.slice(0, index).trim();
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;
      merged[key] = parseEnvValue(line.slice(index + 1).trim());
    }
  }
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
  }
}

function findLocalEnvFiles() {
  const dirs: string[] = [];
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs
    .reverse()
    .flatMap((dir) => ['.env', '.env.local'].map((file) => path.join(dir, file)))
    .filter((file) => fs.existsSync(file));
}

function parseEnvValue(value: string) {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) return value.slice(1, -1);
  const commentIndex = value.indexOf(' #');
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim();
}

export function loadConfig(): ServerConfig {
  loadLocalEnvFiles();
  return {
    port: readIntEnv('PORT', 8787),
    env: readEnv('ALTSELFS_AGENT_ENV', process.env.NODE_ENV || 'development'),
    hermesRouterEnabled: readBoolEnv('HERMES_ROUTER_ENABLED', true),
    hermesModel: readEnv('HERMES_MODEL', 'deepseek/deepseek-v3.2'),
    hermesOpenRouterApiKeyEnv: readEnv('HERMES_OPENROUTER_API_KEY_ENV', 'OPENROUTER_API_KEY'),
    codexBin: readEnv('CODEX_BIN', 'codex'),
    codexHomeRoot: path.resolve(readEnv('CODEX_HOME_ROOT', '/tmp/altselfs-codex-homes')),
    workspaceRoot: path.resolve(readEnv('WORKSPACE_ROOT', '/tmp/altselfs-workspaces')),
    codexModel: process.env.CODEX_MODEL?.trim() || undefined,
    codexModelProvider: process.env.CODEX_MODEL_PROVIDER?.trim() || undefined,
    openRouterBaseUrl: readEnv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
    openRouterApiKeyEnv: readEnv('OPENROUTER_API_KEY_ENV', 'OPENROUTER_API_KEY'),
    openRouterAppTitle: readEnv('OPENROUTER_APP_TITLE', 'Altselfs Personal Agent Server'),
    codexWebSearchMode: readWebSearchModeEnv('CODEX_WEB_SEARCH_MODE', 'live'),
    webSearchProvider: readWebSearchProviderEnv('WEB_SEARCH_PROVIDER', 'auto'),
    serpApiKeyEnv: readEnv('SERPAPI_API_KEY_ENV', 'SERPAPI_API_KEY'),
    serperApiKeyEnv: readEnv('SERPER_API_KEY_ENV', 'SERPER_API_KEY'),
    googleCseApiKeyEnv: readEnv('GOOGLE_CSE_API_KEY_ENV', 'GOOGLE_CSE_API_KEY'),
    googleCseIdEnv: readEnv('GOOGLE_CSE_ID_ENV', 'GOOGLE_CSE_ID'),
    bingSearchApiKeyEnv: readEnv('BING_SEARCH_API_KEY_ENV', 'BING_SEARCH_API_KEY'),
    bingSearchEndpoint: readEnv('BING_SEARCH_ENDPOINT', 'https://api.bing.microsoft.com/v7.0/search'),
    disableLocalEnvironmentForGeneral: readBoolEnv('CODEX_GENERAL_DISABLE_LOCAL_ENVIRONMENT', true),
    hermesSourceRuntimeEnabled: readBoolEnv('HERMES_SOURCE_RUNTIME_ENABLED', false),
    hermesSourceRoot: path.resolve(readEnv('HERMES_SOURCE_ROOT', '/Users/richardjian/work/agent-sources/hermes-agent')),
    uvBin: readEnv('UV_BIN', 'uv'),
    hermesHomeRoot: path.resolve(readEnv('HERMES_HOME_ROOT', '/tmp/altselfs-hermes-homes')),
    hermesWorkspaceRoot: path.resolve(readEnv('HERMES_WORKSPACE_ROOT', '/tmp/altselfs-hermes-workspaces')),
    hermesMemoryNudgeInterval: readIntEnv('HERMES_MEMORY_NUDGE_INTERVAL', 10),
    hermesMaxTurns: readIntEnv('HERMES_MAX_TURNS', 8),
    hermesCodexResponsesProxyEnabled: readBoolEnv('HERMES_CODEX_RESPONSES_PROXY_ENABLED', true),
    hermesBackgroundReviewInline: readBoolEnv('HERMES_BACKGROUND_REVIEW_INLINE', true),
    memoryReviewMode: readMemoryReviewModeEnv('MEMORY_REVIEW_MODE', 'async'),
    memoryReviewJobStorePath: path.resolve(readEnv('MEMORY_REVIEW_JOB_STORE_PATH', '/tmp/altselfs-memory-review-jobs.json')),
    memoryReviewPollMs: readIntEnv('MEMORY_REVIEW_POLL_MS', 1000),
    memoryReviewMaxTurns: readIntEnv('MEMORY_REVIEW_MAX_TURNS', 6),
    profileStorePath: path.resolve(readEnv('PROFILE_STORE_PATH', '/tmp/altselfs-personal-agent-profiles.json')),
  };
}
