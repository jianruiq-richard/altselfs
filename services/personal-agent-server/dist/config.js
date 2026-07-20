import fs from 'node:fs';
import path from 'node:path';
const BUILTIN_CODEX_MODEL_METADATA = {
    'deepseek/deepseek-v3.2': {
        contextWindow: 128000,
        autoCompactTokenLimit: 64000,
        toolOutputTokenLimit: 12000,
    },
    'qwen/qwen3.6-flash': {
        contextWindow: 1000000,
        autoCompactTokenLimit: 500000,
        toolOutputTokenLimit: 12000,
        inputModalities: ['text', 'image'],
    },
};
function readIntEnv(key, fallback) {
    const raw = process.env[key];
    if (!raw)
        return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}
function readOptionalIntEnv(key) {
    const raw = process.env[key];
    if (!raw)
        return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}
function readEnv(key, fallback) {
    const raw = process.env[key]?.trim();
    return raw || fallback;
}
function readBoolEnv(key, fallback) {
    const raw = process.env[key]?.trim().toLowerCase();
    if (!raw)
        return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw);
}
function readCsvEnv(key, fallback = []) {
    const raw = process.env[key]?.trim();
    if (!raw)
        return fallback;
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
function readWebSearchModeEnv(key, fallback) {
    const raw = process.env[key]?.trim().toLowerCase();
    if (raw === 'live' || raw === 'cached' || raw === 'disabled')
        return raw;
    return fallback;
}
function readReasoningSummaryEnv(key) {
    const raw = process.env[key]?.trim().toLowerCase();
    if (raw === 'auto' || raw === 'concise' || raw === 'detailed' || raw === 'none')
        return raw;
    return undefined;
}
function readVerbosityEnv(key) {
    const raw = process.env[key]?.trim().toLowerCase();
    if (raw === 'low' || raw === 'medium' || raw === 'high')
        return raw;
    return undefined;
}
function readWebSearchProviderEnv(key, fallback) {
    const raw = process.env[key]?.trim().toLowerCase();
    if (raw === 'auto' ||
        raw === 'serpapi' ||
        raw === 'serper' ||
        raw === 'google_cse' ||
        raw === 'bing' ||
        raw === 'duckduckgo') {
        return raw;
    }
    return fallback;
}
function readMemoryReviewModeEnv(key, fallback) {
    const raw = process.env[key]?.trim().toLowerCase();
    if (raw === 'async' || raw === 'inline' || raw === 'disabled')
        return raw;
    return fallback;
}
function readProcessRoleEnv(key, fallback) {
    const raw = process.env[key]?.trim().toLowerCase();
    if (raw === 'api' || raw === 'worker' || raw === 'all')
        return raw;
    return fallback;
}
function readStorageBackendEnv(key, fallback) {
    const raw = process.env[key]?.trim().toLowerCase();
    if (raw === 'file' || raw === 'postgres')
        return raw;
    return fallback;
}
function readRuntimeStateModeEnv(key, fallback) {
    const raw = process.env[key]?.trim().toLowerCase();
    if (raw === 'ephemeral' || raw === 'snapshot' || raw === 'sandbox')
        return raw;
    return fallback;
}
function loadLocalEnvFiles() {
    const merged = {};
    for (const file of findLocalEnvFiles()) {
        const text = fs.readFileSync(file, 'utf8');
        for (const rawLine of text.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#') || !line.includes('='))
                continue;
            const index = line.indexOf('=');
            const key = line.slice(0, index).trim();
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key))
                continue;
            merged[key] = parseEnvValue(line.slice(index + 1).trim());
        }
    }
    for (const [key, value] of Object.entries(merged)) {
        if (process.env[key] === undefined || process.env[key] === '')
            process.env[key] = value;
    }
}
function findLocalEnvFiles() {
    const dirs = [];
    let current = process.cwd();
    for (let depth = 0; depth < 6; depth += 1) {
        dirs.push(current);
        const parent = path.dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return dirs
        .reverse()
        .flatMap((dir) => ['.env', '.env.local'].map((file) => path.join(dir, file)))
        .filter((file) => fs.existsSync(file));
}
function parseEnvValue(value) {
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote))
        return value.slice(1, -1);
    const commentIndex = value.indexOf(' #');
    return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim();
}
function readCodexModelCatalog(activeModel) {
    const catalog = {
        defaultMetadata: {},
        models: { ...BUILTIN_CODEX_MODEL_METADATA },
    };
    mergeCodexModelCatalog(catalog, readCodexModelCatalogFile());
    mergeCodexModelCatalog(catalog, parseJsonEnv('CODEX_MODEL_METADATA_JSON'));
    const envMetadata = normalizeCodexModelMetadata({
        contextWindow: readOptionalIntEnv('CODEX_MODEL_CONTEXT_WINDOW'),
        autoCompactTokenLimit: readOptionalIntEnv('CODEX_MODEL_AUTO_COMPACT_TOKEN_LIMIT'),
        toolOutputTokenLimit: readOptionalIntEnv('CODEX_TOOL_OUTPUT_TOKEN_LIMIT'),
        reasoningSummary: readReasoningSummaryEnv('CODEX_MODEL_REASONING_SUMMARY'),
        verbosity: readVerbosityEnv('CODEX_MODEL_VERBOSITY'),
        supportsReasoningSummaries: readOptionalBoolEnv('CODEX_MODEL_SUPPORTS_REASONING_SUMMARIES'),
    });
    if (activeModel && Object.keys(envMetadata).length > 0) {
        catalog.models[activeModel] = {
            ...(catalog.models[activeModel] || {}),
            ...envMetadata,
        };
    }
    return catalog;
}
function readCodexModelCatalogFile() {
    const file = process.env.CODEX_MODEL_METADATA_PATH?.trim();
    if (!file)
        return null;
    try {
        return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    }
    catch (error) {
        console.warn(`[config] failed to read CODEX_MODEL_METADATA_PATH=${file}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
function parseJsonEnv(key) {
    const raw = process.env[key]?.trim();
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch (error) {
        console.warn(`[config] failed to parse ${key}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
function mergeCodexModelCatalog(catalog, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return;
    const record = value;
    const defaults = normalizeCodexModelMetadata(record.defaults || record.defaultMetadata);
    catalog.defaultMetadata = { ...catalog.defaultMetadata, ...defaults };
    const rawModels = record.models && typeof record.models === 'object' && !Array.isArray(record.models)
        ? record.models
        : record;
    for (const [model, metadata] of Object.entries(rawModels)) {
        if (model === 'defaults' || model === 'defaultMetadata' || model === 'models')
            continue;
        const normalized = normalizeCodexModelMetadata(metadata);
        if (Object.keys(normalized).length === 0)
            continue;
        catalog.models[model] = { ...(catalog.models[model] || {}), ...normalized };
    }
}
function normalizeCodexModelMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const record = value;
    const metadata = {};
    const contextWindow = readMetadataNumber(record.contextWindow ?? record.model_context_window);
    const autoCompactTokenLimit = readMetadataNumber(record.autoCompactTokenLimit ?? record.model_auto_compact_token_limit);
    const toolOutputTokenLimit = readMetadataNumber(record.toolOutputTokenLimit ?? record.tool_output_token_limit);
    const reasoningSummary = readMetadataString(record.reasoningSummary ?? record.model_reasoning_summary);
    const verbosity = readMetadataString(record.verbosity ?? record.model_verbosity);
    const supportsReasoningSummaries = readMetadataBool(record.supportsReasoningSummaries ?? record.model_supports_reasoning_summaries);
    const inputModalities = readMetadataStringArray(record.inputModalities ?? record.input_modalities);
    if (contextWindow)
        metadata.contextWindow = contextWindow;
    if (autoCompactTokenLimit)
        metadata.autoCompactTokenLimit = autoCompactTokenLimit;
    if (toolOutputTokenLimit)
        metadata.toolOutputTokenLimit = toolOutputTokenLimit;
    if (reasoningSummary === 'auto' || reasoningSummary === 'concise' || reasoningSummary === 'detailed' || reasoningSummary === 'none') {
        metadata.reasoningSummary = reasoningSummary;
    }
    if (verbosity === 'low' || verbosity === 'medium' || verbosity === 'high')
        metadata.verbosity = verbosity;
    if (supportsReasoningSummaries !== undefined)
        metadata.supportsReasoningSummaries = supportsReasoningSummaries;
    if (inputModalities.length > 0)
        metadata.inputModalities = inputModalities;
    return metadata;
}
function readMetadataNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0)
        return Math.round(value);
    if (typeof value !== 'string' || !value.trim())
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}
function readMetadataString(value) {
    return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}
function readMetadataBool(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value !== 'string')
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized))
        return true;
    if (['0', 'false', 'no', 'off'].includes(normalized))
        return false;
    return undefined;
}
function readMetadataStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}
function readOptionalBoolEnv(key) {
    return readMetadataBool(process.env[key]);
}
export function loadConfig() {
    loadLocalEnvFiles();
    const storageBackend = readStorageBackendEnv('STORAGE_BACKEND', 'file');
    const hermesModel = readEnv('HERMES_MODEL', 'claude-sonnet-4-6');
    const hermesProvider = readEnv('HERMES_PROVIDER', 'apiyi');
    const hermesBaseUrl = readEnv('HERMES_BASE_URL', 'https://api.apiyi.com/v1');
    const hermesApiKeyEnv = readEnv('HERMES_API_KEY_ENV', 'APIYI_API_KEY');
    const openRouterApiKeyEnv = readEnv('OPENROUTER_API_KEY_ENV', 'OPENROUTER_API_KEY');
    const hasOpenRouterKey = Boolean(process.env[openRouterApiKeyEnv]?.trim());
    const codexModel = process.env.CODEX_MODEL?.trim() || 'gpt-5.5';
    const codexModelProvider = process.env.CODEX_MODEL_PROVIDER?.trim() || (codexModel === 'gpt-5.5' ? 'openai' : hasOpenRouterKey ? 'openrouter' : undefined);
    return {
        port: readIntEnv('PORT', 8787),
        env: readEnv('ALTSELFS_AGENT_ENV', process.env.NODE_ENV || 'development'),
        processRole: readProcessRoleEnv('AGENT_PROCESS_ROLE', 'all'),
        storageBackend,
        databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
        contextDatabaseUrl: process.env.AGENT_CONTEXT_DATABASE_URL?.trim() || undefined,
        hermesRouterEnabled: readBoolEnv('HERMES_ROUTER_ENABLED', true),
        hermesModel,
        hermesProvider,
        hermesBaseUrl,
        hermesApiKeyEnv,
        hermesOpenRouterApiKeyEnv: readEnv('HERMES_OPENROUTER_API_KEY_ENV', hermesApiKeyEnv),
        codexBin: readEnv('CODEX_BIN', 'codex'),
        codexHomeRoot: path.resolve(readEnv('CODEX_HOME_ROOT', '/tmp/altselfs-codex-homes')),
        workspaceRoot: path.resolve(readEnv('WORKSPACE_ROOT', '/tmp/altselfs-workspaces')),
        codexModel,
        codexModelProvider,
        codexOpenAiAuthJsonPath: process.env.CODEX_OPENAI_AUTH_JSON_PATH?.trim() || undefined,
        codexOpenAiProxyUrl: process.env.CODEX_OPENAI_PROXY_URL?.trim() || undefined,
        codexModelCatalog: readCodexModelCatalog(codexModel),
        openRouterBaseUrl: readEnv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
        openRouterApiKeyEnv,
        openRouterAppTitle: readEnv('OPENROUTER_APP_TITLE', 'Altselfs Personal Agent Server'),
        outboundProxyUrl: process.env.OUTBOUND_PROXY_URL?.trim() || undefined,
        outboundProxyBypassHosts: readCsvEnv('OUTBOUND_PROXY_BYPASS_HOSTS'),
        codexWebSearchMode: readWebSearchModeEnv('CODEX_WEB_SEARCH_MODE', 'live'),
        webSearchProvider: readWebSearchProviderEnv('WEB_SEARCH_PROVIDER', 'auto'),
        serpApiKeyEnv: readEnv('SERPAPI_API_KEY_ENV', 'SERPAPI_API_KEY'),
        serperApiKeyEnv: readEnv('SERPER_API_KEY_ENV', 'SERPER_API_KEY'),
        googleCseApiKeyEnv: readEnv('GOOGLE_CSE_API_KEY_ENV', 'GOOGLE_CSE_API_KEY'),
        googleCseIdEnv: readEnv('GOOGLE_CSE_ID_ENV', 'GOOGLE_CSE_ID'),
        bingSearchApiKeyEnv: readEnv('BING_SEARCH_API_KEY_ENV', 'BING_SEARCH_API_KEY'),
        bingSearchEndpoint: readEnv('BING_SEARCH_ENDPOINT', 'https://api.bing.microsoft.com/v7.0/search'),
        webSearchTimeoutMs: readIntEnv('WEB_SEARCH_TIMEOUT_MS', 30_000),
        rapidApiKeyEnv: readEnv('RAPIDAPI_KEY_ENV', 'RAPIDAPI_KEY'),
        rapidApiRequestTimeoutMs: readIntEnv('RAPIDAPI_REQUEST_TIMEOUT_MS', 30_000),
        larkCliBin: readEnv('LARK_CLI_BIN', 'lark-cli'),
        larkCliHomeRoot: path.resolve(readEnv('LARK_CLI_HOME_ROOT', '/data/altselfs-agent/lark-cli-runtime')),
        larkCliTimeoutMs: readIntEnv('LARK_CLI_TIMEOUT_MS', 60_000),
        larkCliProxyUrl: process.env.LARK_CLI_PROXY_URL?.trim() || undefined,
        feishuCliAuthDomains: readCsvEnv('FEISHU_CLI_AUTH_DOMAINS', []),
        feishuCliAuthExtraScopes: readCsvEnv('FEISHU_CLI_AUTH_EXTRA_SCOPES', []),
        feishuCliAuthExcludeScopes: readCsvEnv('FEISHU_CLI_AUTH_EXCLUDE_SCOPES', []),
        disableLocalEnvironmentForGeneral: readBoolEnv('CODEX_GENERAL_DISABLE_LOCAL_ENVIRONMENT', true),
        hermesSourceRuntimeEnabled: readBoolEnv('HERMES_SOURCE_RUNTIME_ENABLED', false),
        hermesSourceRoot: path.resolve(readEnv('HERMES_SOURCE_ROOT', '/Users/richardjian/work/agent-sources/hermes-agent')),
        uvBin: readEnv('UV_BIN', 'uv'),
        hermesHomeRoot: path.resolve(readEnv('HERMES_HOME_ROOT', '/tmp/altselfs-hermes-homes')),
        hermesWorkspaceRoot: path.resolve(readEnv('HERMES_WORKSPACE_ROOT', '/tmp/altselfs-hermes-workspaces')),
        hermesMemoryNudgeInterval: readIntEnv('HERMES_MEMORY_NUDGE_INTERVAL', 10),
        hermesMaxTurns: readIntEnv('HERMES_MAX_TURNS', 16),
        hermesSourceRuntimeTimeoutMs: readIntEnv('HERMES_SOURCE_RUNTIME_TIMEOUT_MS', 80 * 60 * 1000),
        hermesCodexResponsesProxyEnabled: readBoolEnv('HERMES_CODEX_RESPONSES_PROXY_ENABLED', true),
        hermesBackgroundReviewInline: readBoolEnv('HERMES_BACKGROUND_REVIEW_INLINE', true),
        memoryReviewMode: readMemoryReviewModeEnv('MEMORY_REVIEW_MODE', 'async'),
        memoryReviewJobStorePath: path.resolve(readEnv('MEMORY_REVIEW_JOB_STORE_PATH', '/tmp/altselfs-memory-review-jobs.json')),
        memoryReviewPollMs: readIntEnv('MEMORY_REVIEW_POLL_MS', 1000),
        memoryReviewMaxTurns: readIntEnv('MEMORY_REVIEW_MAX_TURNS', 6),
        turnQueuePollMs: readIntEnv('AGENT_TURN_QUEUE_POLL_MS', 1000),
        turnQueueMaxConcurrency: readIntEnv('AGENT_TURN_MAX_CONCURRENCY', 3),
        turnQueueMaxPerUser: readIntEnv('AGENT_TURN_MAX_PER_USER', 1),
        turnQueueMaxPerThread: readIntEnv('AGENT_TURN_MAX_PER_THREAD', 1),
        turnQueueMaxOpenAi: readIntEnv('AGENT_TURN_MAX_OPENAI', 1),
        turnQueueMaxOpenRouter: readIntEnv('AGENT_TURN_MAX_OPENROUTER', 2),
        turnQueueRunTimeoutMs: readIntEnv('AGENT_TURN_RUN_TIMEOUT_MS', 80 * 60 * 1000),
        turnQueueStaleHeartbeatMs: readIntEnv('AGENT_TURN_STALE_HEARTBEAT_MS', 90 * 1000),
        codexTurnTimeoutMs: readIntEnv('CODEX_TURN_TIMEOUT_MS', 80 * 60 * 1000),
        profileStorePath: path.resolve(readEnv('PROFILE_STORE_PATH', '/tmp/altselfs-personal-agent-profiles.json')),
        runtimeStateSyncEnabled: readBoolEnv('RUNTIME_STATE_SYNC_ENABLED', storageBackend === 'postgres'),
        runtimeStateMode: readRuntimeStateModeEnv('RUNTIME_STATE_MODE', 'ephemeral'),
        sandboxStorageRoot: path.resolve(readEnv('SANDBOX_STORAGE_ROOT', '/data/altselfs-agent')),
        sandboxExecEnabled: readBoolEnv('SANDBOX_EXEC_ENABLED', false),
        sandboxExecDockerSocketPath: readEnv('SANDBOX_DOCKER_SOCKET_PATH', '/var/run/docker.sock'),
        sandboxExecImage: readEnv('SANDBOX_EXEC_IMAGE', 'python:3.11-slim'),
        sandboxExecMemoryBytes: readIntEnv('SANDBOX_EXEC_MEMORY_BYTES', 512 * 1024 * 1024),
        sandboxExecNanoCpus: readIntEnv('SANDBOX_EXEC_NANO_CPUS', 1_000_000_000),
        sandboxExecPidsLimit: readIntEnv('SANDBOX_EXEC_PIDS_LIMIT', 128),
        sandboxExecTimeoutMs: readIntEnv('SANDBOX_EXEC_TIMEOUT_MS', 80 * 60 * 1000),
        sandboxExecMaxOutputBytes: readIntEnv('SANDBOX_EXEC_MAX_OUTPUT_BYTES', 256 * 1024),
        sandboxExecWorkspaceMaxBytes: readIntEnv('SANDBOX_EXEC_WORKSPACE_MAX_BYTES', 512 * 1024 * 1024),
        sandboxExecTmpfsSizeBytes: readIntEnv('SANDBOX_EXEC_TMPFS_SIZE_BYTES', 64 * 1024 * 1024),
        sandboxExecNetworkEnabled: readBoolEnv('SANDBOX_EXEC_NETWORK_ENABLED', false),
        sandboxExecProxyUrl: process.env.SANDBOX_EXEC_PROXY_URL?.trim() || process.env.CODEX_OPENAI_PROXY_URL?.trim() || undefined,
        runtimeStateCacheTtlMs: readIntEnv('RUNTIME_STATE_CACHE_TTL_MS', 24 * 60 * 60 * 1000),
        runtimeStateMaxArchiveBytes: readIntEnv('RUNTIME_STATE_MAX_ARCHIVE_BYTES', 16 * 1024 * 1024),
        artifactObjectStorageEnabled: readBoolEnv('ARTIFACT_OBJECT_STORAGE_ENABLED', false),
        artifactObjectStorageBucket: readEnv('ARTIFACT_OBJECT_STORAGE_BUCKET', ''),
        artifactObjectStorageEndpoint: readEnv('ARTIFACT_OBJECT_STORAGE_ENDPOINT', 'https://oss-ap-southeast-1.aliyuncs.com'),
        artifactObjectStorageInternalEndpoint: process.env.ARTIFACT_OBJECT_STORAGE_INTERNAL_ENDPOINT?.trim() || undefined,
        artifactObjectStorageAccessKeyIdEnv: readEnv('ARTIFACT_OBJECT_STORAGE_ACCESS_KEY_ID_ENV', 'ALIYUN_OSS_ACCESS_KEY_ID'),
        artifactObjectStorageAccessKeySecretEnv: readEnv('ARTIFACT_OBJECT_STORAGE_ACCESS_KEY_SECRET_ENV', 'ALIYUN_OSS_ACCESS_KEY_SECRET'),
        artifactObjectStorageUploadMaxBytes: readIntEnv('ARTIFACT_OBJECT_STORAGE_UPLOAD_MAX_BYTES', 50 * 1024 * 1024),
        artifactObjectStorageUploadTtlSeconds: readIntEnv('ARTIFACT_OBJECT_STORAGE_UPLOAD_TTL_SECONDS', 15 * 60),
        artifactObjectStorageDownloadTtlSeconds: readIntEnv('ARTIFACT_OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS', 10 * 60),
    };
}
