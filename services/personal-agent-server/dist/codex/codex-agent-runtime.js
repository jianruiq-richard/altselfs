import fs from 'node:fs/promises';
import path from 'node:path';
import { CodexJsonRpcClient } from './json-rpc-client.js';
import { projectCodexNotification } from './event-projector.js';
import { buildMemoryContext } from '../memory-store.js';
import { isRecord, nowIso, safeJson, truncate } from '../util.js';
import { createWebSearchDynamictool, runWebSearchtool } from '../tools/web-search.js';
import { createRapidApiCompetitorDynamictools, getRapidApiCompetitortoolNamesForProviders, isRapidApiCompetitortool, runRapidApiCompetitortool, } from '../tools/rapidapi-competitor.js';
import { createSandboxExecDynamictool, isSandboxExectool, runSandboxExectool, } from '../tools/sandbox-exec.js';
import { createPersonalDataDynamictools, isPersonalDatatool, runPersonalDatatool, } from '../tools/personal-data.js';
import { acquireSharedOpenAiAuthLock } from './openai-auth-lock.js';
export class CodexAgentRuntime {
    config;
    id = 'codex';
    description = 'Original Codex app-server runtime for code, files, shell, patching, sandbox, MCP, and complex execution.';
    constructor(config) {
        this.config = config;
    }
    canHandle(input) {
        return /instruction|instruction|instruction|instruction|git|instruction|instruction|instruction|shell|build|lint|instruction|canvas|API|instruction|Prisma|Next/i.test(input.message);
    }
    async run(input) {
        const events = [];
        const emit = async (event) => {
            events.push(event);
            await input.onEvent?.(event);
        };
        const selectedModel = this.resolveSelectedModel(input);
        const modelSelection = this.resolveModelSelection(selectedModel);
        const codexHome = await this.ensureCodexHome(input.userId, modelSelection);
        const workspace = await this.ensureWorkspace(input.userId, input.threadId);
        let finalText = '';
        let assistantBuffer = '';
        let codexThreadId = '';
        let policyViolationMessage = null;
        let usedExternalSearch = false;
        let client;
        let codexOpenAiAuthLock;
        const nonLocalProfile = this.isNonLocalCodexProfile(input.profileId);
        const localEnvironmentDisabled = nonLocalProfile && this.config.disableLocalEnvironmentForGeneral;
        try {
            if (modelSelection.provider === 'openai') {
                codexOpenAiAuthLock = await acquireSharedOpenAiAuthLock({
                    codexHome,
                    sourcePath: this.config.codexOpenAiAuthJsonPath,
                });
            }
            client = new CodexJsonRpcClient({
                codexBin: this.config.codexBin,
                codexHome,
                env: this.buildCodexProcessEnv(modelSelection),
            });
            const activeClient = client;
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
                    codexModel: modelSelection.model,
                    codexModelProvider: modelSelection.provider,
                },
            });
            await activeClient.initialize();
            const dynamictools = nonLocalProfile ? await this.buildDynamictools(input, modelSelection) : undefined;
            const thread = await activeClient.request('thread/start', {
                cwd: workspace,
                ...(localEnvironmentDisabled ? { environments: [] } : {}),
                ...(nonLocalProfile ? { dynamictools } : {}),
                ...(modelSelection.model ? { model: modelSelection.model } : {}),
                ...(modelSelection.provider ? { modelProvider: modelSelection.provider } : {}),
                developerInstructions: this.buildDeveloperInstructions(input.profileId, input.metadata, modelSelection),
                personality: 'pragmatic',
            }, 15_000);
            codexThreadId = extractThreadId(thread);
            await emit({ type: 'codex.thread.started', timestamp: nowIso(), payload: { codexThreadId, raw: thread } });
            const sandboxExecContext = {
                userId: input.userId,
                threadId: input.threadId,
                runId: typeof input.metadata?.runId === 'string' ? input.metadata.runId : undefined,
                workspace,
            };
            const personaltoolContext = {
                userId: input.userId,
                investorId: typeof input.metadata?.investorId === 'string' && input.metadata.investorId.trim()
                    ? input.metadata.investorId.trim()
                    : input.userId,
                threadId: input.threadId,
                runId: typeof input.metadata?.runId === 'string' ? input.metadata.runId : undefined,
            };
            activeClient.on('serverRequest', (request) => {
                this.handleServerRequest(activeClient, request, emit, sandboxExecContext, personaltoolContext).then((handled) => {
                    if (handled === 'web_search')
                        usedExternalSearch = true;
                });
            });
            activeClient.on('notification', (notification) => {
                if (localEnvironmentDisabled && this.isProhibitedLocaltoolNotification(notification)) {
                    policyViolationMessage = `${input.profileId || 'codex-general'} is not allowed to use local command, file, patch, or image tools`;
                    void emit({
                        type: 'codex.policy_violation',
                        timestamp: nowIso(),
                        payload: safeJson({ notification, policy: policyViolationMessage }),
                    });
                    activeClient.close();
                    return;
                }
                if (this.isNativeWebSearchNotification(notification))
                    usedExternalSearch = true;
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
            const turn = await activeClient.request('turn/start', {
                threadId: codexThreadId,
                ...(localEnvironmentDisabled ? { environments: [] } : {}),
                input: turnInput,
            }, 15_000);
            await emit({ type: 'codex.turn.started', timestamp: nowIso(), payload: { raw: turn } });
            await this.waitForTurnCompletion(activeClient, emit);
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
                payload: { error: message, stderr: client?.stderrTail(20) || [] },
            });
            return {
                route: 'codex',
                reply: `Codex app-server Execution failed: ${message}`,
                events,
                raw: { codexThreadId, stderr: client?.stderrTail(20) || [] },
            };
        }
        finally {
            client?.close();
            if (codexOpenAiAuthLock) {
                try {
                    await codexOpenAiAuthLock.release();
                }
                catch (error) {
                    await emit({
                        type: 'codex.openai_auth.lock_release_failed',
                        timestamp: nowIso(),
                        payload: {
                            authPath: codexOpenAiAuthLock.authPath,
                            sourcePath: codexOpenAiAuthLock.sourcePath,
                            error: error instanceof Error ? error.message : String(error),
                        },
                    });
                }
            }
        }
    }
    async ensureCodexHome(userId, selection) {
        const dir = path.join(this.config.codexHomeRoot, sanitizePathSegment(userId));
        await fs.mkdir(dir, { recursive: true });
        await this.writeCodexConfig(dir, selection);
        return dir;
    }
    async writeCodexConfig(codexHome, selection) {
        const configPath = path.join(codexHome, 'config.toml');
        const metadata = this.resolveModelMetadata(selection.model);
        const catalogPath = selection.provider === 'openrouter'
            ? await this.writeCodexModelCatalog(codexHome, selection.model)
            : undefined;
        const modelLine = selection.model ? `model = ${tomlString(selection.model)}\n` : '';
        const providerLine = selection.provider ? `model_provider = ${tomlString(selection.provider)}` : '';
        if (selection.provider === 'openai') {
            const content = [
                modelLine.trimEnd(),
                providerLine,
                `web_search = ${tomlString(this.config.codexWebSearchMode)}`,
                catalogPath ? `model_catalog_json = ${tomlString(catalogPath)}` : '',
                'disable_response_storage = true',
                ...codexModelMetadataLines(metadata),
            ].filter(Boolean).join('\n') + '\n';
            await fs.writeFile(configPath, content, 'utf8');
            return;
        }
        if (selection.provider !== 'openrouter')
            return;
        const content = [
            modelLine.trimEnd(),
            providerLine,
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
        return normalizeCodexModel(typeof requested === 'string' && requested.trim() ? requested.trim() : this.config.codexModel);
    }
    resolveModelSelection(model) {
        const configuredProvider = normalizeCodexProvider(this.config.codexModelProvider);
        if (model === 'gpt-5.5')
            return { model, provider: 'openai' };
        if (model === 'deepseek/deepseek-v3.2')
            return { model, provider: 'openrouter' };
        return {
            model,
            provider: configuredProvider || (model ? 'openrouter' : undefined),
        };
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
                text: `[instruction ${attachment.name} instruction ${attachment.kind}/${attachment.type}, Codex app-server instruction turn input instruction.]`,
            });
        }
        return input;
    }
    async ensureWorkspace(userId, threadId) {
        const dir = path.join(this.config.workspaceRoot, sanitizePathSegment(userId), sanitizePathSegment(threadId));
        await fs.mkdir(dir, { recursive: true });
        return dir;
    }
    async buildDynamictools(input, selection) {
        const tools = selection.provider === 'openai' ? [] : [createWebSearchDynamictool()];
        if (this.config.sandboxExecEnabled)
            tools.push(createSandboxExecDynamictool());
        if (input.profileId === 'codex-competitive-intelligence') {
            const connectorScope = getConnectorScope(input.metadata);
            const enabledCompetitorSources = filterByConnectorScope(getEnabledInfoSourceNames(input.metadata), connectorScope.enabledConnectorKeys);
            tools.push(...createRapidApiCompetitorDynamictools(enabledCompetitorSources));
        }
        const investorId = typeof input.metadata?.investorId === 'string' ? input.metadata.investorId : undefined;
        const connectorScope = getConnectorScope(input.metadata);
        tools.push(...await createPersonalDataDynamictools(this.config, {
            investorId,
            userId: input.userId,
            enabledProviders: connectorScope.personalProviderKeys,
            enabledConnectionIds: connectorScope.enabledConnectionIds,
        }));
        return tools;
    }
    async handleServerRequest(client, request, emit, sandboxExecContext, personaltoolContext) {
        const method = String(request.method || '');
        const requestId = request.id;
        void emit({ type: `codex.server_request.${method}`, timestamp: nowIso(), payload: safeJson({ request }) });
        if (method === 'item/tool/call') {
            const params = isRecord(request.params) ? request.params : {};
            const namespace = typeof params.namespace === 'string' ? params.namespace : '';
            const tool = typeof params.tool === 'string' ? params.tool : '';
            if ((!namespace && tool === 'altselfs_web_search') || (namespace === 'altselfs' && tool === 'web_search')) {
                const resultText = await runWebSearchtool(params.arguments, this.config);
                client.respond(requestId, {
                    contentItems: [{ type: 'inputText', text: resultText }],
                    success: true,
                });
                return 'web_search';
            }
            if (!namespace && isRapidApiCompetitortool(tool)) {
                const resultText = await runRapidApiCompetitortool(tool, params.arguments, this.config);
                client.respond(requestId, {
                    contentItems: [{ type: 'inputText', text: resultText }],
                    success: true,
                });
                return 'handled';
            }
            if (!namespace && isPersonalDatatool(tool)) {
                const resultText = await runPersonalDatatool(tool, params.arguments, this.config, personaltoolContext);
                client.respond(requestId, {
                    contentItems: [{ type: 'inputText', text: resultText }],
                    success: !resultText.includes('"error"'),
                });
                return 'handled';
            }
            if ((!namespace && isSandboxExectool(tool)) || (namespace === 'altselfs' && tool === 'sandbox_exec')) {
                const resultText = await runSandboxExectool(params.arguments, this.config, sandboxExecContext);
                client.respond(requestId, {
                    contentItems: [{ type: 'inputText', text: resultText }],
                    success: !resultText.includes('"error"'),
                });
                return 'handled';
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
    buildDeveloperInstructions(profileId, metadata, selection) {
        const currentTime = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Shanghai',
            dateStyle: 'full',
            timeStyle: 'long',
        }).format(new Date());
        const shared = [
            `Current time: ${currentTime} (Asia/Shanghai).`,
            `Codex web_search mode requested by host: ${this.config.codexWebSearchMode}.`,
            'Answer in the user language unless the user asks otherwise.',
            selection?.provider === 'openai'
                ? 'When public web research is needed, use the native web.run tool exposed by the OpenAI Codex provider.'
                : 'When public web research is needed, use the registered altselfs_web_search tool.',
            'Personal account tools such as Gmail are available only when registered for this user. Use them only when the user asks for private-channel information or the task clearly requires it; never claim to have read private accounts unless the corresponding tool was actually called.',
        ];
        if (profileId === 'codex-competitive-intelligence') {
            const enabledCompetitorSources = getEnabledInfoSourceNames(metadata);
            const enabledtoolNames = getRapidApiCompetitortoolNamesForProviders(enabledCompetitorSources);
            const competitortoolInstruction = enabledtoolNames.length > 0
                ? `- The following RapidAPI-backed competitor tools are enabled for this turn: ${enabledtoolNames.join(', ')}. Use only these enabled tools, choose the narrowest useful tool for the question, and cross-check when multiple enabled sources overlap.`
                : '- No RapidAPI-backed competitor data source is enabled for this user in this turn. Do not claim to have used Semrush, Similarweb, Ahrefs, Moz, Majestic, or RapidAPI platform data; use public web fallback only when appropriate and state the limitation.';
            const publicWebFallbackInstruction = selection?.provider === 'openai'
                ? '- Treat native web.run as the public-web fallback and cross-check source, not as a substitute for paid platform data when a more specific enabled source is available.'
                : '- Treat altselfs_web_search as the public-web fallback and cross-check source, not as a substitute for paid platform data when a more specific enabled source is available.';
            return [
                ...shared,
                '',
                'Altselfs codex-competitive-intelligence policy:',
                '- You are a competitive intelligence analysis profile under the Altselfs information-processing operation department.',
                '- The user still interacts through the normal AI assistant chatbox. Produce the final answer directly in chat; do not ask the user to open a separate report surface.',
                '- Your job is to answer questions about competitors, competitive landscape, user/traffic/revenue estimates, growth rate, acquisition channels, SEO, PPC, keywords, backlinks, Semrush, Similarweb, market share, and growth intelligence.',
                '- Do not use native local shell, file, patch, image, or repository tools. Do not inspect, read, write, patch, or modify local repositories.',
                this.config.sandboxExecEnabled
                    ? '- When deterministic computation, parsing, scraping, or small file transformation is truly needed, use only the registered altselfs_sandbox_exec tool. Keep commands short, scoped to /workspace, and explain any important command output in the final answer.'
                    : '- Sandboxed command execution is not enabled in this environment. Do not run shell commands, scripts, package managers, or local code.',
                '- Before analysis, identify the product, website/domain, category, target market, target user, region/database, known competitors, and time window from the user message and conversation context.',
                '- If a critical input such as the product/domain is missing, ask one concise clarification question instead of fabricating a target.',
                competitortoolInstruction,
                '- Treat these RapidAPI tools as third-party wrappers, not official Semrush, Similarweb, Ahrefs, Moz, or Majestic APIs. Name the actual source used in the answer.',
                '- Similarweb, Google, YouTube, X/Twitter, Facebook, WeChat, Xiaohongshu, Gmail, and Feishu may be used only when actually available/enabled in the turn.',
                publicWebFallbackInstruction,
                '- Never claim that Semrush, Similarweb, Google, a social platform, or a private-channel agent was used unless the corresponding tool/capability was actually called.',
                '- Structure competitor conclusions around four questions when relevant: who the competitors are, what their user/traffic/revenue scale appears to be, how fast they have grown, and how they acquire users.',
                '- Separate observable facts, third-party estimates, proxy signals, model/user assumptions, and your own inference. Do not present inferred users or revenue as confirmed facts.',
                '- Attach confidence labels to important claims: high when multiple reliable sources agree or the source is official; medium when several proxy signals align; low when the claim depends on one source or strong assumptions; unknown when evidence is insufficient.',
                '- For revenue and user-count estimates, provide ranges and assumptions, not false precision.',
                '- If an enabled data source is missing, state the limitation and explain which conclusions remain lower confidence until that source is enabled.',
                '- Finish with a direct synthesis and actionable implications. Do not end by saying you will call another tool; either call it or answer from available evidence.',
            ].join('\n');
        }
        if (!this.isNonLocalCodexProfile(profileId))
            return shared.join('\n');
        const generalPublicWebInstruction = selection?.provider === 'openai'
            ? '- Use native web.run when the user needs current public web facts, news, industry updates, market information, or web research and no more specific channel/tool is better.'
            : '- Treat altselfs_web_search as the public-web information source, not as the only possible source. Use it when the user needs current public web facts, news, industry updates, market information, or web research and no more specific channel/tool is better.';
        return [
            ...shared,
            '',
            'Altselfs codex-general policy:',
            '- You are a general personal agent for discussion, research, planning, and synthesis.',
            '- Do not use native local shell, file, patch, image, or repository tools. Do not inspect, read, write, patch, or modify local repositories.',
            this.config.sandboxExecEnabled
                ? '- When deterministic computation, parsing, scraping, or small file transformation is truly needed, use only the registered altselfs_sandbox_exec tool. Keep commands short, scoped to /workspace, and prefer registered platform tools for third-party data.'
                : '- Sandboxed command execution is not enabled in this environment. Do not run shell commands, scripts, package managers, or local code.',
            '- Use conversation and reasoning for tasks that do not need external data.',
            '- When a task needs external, current, private-channel, or product data, first choose the most relevant registered non-local tool, channel agent, or platform/MCP capability available in this turn.',
            generalPublicWebInstruction,
            '- In Altselfs context, OPC usually means One Person Company / instruction unless the user explicitly says OPC UA or industrial automation.',
            '- Do not claim that you searched, read a channel, checked a platform, or called an agent unless the corresponding tool/capability was actually called.',
            '- If the needed capability is unavailable, explain the limitation instead of trying local file or command tools.',
        ].join('\n');
    }
    isGeneralProfile(profileId) {
        return !profileId || profileId === 'codex-general';
    }
    isNonLocalCodexProfile(profileId) {
        return this.isGeneralProfile(profileId) || profileId === 'codex-competitive-intelligence';
    }
    requiresCurrentExternalInfo(message) {
        return /instruction|instruction|instruction|Today|instruction|instruction|instruction|instruction|instruction|instruction|instruction|current|latest|today|news|web/i.test(message);
    }
    isProhibitedLocaltoolNotification(notification) {
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
    buildCodexProcessEnv(selection) {
        if (selection.provider !== 'openai' || !this.config.codexOpenAiProxyUrl)
            return undefined;
        const proxyUrl = this.config.codexOpenAiProxyUrl;
        const noProxy = mergeNoProxy(process.env.NO_PROXY || process.env.no_proxy || '');
        return {
            HTTP_PROXY: proxyUrl,
            HTTPS_PROXY: proxyUrl,
            ALL_PROXY: proxyUrl,
            http_proxy: proxyUrl,
            https_proxy: proxyUrl,
            all_proxy: proxyUrl,
            NO_PROXY: noProxy,
            no_proxy: noProxy,
        };
    }
    isNativeWebSearchNotification(notification) {
        const text = JSON.stringify(notification).toLowerCase();
        return text.includes('websearch') || text.includes('web_search') || text.includes('web.run');
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
    const value = metadata?.multimodalAttachments ?? metadata?.attachments;
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
function getEnabledInfoSourceNames(metadata) {
    const value = metadata?.enabledInfoSources;
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => {
        if (typeof item === 'string')
            return item.toLowerCase();
        if (!isRecord(item))
            return null;
        return typeof item.provider === 'string' ? item.provider.toLowerCase() : null;
    })
        .filter((item) => Boolean(item));
}
function getConnectorScope(metadata) {
    const scope = isRecord(metadata?.connectorScope) ? metadata.connectorScope : null;
    const enabledConnectorKeys = normalizeOptionalStringArray(scope?.enabledConnectorKeys, true);
    const enabledConnectionIds = normalizeOptionalStringArray(scope?.enabledConnectionIds, false);
    const personalProviderKeys = enabledConnectorKeys
        ? enabledConnectorKeys.filter((key) => key === 'gmail' || key === 'feishu' || key === 'meta')
        : undefined;
    return {
        enabledConnectorKeys,
        enabledConnectionIds,
        personalProviderKeys,
    };
}
function normalizeOptionalStringArray(value, lowercase) {
    if (!Array.isArray(value))
        return undefined;
    return Array.from(new Set(value
        .map((item) => {
        if (typeof item !== 'string')
            return '';
        const trimmed = item.trim();
        return lowercase ? trimmed.toLowerCase() : trimmed;
    })
        .filter(Boolean)));
}
function filterByConnectorScope(values, enabledConnectorKeys) {
    if (!enabledConnectorKeys)
        return values;
    const allowed = new Set(enabledConnectorKeys);
    return values.filter((value) => allowed.has(value));
}
function normalizeCodexModel(model) {
    const value = model?.trim();
    if (!value)
        return undefined;
    const normalized = value.toLowerCase();
    if (normalized === 'gpt-5.5' || normalized === 'chatgpt-5.5')
        return 'gpt-5.5';
    if (normalized === 'deepseek/deepseek-v3.2' ||
        normalized === 'deepseek-v3.2' ||
        normalized === 'deepseek3.2') {
        return 'deepseek/deepseek-v3.2';
    }
    return value;
}
function normalizeCodexProvider(provider) {
    const value = provider?.trim().toLowerCase();
    if (value === 'openai' || value === 'openrouter')
        return value;
    return undefined;
}
function mergeNoProxy(existing) {
    const values = new Set(existing
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean));
    for (const item of ['localhost', '127.0.0.1'])
        values.add(item);
    return [...values].join(',');
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
