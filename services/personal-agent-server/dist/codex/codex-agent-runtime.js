import fs from 'node:fs/promises';
import path from 'node:path';
import { CodexJsonRpcClient } from './json-rpc-client.js';
import { projectCodexNotification } from './event-projector.js';
import { buildMemoryContext } from '../memory-store.js';
import { isRecord, nowIso, safeJson, truncate } from '../util.js';
export class CodexAgentRuntime {
    config;
    id = 'codex';
    description = 'Original Codex app-server runtime for code, files, shell, patching, sandbox, MCP, and complex execution.';
    constructor(config) {
        this.config = config;
    }
    canHandle(input) {
        return /代码|修改|修复|部署|git|文件|脚本|终端|shell|build|lint|测试|canvas|API|数据库|Prisma|Next/i.test(input.message);
    }
    async run(input) {
        const events = [];
        const emit = async (event) => {
            events.push(event);
            await input.onEvent?.(event);
        };
        const selectedModel = this.resolveSelectedModel(input);
        const codexHome = await this.ensureCodexHome(input.userId, selectedModel);
        const workspace = await this.ensureWorkspace(input.userId, input.threadId);
        const client = new CodexJsonRpcClient({
            codexBin: this.config.codexBin,
            codexHome,
        });
        let finalText = '';
        let assistantBuffer = '';
        let codexThreadId = '';
        let policyViolationMessage = null;
        let usedExternalSearch = false;
        const generalProfile = this.isGeneralProfile(input.profileId);
        const localEnvironmentDisabled = generalProfile && this.config.disableLocalEnvironmentForGeneral;
        try {
            await emit({
                type: 'codex.session.starting',
                timestamp: nowIso(),
                payload: {
                    codexHome,
                    workspace,
                    profileId: input.profileId || 'codex',
                    localEnvironmentDisabled,
                    webSearchMode: this.config.codexWebSearchMode,
                    webSearchProvider: this.config.webSearchProvider,
                },
            });
            await client.initialize();
            const thread = await client.request('thread/start', {
                cwd: workspace,
                ...(localEnvironmentDisabled ? { environments: [] } : {}),
                ...(generalProfile ? { dynamicTools: [createWebSearchDynamicTool()] } : {}),
                ...(selectedModel ? { model: selectedModel } : {}),
                ...(this.config.codexModelProvider ? { modelProvider: this.config.codexModelProvider } : {}),
                developerInstructions: this.buildDeveloperInstructions(input.profileId),
                personality: 'pragmatic',
            }, 15_000);
            codexThreadId = extractThreadId(thread);
            await emit({ type: 'codex.thread.started', timestamp: nowIso(), payload: { codexThreadId, raw: thread } });
            client.on('serverRequest', (request) => {
                this.handleServerRequest(client, request, emit).then((handled) => {
                    if (handled === 'web_search')
                        usedExternalSearch = true;
                });
            });
            client.on('notification', (notification) => {
                if (localEnvironmentDisabled && this.isProhibitedLocalToolNotification(notification)) {
                    policyViolationMessage = 'codex-general is not allowed to use local command, file, patch, or image tools';
                    void emit({
                        type: 'codex.policy_violation',
                        timestamp: nowIso(),
                        payload: safeJson({ notification, policy: policyViolationMessage }),
                    });
                    client.close();
                    return;
                }
                const projected = projectCodexNotification(notification);
                if (projected.assistantDelta)
                    assistantBuffer += projected.assistantDelta;
                if (projected.finalText)
                    finalText = projected.finalText;
                void emit({
                    type: `codex.${String(notification.method || 'notification')}`,
                    timestamp: nowIso(),
                    payload: safeJson({
                        notification,
                        notificationText: truncate(JSON.stringify(notification), 20000),
                        projected,
                    }),
                });
            });
            const prompt = [
                buildMemoryContext(input.memorySnapshot),
                '',
                `Selected agent profile: ${input.profileId || 'codex'}`,
                '',
                'User turn:',
                input.message,
            ].join('\n');
            const turnInput = this.buildTurnInput(prompt, input.metadata);
            const turn = await client.request('turn/start', {
                threadId: codexThreadId,
                ...(localEnvironmentDisabled ? { environments: [] } : {}),
                input: turnInput,
            }, 15_000);
            await emit({ type: 'codex.turn.started', timestamp: nowIso(), payload: { raw: turn } });
            await this.waitForTurnCompletion(client, emit);
            if (policyViolationMessage)
                throw new Error(policyViolationMessage);
            if (this.requiresCurrentExternalInfo(input.message) && !usedExternalSearch) {
                await emit({
                    type: 'codex.web_search.not_used',
                    timestamp: nowIso(),
                    payload: {
                        warning: 'The user requested current external information, but no non-local web search tool call was observed.',
                    },
                });
            }
            return {
                route: 'codex',
                reply: (finalText || assistantBuffer || 'Codex turn completed without a final assistant message.').trim(),
                events,
                raw: { codexThreadId },
            };
        }
        catch (error) {
            const message = policyViolationMessage || (error instanceof Error ? error.message : String(error));
            await emit({
                type: 'codex.error',
                timestamp: nowIso(),
                payload: { error: message, stderr: client.stderrTail(20) },
            });
            return {
                route: 'codex',
                reply: `Codex app-server 执行失败：${message}`,
                events,
                raw: { codexThreadId, stderr: client.stderrTail(20) },
            };
        }
        finally {
            client.close();
        }
    }
    async ensureCodexHome(userId, selectedModel) {
        const dir = path.join(this.config.codexHomeRoot, sanitizePathSegment(userId));
        await fs.mkdir(dir, { recursive: true });
        await this.writeCodexConfig(dir, selectedModel);
        return dir;
    }
    async writeCodexConfig(codexHome, selectedModel) {
        if (this.config.codexModelProvider !== 'openrouter')
            return;
        const configPath = path.join(codexHome, 'config.toml');
        const metadata = this.resolveModelMetadata(selectedModel);
        const catalogPath = await this.writeCodexModelCatalog(codexHome, selectedModel);
        const modelLine = selectedModel ? `model = ${tomlString(selectedModel)}\n` : '';
        const content = [
            modelLine.trimEnd(),
            'model_provider = "openrouter"',
            `web_search = ${tomlString(this.config.codexWebSearchMode)}`,
            catalogPath ? `model_catalog_json = ${tomlString(catalogPath)}` : '',
            ...codexModelMetadataLines(metadata),
            '',
            '[model_providers.openrouter]',
            'name = "OpenRouter"',
            `base_url = ${tomlString(this.config.openRouterBaseUrl)}`,
            'wire_api = "responses"',
            `env_key = ${tomlString(this.config.openRouterApiKeyEnv)}`,
            '',
            '[model_providers.openrouter.http_headers]',
            '"X-OpenRouter-Title" = ' + tomlString(this.config.openRouterAppTitle),
        ].filter(Boolean).join('\n') + '\n';
        await fs.writeFile(configPath, content, 'utf8');
    }
    async writeCodexModelCatalog(codexHome, selectedModel) {
        const models = new Set(Object.keys(this.config.codexModelCatalog.models));
        if (selectedModel)
            models.add(selectedModel);
        if (models.size === 0)
            return undefined;
        const catalogPath = path.join(codexHome, 'model-catalog.json');
        const catalog = {
            models: [...models].sort().map((model) => codexModelCatalogEntry(model, this.resolveModelMetadata(model))),
        };
        await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
        return catalogPath;
    }
    resolveSelectedModel(input) {
        const requested = input.metadata?.codexModel;
        return typeof requested === 'string' && requested.trim() ? requested.trim() : this.config.codexModel;
    }
    resolveModelMetadata(model) {
        return {
            ...this.config.codexModelCatalog.defaultMetadata,
            ...(model ? this.config.codexModelCatalog.models[model] || {} : {}),
        };
    }
    buildTurnInput(prompt, metadata) {
        const attachments = readMultimodalAttachments(metadata);
        const input = [{ type: 'text', text: prompt }];
        for (const attachment of attachments) {
            if (attachment.kind === 'image') {
                input.push({
                    type: 'image',
                    image_url: attachment.dataUrl,
                    detail: 'auto',
                });
                continue;
            }
            input.push({
                type: 'text',
                text: `[附件 ${attachment.name} 是 ${attachment.kind}/${attachment.type}，Codex app-server 不支持把这种文件作为 turn input 直接传入。]`,
            });
        }
        return input;
    }
    async ensureWorkspace(userId, threadId) {
        const dir = path.join(this.config.workspaceRoot, sanitizePathSegment(userId), sanitizePathSegment(threadId));
        await fs.mkdir(dir, { recursive: true });
        return dir;
    }
    async handleServerRequest(client, request, emit) {
        const method = String(request.method || '');
        const requestId = request.id;
        void emit({ type: `codex.server_request.${method}`, timestamp: nowIso(), payload: safeJson({ request }) });
        if (method === 'item/tool/call') {
            const params = isRecord(request.params) ? request.params : {};
            const namespace = typeof params.namespace === 'string' ? params.namespace : '';
            const tool = typeof params.tool === 'string' ? params.tool : '';
            if ((!namespace && tool === 'altselfs_web_search') || (namespace === 'altselfs' && tool === 'web_search')) {
                const resultText = await this.runWebSearchTool(params.arguments);
                client.respond(requestId, {
                    contentItems: [{ type: 'inputText', text: resultText }],
                    success: true,
                });
                return 'web_search';
            }
            client.respond(requestId, {
                contentItems: [{ type: 'inputText', text: `Unsupported dynamic tool: ${namespace}.${tool}` }],
                success: false,
            });
            return 'handled';
        }
        if (method === 'item/permissions/requestApproval') {
            client.respond(requestId, { decision: 'decline' });
            return 'handled';
        }
        if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
            client.respond(requestId, { decision: 'decline' });
            return 'handled';
        }
        client.respondError(requestId, -32601, `Unsupported server request: ${method}`);
        return 'handled';
    }
    buildDeveloperInstructions(profileId) {
        const currentTime = new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            dateStyle: 'full',
            timeStyle: 'long',
        }).format(new Date());
        const shared = [
            `Current time: ${currentTime} (Asia/Shanghai).`,
            `Codex web_search mode requested by host: ${this.config.codexWebSearchMode}.`,
            'Answer in the user language unless the user asks otherwise.',
        ];
        if (!this.isGeneralProfile(profileId))
            return shared.join('\n');
        return [
            ...shared,
            '',
            'Altselfs codex-general policy:',
            '- You are a general personal agent for discussion, research, planning, and synthesis.',
            '- Do not inspect, read, write, patch, or modify local files or repositories.',
            '- Do not run shell commands, tests, builds, package managers, scripts, or local code.',
            '- Use only conversation, reasoning, hosted web search, altselfs_web_search, or non-local platform/MCP tools if available.',
            '- In Altselfs context, OPC usually means One Person Company / 一人公司 unless the user explicitly says OPC UA or industrial automation.',
            '- For current, latest, today, news, industry, market, external, or web research requests, call altselfs_web_search before summarizing. Do not claim you searched unless a web search tool was called.',
            '- If the needed capability is unavailable, explain the limitation instead of trying local file or command tools.',
        ].join('\n');
    }
    async runWebSearchTool(argumentsValue) {
        const args = isRecord(argumentsValue) ? argumentsValue : {};
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        const recency = typeof args.recency === 'string' ? args.recency.trim() : undefined;
        if (!query)
            return JSON.stringify({ error: 'query is required' });
        const provider = this.resolveWebSearchProvider();
        if (!provider) {
            return JSON.stringify({
                query,
                recency,
                error: 'No web search provider is configured. Set SERPAPI_API_KEY, SERPER_API_KEY, GOOGLE_CSE_API_KEY plus GOOGLE_CSE_ID, or BING_SEARCH_API_KEY.',
            });
        }
        try {
            const results = await runProviderSearch(provider, query, recency, this.config);
            return JSON.stringify({ query, recency, source: provider, results }, null, 2);
        }
        catch (error) {
            return JSON.stringify({
                query,
                recency,
                source: provider,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    resolveWebSearchProvider() {
        const configured = this.config.webSearchProvider;
        if (configured !== 'auto') {
            if (configured === 'serpapi' && !process.env[this.config.serpApiKeyEnv]?.trim())
                return null;
            if (configured === 'serper' && !process.env[this.config.serperApiKeyEnv]?.trim())
                return null;
            if (configured === 'google_cse' &&
                (!process.env[this.config.googleCseApiKeyEnv]?.trim() || !process.env[this.config.googleCseIdEnv]?.trim())) {
                return null;
            }
            if (configured === 'bing' && !process.env[this.config.bingSearchApiKeyEnv]?.trim())
                return null;
            return configured;
        }
        if (process.env[this.config.serpApiKeyEnv]?.trim())
            return 'serpapi';
        if (process.env[this.config.serperApiKeyEnv]?.trim())
            return 'serper';
        if (process.env[this.config.googleCseApiKeyEnv]?.trim() && process.env[this.config.googleCseIdEnv]?.trim()) {
            return 'google_cse';
        }
        if (process.env[this.config.bingSearchApiKeyEnv]?.trim())
            return 'bing';
        return 'duckduckgo';
    }
    isGeneralProfile(profileId) {
        return !profileId || profileId === 'codex-general';
    }
    requiresCurrentExternalInfo(message) {
        return /联网|搜索|搜集|今日|今天|最新|新闻|资讯|行业|市场|动态|current|latest|today|news|web/i.test(message);
    }
    isProhibitedLocalToolNotification(notification) {
        const method = String(notification.method || '').toLowerCase();
        if (method.includes('commandexecution') ||
            method.includes('filechange') ||
            method.includes('applypatch')) {
            return true;
        }
        const params = isRecord(notification.params) ? notification.params : {};
        const item = isRecord(params.item) ? params.item : {};
        const itemType = String(item.type || '').toLowerCase();
        return (itemType.includes('command') ||
            itemType.includes('file') ||
            itemType.includes('patch') ||
            itemType.includes('view_image'));
    }
    waitForTurnCompletion(client, emit) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('codex turn timed out after 10 minutes'));
            }, 600_000);
            const onNotification = (notification) => {
                if (notification.method === 'turn/completed') {
                    const params = isRecord(notification.params) ? notification.params : {};
                    const turn = isRecord(params.turn) ? params.turn : {};
                    if (String(turn.status || '') === 'failed') {
                        clearTimeout(timeout);
                        client.off('notification', onNotification);
                        reject(new Error(extractTurnErrorMessage(turn)));
                        return;
                    }
                    clearTimeout(timeout);
                    client.off('notification', onNotification);
                    void emit({ type: 'codex.turn.completed', timestamp: nowIso(), payload: safeJson({ notification }) });
                    resolve();
                }
            };
            const onExit = (payload) => {
                clearTimeout(timeout);
                client.off('notification', onNotification);
                reject(new Error(`codex app-server exited during turn: ${JSON.stringify(payload)}`));
            };
            client.on('notification', onNotification);
            client.once('exit', onExit);
        });
    }
}
function extractTurnErrorMessage(turn) {
    const error = isRecord(turn.error) ? turn.error : {};
    if (typeof error.message === 'string' && error.message.trim())
        return error.message;
    return `codex turn failed: ${JSON.stringify(turn).slice(0, 500)}`;
}
function extractThreadId(result) {
    const thread = result.thread;
    if (thread && typeof thread === 'object' && 'id' in thread && typeof thread.id === 'string')
        return thread.id;
    if (typeof result.threadId === 'string')
        return result.threadId;
    if (typeof result.sessionId === 'string')
        return result.sessionId;
    throw new Error(`thread/start returned no thread id: ${JSON.stringify(result).slice(0, 500)}`);
}
function sanitizePathSegment(value) {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
}
function readMultimodalAttachments(metadata) {
    const value = metadata?.attachments;
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => {
        if (!isRecord(item))
            return null;
        const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'attachment';
        const type = typeof item.type === 'string' && item.type.trim() ? item.type.trim() : 'application/octet-stream';
        const size = typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : 0;
        const dataUrl = typeof item.dataUrl === 'string' && item.dataUrl.startsWith('data:') ? item.dataUrl : '';
        const kind = typeof item.kind === 'string' ? item.kind : 'file';
        if (!dataUrl || !['image', 'video', 'pdf', 'document', 'file'].includes(kind))
            return null;
        return {
            name,
            type,
            size,
            kind: kind,
            dataUrl,
        };
    })
        .filter(Boolean);
}
function tomlString(value) {
    return JSON.stringify(value);
}
function codexModelMetadataLines(metadata) {
    const lines = [];
    if (metadata.contextWindow)
        lines.push(`model_context_window = ${metadata.contextWindow}`);
    if (metadata.autoCompactTokenLimit)
        lines.push(`model_auto_compact_token_limit = ${metadata.autoCompactTokenLimit}`);
    if (metadata.toolOutputTokenLimit)
        lines.push(`tool_output_token_limit = ${metadata.toolOutputTokenLimit}`);
    if (metadata.reasoningSummary)
        lines.push(`model_reasoning_summary = ${tomlString(metadata.reasoningSummary)}`);
    if (metadata.verbosity)
        lines.push(`model_verbosity = ${tomlString(metadata.verbosity)}`);
    if (metadata.supportsReasoningSummaries !== undefined) {
        lines.push(`model_supports_reasoning_summaries = ${metadata.supportsReasoningSummaries ? 'true' : 'false'}`);
    }
    return lines;
}
function codexModelCatalogEntry(model, metadata) {
    const contextWindow = metadata.contextWindow || 128000;
    const entry = {
        slug: model,
        display_name: model,
        description: `OpenRouter model ${model}`,
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [
            { effort: 'low', description: 'Fast responses with lighter reasoning' },
            { effort: 'medium', description: 'Balanced reasoning for everyday tasks' },
            { effort: 'high', description: 'Greater reasoning depth for complex tasks' },
        ],
        shell_type: 'shell_command',
        visibility: 'list',
        supported_in_api: true,
        priority: 1000,
        additional_speed_tiers: [],
        service_tiers: [],
        availability_nux: null,
        upgrade: null,
        base_instructions: 'You are Codex, a pragmatic AI agent. Follow the developer instructions, answer in the user language, and use tools only when they are available and appropriate.',
        supports_reasoning_summaries: metadata.supportsReasoningSummaries ?? false,
        support_verbosity: Boolean(metadata.verbosity),
        default_verbosity: metadata.verbosity || 'medium',
        truncation_policy: { mode: 'tokens', limit: 10000 },
        supports_parallel_tool_calls: true,
        supports_image_detail_original: true,
        experimental_supported_tools: [],
        input_modalities: codexSupportedInputModalities(metadata.inputModalities),
        supports_search_tool: true,
        use_responses_lite: false,
        model_messages: {
            instructions_template: 'You are Codex, a pragmatic AI agent. Follow the developer instructions, answer in the user language, and use tools only when they are available and appropriate.\n\n{{ personality }}',
            instructions_variables: {
                personality_default: '',
            },
            supports_reasoning_summaries: metadata.supportsReasoningSummaries ?? false,
            support_verbosity: Boolean(metadata.verbosity),
            default_verbosity: metadata.verbosity || 'medium',
            context_window: contextWindow,
        },
        context_window: contextWindow,
        max_context_window: contextWindow,
        effective_context_window_percent: 95,
    };
    if (metadata.reasoningSummary)
        entry.default_reasoning_summary = metadata.reasoningSummary;
    return entry;
}
function codexSupportedInputModalities(inputModalities) {
    const supported = (inputModalities || ['text']).filter((item) => item === 'text' || item === 'image');
    return supported.length > 0 ? supported : ['text'];
}
function createWebSearchDynamicTool() {
    return {
        namespace: null,
        name: 'altselfs_web_search',
        description: 'Search the public web for current external information. Use this before answering questions about today, latest news, industry updates, market information, or web research. Returns compact search results with title, URL, and snippet.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query.' },
                recency: { type: 'string', description: 'Optional recency hint such as today, 24h, week, month.' },
            },
            required: ['query'],
            additionalProperties: false,
        },
        deferLoading: false,
    };
}
async function runProviderSearch(provider, query, recency, config) {
    if (provider === 'serpapi')
        return serpApiSearch(query, recency, process.env[config.serpApiKeyEnv] || '');
    if (provider === 'serper')
        return serperSearch(query, recency, process.env[config.serperApiKeyEnv] || '');
    if (provider === 'google_cse') {
        return googleCseSearch(query, process.env[config.googleCseApiKeyEnv] || '', process.env[config.googleCseIdEnv] || '');
    }
    if (provider === 'bing')
        return bingSearch(query, recency, config);
    return duckDuckGoHtmlSearch(query);
}
async function serpApiSearch(query, recency, apiKey) {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('num', '8');
    url.searchParams.set('hl', 'zh-cn');
    url.searchParams.set('gl', 'cn');
    const timeRange = googleTimeRange(recency);
    if (timeRange)
        url.searchParams.set('tbs', timeRange);
    const response = await fetchJsonWithTimeout(url.toString(), { method: 'GET' });
    const organic = Array.isArray(response.organic_results) ? response.organic_results : [];
    return organic.slice(0, 8).map((item) => ({
        title: String(item.title || ''),
        url: String(item.link || ''),
        snippet: String(item.snippet || ''),
        publishedDate: typeof item.date === 'string' ? item.date : undefined,
    }));
}
async function serperSearch(query, recency, apiKey) {
    const response = await fetchJsonWithTimeout('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({
            q: query,
            num: 8,
            ...(googleTimeRange(recency) ? { tbs: googleTimeRange(recency) } : {}),
        }),
    });
    const organic = Array.isArray(response.organic) ? response.organic : [];
    return organic.slice(0, 8).map((item) => ({
        title: String(item.title || ''),
        url: String(item.link || ''),
        snippet: String(item.snippet || ''),
        publishedDate: typeof item.date === 'string' ? item.date : undefined,
    }));
}
function googleTimeRange(recency) {
    const value = recency?.toLowerCase() || '';
    if (value.includes('today') || value.includes('24h') || value.includes('day'))
        return 'qdr:d';
    if (value.includes('week') || value.includes('7d'))
        return 'qdr:w';
    if (value.includes('month') || value.includes('30d'))
        return 'qdr:m';
    return '';
}
async function googleCseSearch(query, apiKey, cx) {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', '8');
    const response = await fetchJsonWithTimeout(url.toString(), { method: 'GET' });
    const items = Array.isArray(response.items) ? response.items : [];
    return items.slice(0, 8).map((item) => ({
        title: String(item.title || ''),
        url: String(item.link || ''),
        snippet: String(item.snippet || ''),
    }));
}
async function bingSearch(query, recency, config) {
    const endpoint = new URL(config.bingSearchEndpoint);
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('count', '8');
    endpoint.searchParams.set('mkt', 'zh-CN');
    const freshness = bingFreshness(recency);
    if (freshness)
        endpoint.searchParams.set('freshness', freshness);
    const response = await fetchJsonWithTimeout(endpoint.toString(), {
        method: 'GET',
        headers: {
            'Ocp-Apim-Subscription-Key': process.env[config.bingSearchApiKeyEnv] || '',
        },
    });
    const values = isRecord(response.webPages) && Array.isArray(response.webPages.value) ? response.webPages.value : [];
    return values.slice(0, 8).map((item) => ({
        title: String(item.name || ''),
        url: String(item.url || ''),
        snippet: String(item.snippet || ''),
        publishedDate: typeof item.dateLastCrawled === 'string' ? item.dateLastCrawled : undefined,
    }));
}
function bingFreshness(recency) {
    const value = recency?.toLowerCase() || '';
    if (value.includes('today') || value.includes('24h') || value.includes('day'))
        return 'Day';
    if (value.includes('week') || value.includes('7d'))
        return 'Week';
    if (value.includes('month') || value.includes('30d'))
        return 'Month';
    return '';
}
async function fetchJsonWithTimeout(url, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`search request failed with HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
        }
        return await response.json();
    }
    finally {
        clearTimeout(timeout);
    }
}
async function duckDuckGoHtmlSearch(query) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'user-agent': 'AltselfsPersonalAgent/0.1',
            },
        });
        if (!response.ok)
            throw new Error(`search request failed with HTTP ${response.status}`);
        const html = await response.text();
        return parseDuckDuckGoResults(html).slice(0, 8);
    }
    finally {
        clearTimeout(timeout);
    }
}
function parseDuckDuckGoResults(html) {
    const results = [];
    const blocks = html.split(/<div class="result results_links/).slice(1);
    for (const block of blocks) {
        const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!linkMatch)
            continue;
        const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
        const rawUrl = decodeHtml(linkMatch[1]);
        results.push({
            title: cleanHtml(linkMatch[2]),
            url: extractDuckDuckGoTarget(rawUrl),
            snippet: cleanHtml(snippetMatch?.[1] || snippetMatch?.[2] || ''),
        });
    }
    return results;
}
function extractDuckDuckGoTarget(rawUrl) {
    try {
        const parsed = new URL(rawUrl, 'https://duckduckgo.com');
        const target = parsed.searchParams.get('uddg');
        return target ? decodeURIComponent(target) : parsed.toString();
    }
    catch {
        return rawUrl;
    }
}
function cleanHtml(value) {
    return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}
function decodeHtml(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'");
}
