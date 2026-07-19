#!/usr/bin/env node
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { CodexJsonRpcClient } from '../codex/json-rpc-client.js';
import { projectCodexNotification } from '../codex/event-projector.js';
import { prepareTemporaryOpenAiAuth } from '../codex/openai-auth-lock.js';
import { createWebSearchDynamictool, runWebSearchtool } from '../tools/web-search.js';
import { RAPIDAPI_COMPETITOR_TOOL_PROVIDER_NAMES, createRapidApiCompetitorDynamictools, isRapidApiCompetitortool, runRapidApiCompetitortool, } from '../tools/rapidapi-competitor.js';
import { createSandboxExecDynamictool, isSandboxExectool, runSandboxExectool, } from '../tools/sandbox-exec.js';
import { createPersonalDataDynamictools, isPersonalDatatool, runPersonalDatatool, } from '../tools/personal-data.js';
import { isRecord, nowIso, truncate } from '../util.js';
const MCP_PROTOCOL_VERSION = '2025-03-26';
const TOOL_NAME = 'codex_agent';
class McpStdioServer {
    buffer = Buffer.alloc(0);
    outputMode = 'content-length';
    start() {
        process.stdin.on('data', (chunk) => this.onData(chunk));
        process.stdin.on('end', () => process.exit(0));
        process.stdin.resume();
    }
    onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (true) {
            const message = this.readMessage();
            if (!message)
                return;
            void this.handleMessage(message).catch((error) => {
                const messageText = error instanceof Error ? error.message : String(error);
                log(`Unhandled MCP message error: ${messageText}`);
                if (message.id !== undefined && message.id !== null) {
                    this.sendError(message.id, -32000, messageText);
                }
            });
        }
    }
    readMessage() {
        while (true) {
            if (this.buffer.length === 0)
                return null;
            const prefix = this.buffer.subarray(0, Math.min(this.buffer.length, 32)).toString('utf8').toLowerCase();
            if (prefix.startsWith('content-length:')) {
                const headerEnd = this.buffer.indexOf('\r\n\r\n');
                if (headerEnd === -1)
                    return null;
                const header = this.buffer.subarray(0, headerEnd).toString('utf8');
                const lengthMatch = header.match(/content-length:\s*(\d+)/i);
                if (!lengthMatch) {
                    this.buffer = this.buffer.subarray(headerEnd + 4);
                    continue;
                }
                const length = Number(lengthMatch[1]);
                const bodyStart = headerEnd + 4;
                const bodyEnd = bodyStart + length;
                if (this.buffer.length < bodyEnd)
                    return null;
                const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
                this.buffer = this.buffer.subarray(bodyEnd);
                this.outputMode = 'content-length';
                return JSON.parse(body);
            }
            const lineEnd = this.buffer.indexOf('\n');
            if (lineEnd === -1)
                return null;
            const line = this.buffer.subarray(0, lineEnd).toString('utf8').trim();
            this.buffer = this.buffer.subarray(lineEnd + 1);
            if (!line)
                continue;
            this.outputMode = 'jsonl';
            return JSON.parse(line);
        }
    }
    async handleMessage(message) {
        const method = String(message.method || '');
        if (!method)
            return;
        if (method === 'initialize') {
            this.sendResult(message.id, {
                protocolVersion: readProtocolVersion(message.params) || MCP_PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: {
                    name: 'altselfs-codex-agent',
                    version: '0.1.0',
                },
            });
            return;
        }
        if (method === 'notifications/initialized' || method === 'initialized')
            return;
        if (method === 'ping') {
            this.sendResult(message.id, {});
            return;
        }
        if (method === 'tools/list') {
            this.sendResult(message.id, {
                tools: [
                    {
                        name: TOOL_NAME,
                        description: 'Delegate an execution, research, private-data, competitive-intelligence, or tool-use step to the thread-bound Codex agent. Codex uses its native app-server session and returns text to Hermes; Hermes decides the final user reply.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                task: {
                                    type: 'string',
                                    description: 'The concrete task Codex should execute for Hermes.',
                                },
                                mode: {
                                    type: 'string',
                                    enum: ['general', 'competitive_intelligence'],
                                    description: 'Optional execution profile. Use general for normal execution, research, private-data, artifact, calculation, or coding tasks. Use competitive_intelligence for competitor, market, traffic, SEO, keyword, backlink, acquisition, user, revenue, or growth analysis.',
                                },
                                expectedReturn: {
                                    type: 'string',
                                    description: 'Optional guidance for the shape of the return value. Natural language is allowed; do not force JSON unless Hermes needs it.',
                                },
                                hermesContext: {
                                    type: 'string',
                                    description: 'Optional Hermes-only background that Codex needs for this task. Keep it focused and omit irrelevant conversational context.',
                                },
                            },
                            required: ['task'],
                            additionalProperties: false,
                        },
                    },
                ],
            });
            return;
        }
        if (method === 'tools/call') {
            const params = isRecord(message.params) ? message.params : {};
            const name = typeof params.name === 'string' ? params.name : '';
            const args = params.arguments;
            if (name !== TOOL_NAME) {
                this.sendResult(message.id, {
                    content: [{ type: 'text', text: `Unsupported tool: ${name || '<missing>'}` }],
                    isError: true,
                });
                return;
            }
            try {
                const text = await runCodexAgentTool(args);
                this.sendResult(message.id, {
                    content: [{ type: 'text', text }],
                    isError: false,
                });
            }
            catch (error) {
                const messageText = error instanceof Error ? error.message : String(error);
                log(`codex_agent failed: ${messageText}`);
                this.sendResult(message.id, {
                    content: [{ type: 'text', text: `Codex agent failed: ${messageText}` }],
                    isError: true,
                });
            }
            return;
        }
        if (message.id !== undefined && message.id !== null) {
            this.sendError(message.id, -32601, `Method not found: ${method}`);
        }
    }
    sendResult(id, result) {
        if (id === undefined || id === null)
            return;
        sendFrame({ jsonrpc: '2.0', id, result }, this.outputMode);
    }
    sendError(id, code, message) {
        if (id === undefined || id === null)
            return;
        sendFrame({ jsonrpc: '2.0', id, error: { code, message } }, this.outputMode);
    }
}
async function runCodexAgentTool(argumentsValue) {
    const toolArgs = parseCodexToolArgs(argumentsValue);
    const config = loadConfig();
    const runtime = readRuntimeEnv();
    const selectedModel = normalizeCodexModel(process.env.ALTSELFS_CODEX_MODEL?.trim() || config.codexModel);
    const modelSelection = resolveCodexModelSelection(config, selectedModel);
    const localEnvironmentDisabled = config.disableLocalEnvironmentForGeneral;
    const dynamicTools = await buildDynamicTools(config, runtime, modelSelection);
    const requestedMode = toolArgs.mode || normalizeCodexDelegationMode(runtime.selectedAgentProfileId) || 'general';
    const developerInstructions = buildCodexDeveloperInstructions();
    const noProxy = mergeNoProxy(process.env.NO_PROXY || process.env.no_proxy || '');
    const processEnv = buildCodexProcessEnv(config, modelSelection, noProxy);
    let openAiAuth;
    let client;
    let finalText = '';
    let assistantBuffer = '';
    let codexThreadId = '';
    let resumed = false;
    try {
        if (modelSelection.provider === 'openai') {
            openAiAuth = await prepareTemporaryOpenAiAuth({
                codexHome: runtime.codexHome,
                sourcePath: config.codexOpenAiAuthJsonPath,
                label: runtime.runId,
            });
        }
        client = new CodexJsonRpcClient({
            codexBin: config.codexBin,
            codexHome: runtime.codexHome,
            env: processEnv,
        });
        const activeClient = client;
        await activeClient.initialize({
            clientName: 'altselfs-codex-mcp',
            clientTitle: 'Altselfs Codex MCP Tool',
            clientVersion: '0.1.0',
        });
        const sandboxExecContext = {
            userId: runtime.userId,
            threadId: runtime.threadId,
            runId: runtime.runId,
            workspace: runtime.workspace,
        };
        const personalToolContext = {
            userId: runtime.userId,
            investorId: runtime.investorId,
            threadId: runtime.threadId,
            runId: runtime.runId,
        };
        activeClient.on('serverRequest', (request) => {
            handleCodexServerRequest(activeClient, request, config, sandboxExecContext, personalToolContext).catch((error) => {
                const requestId = request.id;
                const message = error instanceof Error ? error.message : String(error);
                activeClient.respondError(requestId, -32000, message);
            });
        });
        activeClient.on('notification', (notification) => {
            const projected = projectCodexNotification(notification);
            if (projected.assistantDelta)
                assistantBuffer += projected.assistantDelta;
            if (projected.finalText)
                finalText = projected.finalText;
            emitTiming('codex.mcp.notification', {
                method: String(notification.method || ''),
                projected: Boolean(projected.finalText || projected.assistantDelta || projected.istoolIteration),
            });
        });
        const state = await readState(runtime.statePath);
        const previousThreadId = typeof state.codexSessionId === 'string' ? state.codexSessionId.trim() : '';
        if (previousThreadId) {
            try {
                const resumedThread = await activeClient.request('thread/resume', {
                    threadId: previousThreadId,
                    cwd: runtime.workspace,
                    runtimeWorkspaceRoots: [runtime.workspace],
                    ...(localEnvironmentDisabled ? { environments: [] } : {}),
                    ...(modelSelection.model ? { model: modelSelection.model } : {}),
                    ...(modelSelection.provider ? { modelProvider: modelSelection.provider } : {}),
                    developerInstructions,
                    personality: 'pragmatic',
                    excludeTurns: true,
                }, 20_000);
                codexThreadId = extractThreadId(resumedThread, 'thread/resume');
                resumed = true;
            }
            catch (error) {
                await writeStatePatch(runtime.statePath, {
                    previousCodexSessionId: previousThreadId,
                    codexResumeFailedAt: nowIso(),
                    codexResumeError: error instanceof Error ? error.message : String(error),
                });
            }
        }
        if (!codexThreadId) {
            const startedThread = await activeClient.request('thread/start', {
                cwd: runtime.workspace,
                runtimeWorkspaceRoots: [runtime.workspace],
                ...(localEnvironmentDisabled ? { environments: [] } : {}),
                dynamicTools: dynamicTools.tools,
                ...(modelSelection.model ? { model: modelSelection.model } : {}),
                ...(modelSelection.provider ? { modelProvider: modelSelection.provider } : {}),
                developerInstructions,
                personality: 'pragmatic',
            }, 20_000);
            codexThreadId = extractThreadId(startedThread, 'thread/start');
        }
        await writeStatePatch(runtime.statePath, {
            codexSessionId: codexThreadId,
            codexSessionResumed: resumed,
            codexHome: runtime.codexHome,
            codexWorkspace: runtime.workspace,
            codexDynamicToolNames: dynamicTools.names,
            codexModel: modelSelection.model || null,
            codexModelProvider: modelSelection.provider || null,
            lastCodexToolCallAt: nowIso(),
        });
        const turn = await activeClient.request('turn/start', {
            threadId: codexThreadId,
            input: [{ type: 'text', text: buildCodexTaskPrompt(toolArgs, runtime) }],
            cwd: runtime.workspace,
            runtimeWorkspaceRoots: [runtime.workspace],
            ...(localEnvironmentDisabled ? { environments: [] } : {}),
            responsesapiClientMetadata: {
                altselfs_run_id: runtime.runId,
                altselfs_thread_id: runtime.threadId,
                altselfs_codex_mode: requestedMode,
            },
        }, 20_000);
        emitTiming('codex.mcp.turn_started', { codexThreadId, raw: truncate(JSON.stringify(turn), 2000) });
        await waitForTurnCompletion(activeClient);
        const reply = normalizeAssistantReply(finalText || assistantBuffer || 'Codex completed the delegated task without a final message.');
        await writeStatePatch(runtime.statePath, {
            codexSessionId: codexThreadId,
            lastCodexToolCompletedAt: nowIso(),
            lastCodexToolMode: requestedMode,
        });
        return reply;
    }
    finally {
        client?.close();
        if (openAiAuth) {
            await openAiAuth.release().catch((error) => {
                log(`OpenAI temporary auth cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
    }
}
async function buildDynamicTools(config, runtime, selection) {
    const tools = [];
    if (selection.provider !== 'openai' && process.env.ALTSELFS_CODEX_WEB_SEARCH_DYNAMIC_TOOL !== '0') {
        tools.push(createWebSearchDynamictool());
    }
    if (config.sandboxExecEnabled && process.env.ALTSELFS_CODEX_SANDBOX_EXEC_DYNAMIC_TOOL !== '0') {
        tools.push(createSandboxExecDynamictool());
    }
    const enabledSources = filterByConnectorScope(runtime.enabledInfoSources, runtime.connectorScope.enabledConnectorKeys);
    if (enabledSources.length > 0) {
        tools.push(...createRapidApiCompetitorDynamictools(enabledSources));
    }
    const personalTools = await createPersonalDataDynamictools(config, {
        investorId: runtime.investorId,
        userId: runtime.userId,
        enabledProviders: runtime.connectorScope.personalProviderKeys,
        enabledConnectionIds: runtime.connectorScope.enabledConnectionIds,
    });
    tools.push(...personalTools);
    return {
        tools,
        names: tools.map(readDynamicToolName).filter(Boolean),
    };
}
async function handleCodexServerRequest(client, request, config, sandboxExecContext, personalToolContext) {
    const method = String(request.method || '');
    const requestId = request.id;
    if (method === 'item/tool/call') {
        const params = isRecord(request.params) ? request.params : {};
        const namespace = typeof params.namespace === 'string' ? params.namespace : '';
        const tool = typeof params.tool === 'string' ? params.tool : '';
        if ((!namespace && tool === 'altselfs_web_search') || (namespace === 'altselfs' && tool === 'web_search')) {
            const resultText = await runWebSearchtool(params.arguments, config);
            client.respond(requestId, { contentItems: [{ type: 'inputText', text: resultText }], success: true });
            return;
        }
        if (!namespace && isRapidApiCompetitortool(tool)) {
            const resultText = await runRapidApiCompetitortool(tool, params.arguments, config);
            client.respond(requestId, { contentItems: [{ type: 'inputText', text: resultText }], success: true });
            return;
        }
        if (!namespace && isPersonalDatatool(tool)) {
            const resultText = await runPersonalDatatool(tool, params.arguments, config, personalToolContext);
            client.respond(requestId, {
                contentItems: [{ type: 'inputText', text: resultText }],
                success: !resultText.includes('"error"'),
            });
            return;
        }
        if ((!namespace && isSandboxExectool(tool)) || (namespace === 'altselfs' && tool === 'sandbox_exec')) {
            const resultText = await runSandboxExectool(params.arguments, config, sandboxExecContext);
            client.respond(requestId, {
                contentItems: [{ type: 'inputText', text: resultText }],
                success: !resultText.includes('"error"'),
            });
            return;
        }
        client.respond(requestId, {
            contentItems: [{ type: 'inputText', text: `Unsupported dynamic tool: ${namespace}.${tool}` }],
            success: false,
        });
        return;
    }
    if (method === 'item/permissions/requestApproval') {
        client.respond(requestId, { decision: 'decline' });
        return;
    }
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
        client.respond(requestId, { decision: 'decline' });
        return;
    }
    client.respondError(requestId, -32601, `Unsupported server request: ${method}`);
}
function parseCodexToolArgs(value) {
    if (!isRecord(value))
        throw new Error('codex_agent arguments must be an object.');
    const task = typeof value.task === 'string' ? value.task.trim() : '';
    if (!task)
        throw new Error('codex_agent requires a non-empty task.');
    const mode = parseCodexDelegationMode(value.mode);
    return {
        task,
        mode,
        expectedReturn: typeof value.expectedReturn === 'string' ? value.expectedReturn.trim() : undefined,
        hermesContext: typeof value.hermesContext === 'string' ? value.hermesContext.trim() : undefined,
    };
}
function parseCodexDelegationMode(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string') {
        throw new Error('codex_agent mode must be either "general" or "competitive_intelligence".');
    }
    const mode = normalizeCodexDelegationMode(value);
    if (!mode) {
        throw new Error(`Unsupported codex_agent mode "${value}". Use "general" or "competitive_intelligence".`);
    }
    return mode;
}
function normalizeCodexDelegationMode(value) {
    const normalized = value?.trim().toLowerCase().replace(/-/g, '_');
    if (!normalized)
        return undefined;
    if (normalized === 'general' || normalized === 'codex_general')
        return 'general';
    if (normalized === 'competitive_intelligence' || normalized === 'codex_competitive_intelligence') {
        return 'competitive_intelligence';
    }
    return undefined;
}
function readRuntimeEnv() {
    const connectorScope = parseConnectorScope(process.env.ALTSELFS_CONNECTOR_SCOPE_JSON);
    const enabledInfoSources = parseEnabledInfoSources(process.env.ALTSELFS_ENABLED_INFO_SOURCES_JSON);
    return {
        runId: process.env.ALTSELFS_RUN_ID || 'run',
        userId: process.env.ALTSELFS_USER_ID || 'anonymous',
        investorId: process.env.ALTSELFS_INVESTOR_ID || process.env.ALTSELFS_USER_ID || 'anonymous',
        threadId: process.env.ALTSELFS_THREAD_ID || 'default',
        workspace: requireEnv('ALTSELFS_WORKSPACE'),
        codexHome: process.env.ALTSELFS_CODEX_HOME || process.env.CODEX_HOME || requireEnv('CODEX_HOME'),
        statePath: process.env.ALTSELFS_STATE_PATH || '',
        selectedAgentProfileId: process.env.ALTSELFS_SELECTED_AGENT_PROFILE_ID || '',
        connectorScope,
        enabledInfoSources,
    };
}
function buildCodexTaskPrompt(args, runtime) {
    const mode = args.mode || normalizeCodexDelegationMode(runtime.selectedAgentProfileId) || 'general';
    return [
        'Hermes delegated the following step to Codex.',
        'Return useful results to Hermes. Natural language is allowed. Do not force structured output unless Hermes explicitly requested it.',
        'Hermes remains responsible for the final user-facing answer.',
        '',
        `Altselfs thread: ${runtime.threadId}`,
        `Delegation mode: ${mode}`,
        args.expectedReturn ? `Expected return: ${args.expectedReturn}` : '',
        args.hermesContext ? `<hermes_context>\n${args.hermesContext}\n</hermes_context>` : '',
        '',
        'Task:',
        args.task,
    ].filter(Boolean).join('\n');
}
function buildCodexDeveloperInstructions() {
    return [
        'You are Codex under Hermes. Hermes is the cognitive and user-facing loop; you are the execution agent.',
        'Use your native Codex session memory and JSONL continuity for execution context. Do not assume Hermes-only chat context unless Hermes included it in the task.',
        'Answer in the user language unless Hermes asks otherwise.',
        'Use available web research capabilities when public current facts are required. Prefer native provider web search when available; otherwise use a registered web-search tool if one is available.',
        'Use registered sandbox execution tools only when deterministic computation, parsing, or small workspace file transformations are truly needed. Keep commands scoped to the provided workspace.',
        'Never claim that you searched, read private accounts, used a platform, or called a tool unless the corresponding tool was actually called.',
        'Return the result to Hermes directly. Do not say you will call another tool after the turn ends; either call it or report the limitation.',
        'Use private personal-data tools only when the delegated task asks for private-channel content such as Gmail, Feishu/Lark, calendar, docs, messages, or connected accounts.',
        'For competitive intelligence tasks, use enabled competitor-data tools when relevant; label third-party estimates as estimates and separate facts, assumptions, and inference.',
        'For tasks that do not need external tools, reason directly and keep the response focused.',
    ].join('\n');
}
function waitForTurnCompletion(client) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('codex turn timed out after 10 minutes'));
        }, 600_000);
        const onNotification = (notification) => {
            if (notification.method !== 'turn/completed')
                return;
            const params = isRecord(notification.params) ? notification.params : {};
            const turn = isRecord(params.turn) ? params.turn : {};
            cleanup();
            if (String(turn.status || '') === 'failed') {
                reject(new Error(extractTurnErrorMessage(turn)));
                return;
            }
            resolve();
        };
        const onExit = (payload) => {
            cleanup();
            reject(new Error(`codex app-server exited during turn: ${JSON.stringify(payload)}`));
        };
        const cleanup = () => {
            clearTimeout(timeout);
            client.off('notification', onNotification);
            client.off('exit', onExit);
        };
        client.on('notification', onNotification);
        client.once('exit', onExit);
    });
}
function extractTurnErrorMessage(turn) {
    const error = isRecord(turn.error) ? turn.error : {};
    if (typeof error.message === 'string' && error.message.trim())
        return error.message;
    return `codex turn failed: ${JSON.stringify(turn).slice(0, 500)}`;
}
function extractThreadId(result, method) {
    const thread = result.thread;
    if (isRecord(thread) && typeof thread.id === 'string')
        return thread.id;
    if (typeof result.threadId === 'string')
        return result.threadId;
    if (typeof result.sessionId === 'string')
        return result.sessionId;
    throw new Error(`${method} returned no thread id: ${JSON.stringify(result).slice(0, 500)}`);
}
async function readState(statePath) {
    if (!statePath)
        return {};
    try {
        const parsed = JSON.parse(await fs.readFile(statePath, 'utf8'));
        return isRecord(parsed) ? parsed : {};
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return {};
        throw error;
    }
}
async function writeStatePatch(statePath, patch) {
    if (!statePath)
        return;
    const previous = await readState(statePath);
    const next = {
        ...previous,
        ...patch,
        updatedAt: nowIso(),
    };
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}
function readProtocolVersion(params) {
    if (!isRecord(params))
        return '';
    return typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
}
function sendFrame(payload, mode = 'content-length') {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    if (mode === 'jsonl') {
        process.stdout.write(`${body.toString('utf8')}\n`, 'utf8');
        return;
    }
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
    process.stdout.write(body);
}
function log(message) {
    process.stderr.write(`[altselfs-codex-mcp] ${message}\n`);
}
function emitTiming(event, payload) {
    if (process.env.ALTSELFS_CODEX_TIMING !== '1')
        return;
    log(`ALTSELFS_CODEX_TIMING ${JSON.stringify({ type: event, timestamp: nowIso(), payload })}`);
}
function readDynamicToolName(tool) {
    return isRecord(tool) && typeof tool.name === 'string' ? tool.name : '';
}
function parseConnectorScope(value) {
    const parsed = parseJson(value);
    const scope = isRecord(parsed) ? parsed : {};
    const enabledConnectorKeys = normalizeOptionalStringArray(scope.enabledConnectorKeys, true);
    const enabledConnectionIds = normalizeOptionalStringArray(scope.enabledConnectionIds, false);
    const personalProviderKeys = enabledConnectorKeys.filter((key) => key === 'gmail' || key === 'feishu' || key === 'meta');
    return { enabledConnectorKeys, enabledConnectionIds, personalProviderKeys };
}
function parseEnabledInfoSources(value) {
    const parsed = parseJson(value);
    const rawValues = Array.isArray(parsed) ? parsed : [];
    const names = rawValues
        .map((item) => {
        if (typeof item === 'string')
            return item;
        if (isRecord(item) && typeof item.provider === 'string')
            return item.provider;
        return '';
    })
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    const fromToolEnv = (process.env.ALTSELFS_CODEX_COMPETITOR_DYNAMIC_TOOLS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((toolName) => RAPIDAPI_COMPETITOR_TOOL_PROVIDER_NAMES[toolName] || toolName)
        .filter(Boolean);
    return Array.from(new Set([...names, ...fromToolEnv]));
}
function parseJson(value) {
    if (!value?.trim())
        return null;
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function normalizeOptionalStringArray(value, lowercase) {
    if (!Array.isArray(value))
        return [];
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
        return [];
    const allowed = new Set(enabledConnectorKeys);
    return values.filter((value) => allowed.has(value));
}
function requireEnv(key) {
    const value = process.env[key]?.trim();
    if (!value)
        throw new Error(`${key} is required for altselfs Codex MCP server.`);
    return value;
}
function resolveCodexModelSelection(config, model) {
    const configuredProvider = normalizeCodexProvider(process.env.ALTSELFS_CODEX_MODEL_PROVIDER || config.codexModelProvider);
    if (model === 'gpt-5.5')
        return { model, provider: 'openai' };
    if (model === 'deepseek/deepseek-v3.2')
        return { model, provider: 'openrouter' };
    return {
        model,
        provider: configuredProvider || (model ? 'openrouter' : undefined),
    };
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
function buildCodexProcessEnv(config, selection, noProxy) {
    if (selection.provider !== 'openai' || !config.codexOpenAiProxyUrl)
        return undefined;
    const proxyUrl = config.codexOpenAiProxyUrl;
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
function mergeNoProxy(value) {
    const entries = new Set(value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean));
    entries.add('127.0.0.1');
    entries.add('localhost');
    entries.add('::1');
    return Array.from(entries).join(',');
}
function normalizeAssistantReply(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return '';
    try {
        const parsed = JSON.parse(trimmed);
        const text = extractContentItemText(parsed);
        if (text)
            return text.trim();
    }
    catch {
        // Some model providers emit content item arrays as strings.
    }
    return trimmed;
}
function extractContentItemText(value) {
    if (typeof value === 'string')
        return value;
    if (!Array.isArray(value))
        return '';
    return value
        .map((item) => {
        if (typeof item === 'string')
            return item;
        if (!isRecord(item))
            return '';
        if (typeof item.text === 'string')
            return item.text;
        if (typeof item.content === 'string')
            return item.content;
        return '';
    })
        .filter(Boolean)
        .join('\n');
}
new McpStdioServer().start();
