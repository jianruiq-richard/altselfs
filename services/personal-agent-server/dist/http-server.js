import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { renderProductizationPage } from './productization-page.js';
import { isRecord } from './util.js';
import { runWebSearchtool } from './tools/web-search.js';
import { getRapidApiQuotaSnapshots, isRapidApiCompetitortool, runRapidApiCompetitortool } from './tools/rapidapi-competitor.js';
import { isPersonalDatatool, runPersonalDatatool } from './tools/personal-data.js';
import { runSandboxExectool } from './tools/sandbox-exec.js';
import { disablePersonalConnection, listPersonalConnections, upsertFeishuCliConnection, upsertFeishuOAuthConnection, upsertGmailOAuthConnection, upsertMetaOAuthConnection, updateFeishuConnectionFeaturePackages, } from './personal-data-store.js';
import { completeFeishuCliAuthorization, continueFeishuCliAuthorization, DEFAULT_FEISHU_CLI_FEATURE_PACKAGES, normalizeFeishuCliFeaturePackages, startFeishuCliAuthorization, } from './feishu-cli.js';
import { getAgentThreadRuntimeStatus, getAgentContextOpsUserUsage, persistAgentRunEvent, persistAgentTurnError, persistAgentTurnCancelled, persistAgentTurnInput, persistAgentTurnSuccess, touchAgentRunHeartbeat, } from './agent-context-store.js';
import { cancelActiveRun, getActiveRuntoolScope, isAgentRunCancelledError, listActiveRuns } from './run-control.js';
import { calculateDirectoryBytes, sanitizePathSegment } from './sandbox-runtime.js';
const ASYNC_TURN_POLL_INTERVAL_MS = 3000;
export function createHttpServer(agent, config, memoryReviewQueue) {
    return http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            if (req.method === 'GET' && url.pathname === '/healthz') {
                return json(res, 200, {
                    ok: true,
                    runtimeStateMode: config?.runtimeStateMode,
                    sandboxStorageRoot: config?.sandboxStorageRoot,
                    sandboxExecEnabled: config?.sandboxExecEnabled,
                    sandboxExecImage: config?.sandboxExecImage,
                    sandboxExecNetworkEnabled: config?.sandboxExecNetworkEnabled,
                });
            }
            if (req.method === 'GET' && url.pathname === '/productization') {
                if (!config)
                    return json(res, 500, { error: 'config missing' });
                const jobs = memoryReviewQueue ? await memoryReviewQueue.listRecent(50) : [];
                return html(res, 200, renderProductizationPage(config, jobs));
            }
            if (req.method === 'GET' && url.pathname === '/v1/memory-review/jobs') {
                const limit = Number(url.searchParams.get('limit') || 50);
                return json(res, 200, {
                    jobs: memoryReviewQueue ? await memoryReviewQueue.listRecent(Number.isFinite(limit) ? limit : 50) : [],
                });
            }
            if (req.method === 'GET' && url.pathname === '/internal/ops/snapshot') {
                if (!config)
                    return json(res, 500, { error: 'config missing' });
                if (!isOpsAuthorized(req))
                    return json(res, 403, { error: 'Forbidden' });
                const jobs = memoryReviewQueue ? await memoryReviewQueue.listRecent(100) : [];
                return json(res, 200, await buildOpsSnapshot(config, jobs));
            }
            if (req.method === 'GET' && url.pathname === '/internal/personal-data/accounts') {
                if (!config)
                    return json(res, 500, { error: 'config missing' });
                if (!isOpsAuthorized(req))
                    return json(res, 403, { error: 'Forbidden' });
                const investorId = url.searchParams.get('investorId')?.trim() || '';
                if (!investorId)
                    return json(res, 400, { error: 'investorId is required' });
                const userId = url.searchParams.get('userId')?.trim() || undefined;
                const provider = url.searchParams.get('provider')?.trim().toLowerCase() || undefined;
                const accounts = await listPersonalConnections(config, { investorId, userId, provider });
                return json(res, 200, { accounts: accounts.map(publicPersonalConnection) });
            }
            if (req.method === 'POST' && url.pathname === '/internal/personal-data/oauth-connection') {
                if (!config)
                    return json(res, 500, { error: 'config missing' });
                if (!isOpsAuthorized(req))
                    return json(res, 403, { error: 'Forbidden' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const provider = typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : '';
                const token = isRecord(body.token) ? body.token : {};
                if (provider === 'gmail') {
                    const account = await upsertGmailOAuthConnection(config, {
                        investorId: readRequiredBodyString(body, 'investorId'),
                        userId: readRequiredBodyString(body, 'userId'),
                        accountEmail: readRequiredBodyString(body, 'accountEmail'),
                        accountName: typeof body.accountName === 'string' ? body.accountName : undefined,
                        token: {
                            accessToken: readRequiredBodyString(token, 'accessToken'),
                            refreshToken: typeof token.refreshToken === 'string' ? token.refreshToken : undefined,
                            tokenType: typeof token.tokenType === 'string' ? token.tokenType : undefined,
                            scope: typeof token.scope === 'string' ? token.scope : undefined,
                            expiresIn: typeof token.expiresIn === 'number' ? token.expiresIn : null,
                        },
                        profile: isRecord(body.profile) ? body.profile : undefined,
                    });
                    return json(res, 200, { ok: true, account: account ? publicPersonalConnection(account) : null });
                }
                if (provider === 'feishu') {
                    const account = await upsertFeishuOAuthConnection(config, {
                        investorId: readRequiredBodyString(body, 'investorId'),
                        userId: readRequiredBodyString(body, 'userId'),
                        accountId: readRequiredBodyString(body, 'accountId'),
                        accountName: typeof body.accountName === 'string' ? body.accountName : undefined,
                        token: {
                            accessToken: readRequiredBodyString(token, 'accessToken'),
                            refreshToken: typeof token.refreshToken === 'string' ? token.refreshToken : undefined,
                            tokenType: typeof token.tokenType === 'string' ? token.tokenType : undefined,
                            scope: typeof token.scope === 'string' ? token.scope : undefined,
                            expiresIn: typeof token.expiresIn === 'number' ? token.expiresIn : null,
                        },
                        profile: isRecord(body.profile) ? body.profile : undefined,
                    });
                    return json(res, 200, { ok: true, account: account ? publicPersonalConnection(account) : null });
                }
                if (provider === 'meta') {
                    const account = await upsertMetaOAuthConnection(config, {
                        investorId: readRequiredBodyString(body, 'investorId'),
                        userId: readRequiredBodyString(body, 'userId'),
                        accountId: readRequiredBodyString(body, 'accountId'),
                        accountName: typeof body.accountName === 'string' ? body.accountName : undefined,
                        accountEmail: typeof body.accountEmail === 'string' ? body.accountEmail : undefined,
                        token: {
                            accessToken: readRequiredBodyString(token, 'accessToken'),
                            tokenType: typeof token.tokenType === 'string' ? token.tokenType : undefined,
                            scope: typeof token.scope === 'string' ? token.scope : undefined,
                            expiresIn: typeof token.expiresIn === 'number' ? token.expiresIn : null,
                        },
                        profile: isRecord(body.profile) ? body.profile : undefined,
                        pages: Array.isArray(body.pages) ? body.pages : [],
                        instagramAccounts: Array.isArray(body.instagramAccounts) ? body.instagramAccounts : [],
                    });
                    return json(res, 200, { ok: true, account: account ? publicPersonalConnection(account) : null });
                }
                return json(res, 400, { error: `Unsupported personal data provider: ${provider}` });
            }
            if (req.method === 'POST' && url.pathname === '/internal/personal-data/feishu-cli/start') {
                if (!config)
                    return json(res, 500, { error: 'config missing' });
                if (!isOpsAuthorized(req))
                    return json(res, 403, { error: 'Forbidden' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const started = await startFeishuCliAuthorization(config, {
                    investorId: readRequiredBodyString(body, 'investorId'),
                    userId: readRequiredBodyString(body, 'userId'),
                    featurePackages: Array.isArray(body.featurePackages) ? body.featurePackages : undefined,
                });
                return json(res, 200, { ok: true, ...started });
            }
            if (req.method === 'POST' && url.pathname === '/internal/personal-data/feishu-cli/complete') {
                if (!config)
                    return json(res, 500, { error: 'config missing' });
                if (!isOpsAuthorized(req))
                    return json(res, 403, { error: 'Forbidden' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const completed = await completeFeishuCliAuthorization(config, {
                    investorId: readRequiredBodyString(body, 'investorId'),
                    sessionId: typeof body.sessionId === 'string' ? body.sessionId.trim() : undefined,
                    profileName: typeof body.profileName === 'string' ? body.profileName : undefined,
                    deviceCode: typeof body.deviceCode === 'string' ? body.deviceCode : undefined,
                });
                const account = await upsertFeishuCliConnection(config, {
                    investorId: readRequiredBodyString(body, 'investorId'),
                    userId: readRequiredBodyString(body, 'userId'),
                    accountId: completed.accountId,
                    accountName: completed.displayName,
                    profileName: completed.profileName,
                    profileSnapshot: completed.profileSnapshot,
                    scopes: completed.scopes,
                    featurePackages: completed.requestedFeaturePackages || (Array.isArray(body.featurePackages) ? body.featurePackages : undefined),
                });
                return json(res, 200, { ok: true, account: account ? publicPersonalConnection(account) : null });
            }
            if (req.method === 'POST' && url.pathname === '/internal/personal-data/feishu-cli/continue') {
                if (!config)
                    return json(res, 500, { error: 'config missing' });
                if (!isOpsAuthorized(req))
                    return json(res, 403, { error: 'Forbidden' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const advanced = await continueFeishuCliAuthorization(config, {
                    investorId: readRequiredBodyString(body, 'investorId'),
                    sessionId: readRequiredBodyString(body, 'sessionId'),
                });
                console.info('[feishu-cli] continue', {
                    phase: typeof advanced.phase === 'string' ? advanced.phase : null,
                    setupComplete: advanced.setupComplete === true,
                    hasAuthUrl: typeof advanced.authUrl === 'string' && advanced.authUrl.length > 0,
                    hasCompleted: isRecord(advanced.completed),
                });
                if (isRecord(advanced.completed)) {
                    const completed = advanced.completed;
                    const account = await upsertFeishuCliConnection(config, {
                        investorId: readRequiredBodyString(body, 'investorId'),
                        userId: readRequiredBodyString(body, 'userId'),
                        accountId: completed.accountId,
                        accountName: completed.displayName,
                        profileName: completed.profileName,
                        profileSnapshot: completed.profileSnapshot,
                        scopes: completed.scopes,
                        featurePackages: completed.requestedFeaturePackages || (Array.isArray(body.featurePackages) ? body.featurePackages : undefined),
                    });
                    return json(res, 200, { ok: true, phase: 'connected', account: account ? publicPersonalConnection(account) : null });
                }
                return json(res, 200, { ok: true, ...advanced });
            }
            if (req.method === 'PATCH' && url.pathname === '/internal/personal-data/feishu-cli/feature-packages') {
                if (!config)
                    return json(res, 500, { error: 'config missing' });
                if (!isOpsAuthorized(req))
                    return json(res, 403, { error: 'Forbidden' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const account = await updateFeishuConnectionFeaturePackages(config, {
                    investorId: readRequiredBodyString(body, 'investorId'),
                    userId: typeof body.userId === 'string' ? body.userId.trim() : undefined,
                    connectionId: readRequiredBodyString(body, 'connectionId'),
                    featurePackages: Array.isArray(body.featurePackages) ? body.featurePackages : [],
                });
                return json(res, account ? 200 : 404, account ? { ok: true, account: publicPersonalConnection(account) } : { error: 'Connection not found' });
            }
            if (req.method === 'DELETE' && url.pathname === '/internal/personal-data/connections') {
                if (!config)
                    return json(res, 500, { error: 'config missing' });
                if (!isOpsAuthorized(req))
                    return json(res, 403, { error: 'Forbidden' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const ok = await disablePersonalConnection(config, {
                    investorId: readRequiredBodyString(body, 'investorId'),
                    userId: typeof body.userId === 'string' ? body.userId.trim() : undefined,
                    connectionId: readRequiredBodyString(body, 'connectionId'),
                });
                return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Connection not found' });
            }
            if (req.method === 'GET' && url.pathname === '/v1/threads/status') {
                if (!config)
                    return json(res, 500, { error: 'config missing' });
                const threadId = url.searchParams.get('threadId')?.trim() || '';
                if (!threadId)
                    return json(res, 400, { error: 'threadId is required' });
                const status = await getAgentThreadRuntimeStatus(config, {
                    threadId,
                    investorId: url.searchParams.get('investorId')?.trim() || undefined,
                    userId: url.searchParams.get('userId')?.trim() || undefined,
                    recentEventLimit: Number(url.searchParams.get('recentEventLimit') || 20),
                });
                return json(res, 200, {
                    ...status,
                    activeRuns: listActiveRuns().filter((run) => run.threadId === threadId),
                });
            }
            if (req.method === 'POST' && url.pathname === '/v1/runs/stop') {
                if (!config)
                    return json(res, 500, { error: 'config missing' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
                if (!runId)
                    return json(res, 400, { error: 'runId is required' });
                const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : undefined;
                const cancelled = cancelActiveRun(runId);
                await persistAgentTurnCancelled(config, {
                    runId,
                    threadId: threadId || (typeof cancelled.threadId === 'string' ? cancelled.threadId : undefined),
                    investorId: typeof body.investorId === 'string' ? body.investorId : undefined,
                    userId: typeof body.userId === 'string' ? body.userId : undefined,
                    reason: 'cancelled by user',
                }).catch(() => null);
                return json(res, 200, {
                    ok: true,
                    ...cancelled,
                });
            }
            if (req.method === 'POST' && url.pathname === '/internal/tools/web-search') {
                if (!config)
                    return json(res, 500, { error: 'tool bridge config missing' });
                if (!isLoopbackRequest(req))
                    return json(res, 403, { error: 'Forbidden' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const resultText = await runWebSearchtool(body, config);
                return json(res, 200, {
                    contentItems: [{ type: 'inputText', text: resultText }],
                    success: !resultText.includes('"error"'),
                });
            }
            if (req.method === 'POST' && url.pathname === '/internal/tools/read-artifact') {
                if (!config)
                    return json(res, 500, { error: 'tool bridge config missing' });
                if (!isLoopbackRequest(req))
                    return json(res, 403, { error: 'Forbidden' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const resultText = await runReadArtifacttool(body, config);
                return json(res, 200, {
                    contentItems: [{ type: 'inputText', text: resultText }],
                    success: !resultText.includes('"error"'),
                });
            }
            if (req.method === 'POST' && url.pathname === '/internal/tools/rapidapi-competitor') {
                if (!config)
                    return json(res, 500, { error: 'tool bridge config missing' });
                if (!isLoopbackRequest(req))
                    return json(res, 403, { error: 'Forbidden' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const toolName = typeof body.toolName === 'string' ? body.toolName.trim() : '';
                if (!isRapidApiCompetitortool(toolName))
                    return json(res, 400, { error: `Unsupported competitor data tool: ${toolName}` });
                const resultText = await runRapidApiCompetitortool(toolName, body.arguments, config);
                return json(res, 200, {
                    contentItems: [{ type: 'inputText', text: resultText }],
                    success: !resultText.includes('"error"'),
                });
            }
            if (req.method === 'POST' && url.pathname === '/internal/tools/personal-data') {
                if (!config)
                    return json(res, 500, { error: 'tool bridge config missing' });
                if (!isLoopbackRequest(req))
                    return json(res, 403, { error: 'Forbidden' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const toolName = typeof body.toolName === 'string' ? body.toolName.trim() : '';
                if (!isPersonalDatatool(toolName))
                    return json(res, 400, { error: `Unsupported personal data tool: ${toolName}` });
                const context = isRecord(body._context) ? body._context : {};
                const investorId = readRequiredBodyString(context, 'investorId');
                const runId = typeof context.runId === 'string' && context.runId.trim() ? context.runId.trim() : undefined;
                const runtoolScope = runId ? getActiveRuntoolScope(runId) : null;
                if (runtoolScope?.personalDatatoolNames && !runtoolScope.personalDatatoolNames.includes(toolName)) {
                    return json(res, 200, {
                        contentItems: [
                            {
                                type: 'inputText',
                                text: JSON.stringify({
                                    source: 'personal-data-tools',
                                    error: `Personal data tool ${toolName} is not enabled for this turn by connector selection.`,
                                    toolName,
                                    enabledtools: runtoolScope.personalDatatoolNames,
                                }, null, 2),
                            },
                        ],
                        success: false,
                    });
                }
                const resultText = await runPersonalDatatool(toolName, body.arguments, config, {
                    investorId,
                    userId: typeof context.userId === 'string' && context.userId.trim() ? context.userId.trim() : investorId,
                    threadId: typeof context.threadId === 'string' && context.threadId.trim() ? context.threadId.trim() : undefined,
                    runId,
                });
                return json(res, 200, {
                    contentItems: [{ type: 'inputText', text: resultText }],
                    success: !resultText.includes('"error"'),
                });
            }
            if (req.method === 'POST' && url.pathname === '/internal/tools/sandbox-exec') {
                if (!config)
                    return json(res, 500, { error: 'tool bridge config missing' });
                if (!isLoopbackRequest(req))
                    return json(res, 403, { error: 'Forbidden' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const { argumentsValue, context } = parseSandboxExecBridgeBody(body);
                const resultText = await runSandboxExectool(argumentsValue, config, context);
                return json(res, 200, {
                    contentItems: [{ type: 'inputText', text: resultText }],
                    success: !resultText.includes('"error"'),
                });
            }
            if (req.method === 'POST' && url.pathname === '/v1/turns/start') {
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                const turnRequest = parseTurnStartRequest(body);
                if (url.searchParams.get('stream') === '1') {
                    return streamTurnStart(res, agent, turnRequest, config);
                }
                let persisted = null;
                try {
                    if (!config)
                        throw new Error('config missing');
                    persisted = await persistAgentTurnInput(config, turnRequest);
                    let eventIndex = 0;
                    const result = await agent.startTurn({
                        ...turnRequest,
                        metadata: {
                            ...(turnRequest.metadata || {}),
                            runId: persisted.runId,
                            currentMessageId: persisted.userMessageId,
                        },
                        onEvent: async (event) => {
                            const index = eventIndex;
                            eventIndex += 1;
                            await persistAgentRunEvent(config, { runId: persisted.runId, event, index }).catch(() => null);
                        },
                    });
                    await persistAgentTurnSuccess(config, persisted, {
                        threadId: result.threadId,
                        route: result.route,
                        reply: result.reply,
                        events: result.events,
                        raw: 'raw' in result ? result.raw : undefined,
                    });
                    const responseResult = { ...result, runId: persisted.runId };
                    if (url.searchParams.get('format') === 'text') {
                        return text(res, 200, responseResult.reply);
                    }
                    const includeEvents = body.includeEvents === true || url.searchParams.get('debug') === '1';
                    return json(res, 200, includeEvents ? responseResult : { ...responseResult, events: [] });
                }
                catch (error) {
                    if (config) {
                        if (isAgentRunCancelledError(error) && persisted) {
                            await persistAgentTurnCancelled(config, {
                                runId: persisted.runId,
                                threadId: turnRequest.threadId,
                                investorId: persisted.investorId,
                                userId: turnRequest.userId,
                                reason: 'cancelled by user',
                            }).catch(() => null);
                        }
                        else {
                            await persistAgentTurnError(config, persisted, {
                                threadId: turnRequest.threadId,
                                error: error instanceof Error ? error.message : String(error),
                            }).catch(() => null);
                        }
                    }
                    if (isAgentRunCancelledError(error)) {
                        return json(res, 499, {
                            error: 'Run stopped by user.',
                            cancelled: true,
                            runId: persisted?.runId,
                        });
                    }
                    throw error;
                }
            }
            if (req.method === 'POST' && url.pathname === '/v1/turns/start-async') {
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                if (!config)
                    return json(res, 500, { error: 'config missing' });
                const turnRequest = parseTurnStartRequest(body);
                const persisted = await persistAgentTurnInput(config, turnRequest, {
                    status: 'QUEUED',
                    storeExecutionRequest: true,
                });
                if (persisted.status && persisted.status !== 'QUEUED') {
                    return json(res, 202, {
                        runId: persisted.runId,
                        threadId: turnRequest.threadId || null,
                        status: persisted.status || 'QUEUED',
                        pollIntervalMs: ASYNC_TURN_POLL_INTERVAL_MS,
                        existing: true,
                    });
                }
                const startedEvent = {
                    type: 'agent_context.async_turn_started',
                    timestamp: new Date().toISOString(),
                    payload: {
                        runId: persisted.runId,
                        userMessageId: persisted.userMessageId,
                        warnings: persisted.warnings,
                    },
                };
                await persistAgentRunEvent(config, { runId: persisted.runId, event: startedEvent, index: 0 }).catch(() => null);
                return json(res, 202, {
                    runId: persisted.runId,
                    threadId: turnRequest.threadId || null,
                    status: persisted.status || 'QUEUED',
                    pollIntervalMs: ASYNC_TURN_POLL_INTERVAL_MS,
                });
            }
            if (req.method === 'POST' && url.pathname === '/openrouter-responses-proxy/v1/responses') {
                if (!config)
                    return json(res, 500, { error: 'proxy config missing' });
                const body = await readJsonBody(req);
                if (!isRecord(body))
                    return json(res, 400, { error: 'JSON body must be an object' });
                return openRouterResponsesProxy(res, config, body);
            }
            return json(res, 404, { error: 'Not found' });
        }
        catch (error) {
            return json(res, 500, {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
}
function parseTurnStartRequest(body) {
    return {
        userId: String(body.userId || ''),
        threadId: typeof body.threadId === 'string' ? body.threadId : undefined,
        message: String(body.message || ''),
        allowedAgents: Array.isArray(body.allowedAgents) ? body.allowedAgents.map(String) : undefined,
        metadata: isRecord(body.metadata) ? body.metadata : undefined,
    };
}
function streamTurnStart(res, agent, request, config) {
    let closed = false;
    const write = (payload) => {
        if (closed || res.destroyed)
            return;
        res.write(`${JSON.stringify(payload)}\n`);
    };
    res.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
    });
    const heartbeat = setInterval(() => {
        write({ type: 'heartbeat', timestamp: new Date().toISOString() });
    }, 15_000);
    res.on('close', () => {
        closed = true;
        clearInterval(heartbeat);
    });
    void (async () => {
        let persisted = null;
        let runHeartbeat = null;
        let eventIndex = 0;
        try {
            write({ type: 'turn_started', timestamp: new Date().toISOString() });
            if (!config)
                throw new Error('config missing');
            persisted = await persistAgentTurnInput(config, request);
            write({
                type: 'event',
                event: {
                    type: 'agent_context.input_persisted',
                    timestamp: new Date().toISOString(),
                    payload: {
                        runId: persisted.runId,
                        userMessageId: persisted.userMessageId,
                        warnings: persisted.warnings,
                    },
                },
            });
            write({
                type: 'run',
                runId: persisted.runId,
                threadId: request.threadId || null,
                timestamp: new Date().toISOString(),
            });
            runHeartbeat = setInterval(() => {
                void touchAgentRunHeartbeat(config, {
                    threadId: request.threadId || '',
                    runId: persisted?.runId || null,
                }).catch(() => null);
            }, 15_000);
            const result = await agent.startTurn({
                ...request,
                metadata: {
                    ...(request.metadata || {}),
                    runId: persisted.runId,
                    currentMessageId: persisted.userMessageId,
                },
                onEvent: async (event) => {
                    const index = eventIndex;
                    eventIndex += 1;
                    write({ type: 'event', event });
                    await persistAgentRunEvent(config, { runId: persisted.runId, event, index }).catch(() => null);
                },
            });
            clearInterval(runHeartbeat);
            runHeartbeat = null;
            await persistAgentTurnSuccess(config, persisted, {
                threadId: result.threadId,
                route: result.route,
                reply: result.reply,
                events: result.events,
                raw: 'raw' in result ? result.raw : undefined,
            });
            write({ type: 'final', result: { ...result, runId: persisted.runId, events: [] } });
        }
        catch (error) {
            if (config) {
                if (isAgentRunCancelledError(error) && persisted) {
                    await persistAgentTurnCancelled(config, {
                        runId: persisted.runId,
                        threadId: request.threadId,
                        investorId: persisted.investorId,
                        userId: request.userId,
                        reason: 'cancelled by user',
                    }).catch(() => null);
                }
                else {
                    await persistAgentTurnError(config, persisted, {
                        threadId: request.threadId,
                        error: error instanceof Error ? error.message : String(error),
                    }).catch(() => null);
                }
            }
            write({
                type: 'final',
                status: isAgentRunCancelledError(error) ? 499 : 500,
                result: {
                    runId: persisted?.runId,
                    cancelled: isAgentRunCancelledError(error),
                    error: isAgentRunCancelledError(error) ? 'Run stopped by user.' : error instanceof Error ? error.message : String(error),
                },
            });
        }
        finally {
            if (runHeartbeat)
                clearInterval(runHeartbeat);
            clearInterval(heartbeat);
            if (!closed) {
                closed = true;
                res.end();
            }
        }
    })();
}
async function openRouterResponsesProxy(res, config, body) {
    const apiKey = process.env[config.openRouterApiKeyEnv]?.trim();
    if (!apiKey)
        return json(res, 500, { error: `${config.openRouterApiKeyEnv} is missing` });
    const model = typeof body.model === 'string' && body.model.trim()
        ? body.model.trim()
        : config.codexModel || config.hermesModel;
    const messages = responsesBodyToChatMessages(body);
    console.log(`[openrouter-responses-proxy] request model=${model} messages=${messages.length} inputChars=${messages
        .map((message) => chatContentLength(message.content))
        .reduce((sum, length) => sum + length, 0)}`);
    if (body.stream === true) {
        return streamOpenRouterResponsesProxy(res, config, { model, messages, body });
    }
    const response = await fetch(`${config.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
            'x-title': config.openRouterAppTitle,
        },
        body: JSON.stringify({
            model,
            messages,
            temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
            ...openRouterFileParserOptions(messages),
            stream: false,
        }),
    });
    const raw = await response.text();
    if (!response.ok) {
        console.warn(`[openrouter-responses-proxy] upstream failed status=${response.status} body=${raw.slice(0, 500)}`);
        res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(raw || JSON.stringify({ error: `OpenRouter HTTP ${response.status}` }));
        return;
    }
    let text = '';
    try {
        const parsed = JSON.parse(raw);
        if (isRecord(parsed)) {
            const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
            const first = isRecord(choices[0]) ? choices[0] : {};
            const message = isRecord(first.message) ? first.message : {};
            text = extractOpenRouterMessageText(message.content);
            if (!text && typeof first.text === 'string')
                text = first.text;
        }
    }
    catch {
        text = raw;
    }
    console.log(`[openrouter-responses-proxy] upstream ok outputChars=${text.length} output=${JSON.stringify(text.slice(0, 200))}`);
    const responseId = `resp_${Date.now().toString(36)}`;
    const messageId = `msg_${Date.now().toString(36)}`;
    const events = [
        { type: 'response.created', response: { id: responseId } },
        {
            type: 'response.output_item.done',
            item: {
                type: 'message',
                role: 'assistant',
                id: messageId,
                content: [{ type: 'output_text', text }],
            },
        },
        {
            type: 'response.completed',
            response: { id: responseId },
        },
    ];
    res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
    });
    for (const event of events) {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
}
async function streamOpenRouterResponsesProxy(res, config, params) {
    const apiKey = process.env[config.openRouterApiKeyEnv]?.trim();
    if (!apiKey)
        return json(res, 500, { error: `${config.openRouterApiKeyEnv} is missing` });
    const responseId = `resp_${Date.now().toString(36)}`;
    const messageId = `msg_${Date.now().toString(36)}`;
    const createdAt = Math.floor(Date.now() / 1000);
    let sequence = 0;
    let text = '';
    const outputItem = {
        id: messageId,
        type: 'message',
        role: 'assistant',
        status: 'in_progress',
        content: [],
    };
    const responseSnapshot = (status) => ({
        id: responseId,
        object: 'response',
        created_at: createdAt,
        model: params.model,
        status,
        output: status === 'completed'
            ? [
                {
                    ...outputItem,
                    status: 'completed',
                    content: [{ type: 'output_text', text, annotations: [] }],
                },
            ]
            : [],
    });
    const writeSse = (event) => {
        res.write(`event: ${String(event.type || 'message')}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const nextSequence = () => {
        sequence += 1;
        return sequence;
    };
    res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
    });
    writeSse({
        type: 'response.created',
        sequence_number: nextSequence(),
        response: responseSnapshot('in_progress'),
    });
    writeSse({
        type: 'response.output_item.added',
        sequence_number: nextSequence(),
        output_index: 0,
        item: outputItem,
    });
    writeSse({
        type: 'response.content_part.added',
        sequence_number: nextSequence(),
        output_index: 0,
        content_index: 0,
        item_id: messageId,
        part: { type: 'output_text', text: '', annotations: [] },
    });
    try {
        const upstream = await fetch(`${config.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${apiKey}`,
                'x-title': config.openRouterAppTitle,
            },
            body: JSON.stringify({
                model: params.model,
                messages: params.messages,
                temperature: typeof params.body.temperature === 'number' ? params.body.temperature : undefined,
                ...openRouterFileParserOptions(params.messages),
                stream: true,
            }),
        });
        if (!upstream.ok || !upstream.body) {
            const raw = await upstream.text().catch(() => '');
            console.warn(`[openrouter-responses-proxy] streaming upstream failed status=${upstream.status} body=${raw.slice(0, 500)}`);
            writeSse({
                type: 'response.failed',
                sequence_number: nextSequence(),
                response: {
                    ...responseSnapshot('failed'),
                    error: {
                        code: `openrouter_http_${upstream.status}`,
                        message: raw || `OpenRouter HTTP ${upstream.status}`,
                    },
                },
            });
            return;
        }
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let doneSeen = false;
        const handleSseBlock = (block) => {
            const data = block
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.replace(/^data:\s?/, ''))
                .join('\n')
                .trim();
            if (!data)
                return;
            if (data === '[DONE]') {
                doneSeen = true;
                return;
            }
            let parsed;
            try {
                parsed = JSON.parse(data);
            }
            catch {
                return;
            }
            const delta = extractOpenRouterDeltaText(parsed);
            if (!delta)
                return;
            text += delta;
            writeSse({
                type: 'response.output_text.delta',
                sequence_number: nextSequence(),
                output_index: 0,
                content_index: 0,
                item_id: messageId,
                delta,
                logprobs: [],
            });
        };
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() || '';
            for (const block of blocks)
                handleSseBlock(block);
        }
        if (buffer.trim())
            handleSseBlock(buffer);
        if (!doneSeen) {
            console.warn('[openrouter-responses-proxy] streaming upstream ended without [DONE]');
        }
        const completedText = { type: 'output_text', text, annotations: [] };
        const completedItem = {
            ...outputItem,
            status: 'completed',
            content: [completedText],
        };
        writeSse({
            type: 'response.output_text.done',
            sequence_number: nextSequence(),
            output_index: 0,
            content_index: 0,
            item_id: messageId,
            text,
            logprobs: [],
        });
        writeSse({
            type: 'response.content_part.done',
            sequence_number: nextSequence(),
            output_index: 0,
            content_index: 0,
            item_id: messageId,
            part: completedText,
        });
        writeSse({
            type: 'response.output_item.done',
            sequence_number: nextSequence(),
            output_index: 0,
            item: completedItem,
        });
        writeSse({
            type: 'response.completed',
            sequence_number: nextSequence(),
            response: responseSnapshot('completed'),
        });
        console.log(`[openrouter-responses-proxy] streaming upstream ok outputChars=${text.length} output=${JSON.stringify(text.slice(0, 200))}`);
    }
    catch (error) {
        writeSse({
            type: 'response.failed',
            sequence_number: nextSequence(),
            response: {
                ...responseSnapshot('failed'),
                error: {
                    code: 'openrouter_stream_error',
                    message: error instanceof Error ? error.message : String(error),
                },
            },
        });
    }
    finally {
        res.end();
    }
}
function extractOpenRouterMessageText(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    return content
        .map((part) => {
        if (typeof part === 'string')
            return part;
        if (!isRecord(part))
            return '';
        if (typeof part.text === 'string')
            return part.text;
        if (typeof part.content === 'string')
            return part.content;
        if (typeof part.output_text === 'string')
            return part.output_text;
        return '';
    })
        .filter(Boolean)
        .join('\n');
}
function extractOpenRouterDeltaText(value) {
    if (!isRecord(value))
        return '';
    const choices = Array.isArray(value.choices) ? value.choices : [];
    const first = isRecord(choices[0]) ? choices[0] : {};
    const delta = isRecord(first.delta) ? first.delta : {};
    return extractOpenRouterMessageText(delta.content);
}
function responsesBodyToChatMessages(body) {
    const messages = [];
    if (typeof body.instructions === 'string' && body.instructions.trim()) {
        messages.push({ role: 'system', content: body.instructions });
    }
    const input = Array.isArray(body.input) ? body.input : [];
    for (const item of input) {
        if (!isRecord(item) || item.type !== 'message')
            continue;
        const role = item.role === 'assistant' ? 'assistant' : 'user';
        const content = Array.isArray(item.content)
            ? normalizeOpenRouterContentParts(item.content)
            : typeof item.content === 'string'
                ? item.content
                : '';
        if (typeof content === 'string' ? content.trim() : content.length > 0)
            messages.push({ role, content });
    }
    if (messages.length === 0)
        messages.push({ role: 'user', content: 'Continue.' });
    return messages;
}
function normalizeOpenRouterContentParts(parts) {
    const normalized = parts
        .map((part) => normalizeOpenRouterContentPart(part))
        .filter(Boolean);
    if (normalized.length === 0)
        return '';
    if (normalized.every((part) => part.type === 'text')) {
        return normalized
            .map((part) => (typeof part.text === 'string' ? part.text : ''))
            .filter(Boolean)
            .join('\n');
    }
    return normalized;
}
function normalizeOpenRouterContentPart(part) {
    if (typeof part === 'string')
        return { type: 'text', text: part };
    if (!isRecord(part))
        return null;
    if (typeof part.text === 'string')
        return { type: 'text', text: part.text };
    if (typeof part.input_text === 'string')
        return { type: 'text', text: part.input_text };
    if (part.type === 'input_text' && typeof part.text === 'string')
        return { type: 'text', text: part.text };
    const imageUrl = typeof part.image_url === 'string'
        ? part.image_url
        : isRecord(part.image_url) && typeof part.image_url.url === 'string'
            ? part.image_url.url
            : '';
    if ((part.type === 'input_image' || part.type === 'image' || part.type === 'image_url') && imageUrl) {
        return {
            type: 'image_url',
            image_url: { url: imageUrl },
        };
    }
    if (part.type === 'file' && isRecord(part.file)) {
        const fileData = typeof part.file.file_data === 'string'
            ? part.file.file_data
            : typeof part.file.fileData === 'string'
                ? part.file.fileData
                : '';
        if (!fileData)
            return null;
        return {
            type: 'file',
            file: {
                filename: typeof part.file.filename === 'string' ? part.file.filename : 'attachment',
                file_data: fileData,
            },
        };
    }
    const videoUrl = part.type === 'video_url'
        ? isRecord(part.videoUrl) && typeof part.videoUrl.url === 'string'
            ? part.videoUrl.url
            : typeof part.video_url === 'string'
                ? part.video_url
                : ''
        : '';
    if (videoUrl) {
        return {
            type: 'video_url',
            videoUrl: { url: videoUrl },
        };
    }
    return null;
}
function chatContentLength(content) {
    if (typeof content === 'string')
        return content.length;
    return content.reduce((sum, part) => sum + JSON.stringify(part).length, 0);
}
function openRouterFileParserOptions(messages) {
    const hasFile = messages.some((message) => {
        if (!Array.isArray(message.content))
            return false;
        return message.content.some((part) => part.type === 'file');
    });
    if (!hasFile)
        return {};
    return {
        plugins: [
            {
                id: 'file-parser',
                pdf: {
                    engine: process.env.OPENROUTER_MULTIMODAL_PDF_ENGINE || 'cloudflare-ai',
                },
            },
        ],
    };
}
function json(res, status, body) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
}
function text(res, status, body) {
    res.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(body);
}
function html(res, status, body) {
    res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(body);
}
function isLoopbackRequest(req) {
    const address = req.socket.remoteAddress || '';
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function isOpsAuthorized(req) {
    const token = process.env.OPS_AGENT_TOKEN?.trim();
    if (!token)
        return false;
    const authorization = req.headers.authorization || '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    const headerToken = Array.isArray(req.headers['x-ops-token']) ? req.headers['x-ops-token'][0] : req.headers['x-ops-token'];
    return bearer === token || headerToken === token;
}
function readRequiredBodyString(body, key) {
    const value = body[key];
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${key} is required`);
    return value.trim();
}
function publicPersonalConnection(connection) {
    return {
        connectionId: connection.id,
        provider: connection.provider,
        connectionType: connection.connectionType,
        accountEmail: connection.externalAccountId,
        displayName: connection.displayName,
        scopes: connection.scopes,
        featurePackages: connection.provider === 'feishu'
            ? (Object.prototype.hasOwnProperty.call(connection.metadata || {}, 'feature_packages')
                ? normalizeFeishuCliFeaturePackages(connection.metadata?.feature_packages, [])
                : normalizeFeishuCliFeaturePackages(connection.metadata?.feature_packages, connection.connectionType === 'lark_cli_user' ? DEFAULT_FEISHU_CLI_FEATURE_PACKAGES : []))
            : undefined,
        metadata: connection.provider === 'meta' ? publicMetaConnectionMetadata(connection.metadata || {}) : undefined,
        status: connection.status,
        updatedAt: connection.updatedAt,
    };
}
function publicMetaConnectionMetadata(metadata) {
    return {
        pageCount: typeof metadata.page_count === 'number' ? metadata.page_count : 0,
        instagramAccountCount: typeof metadata.instagram_account_count === 'number' ? metadata.instagram_account_count : 0,
        pages: Array.isArray(metadata.pages) ? metadata.pages.slice(0, 20) : [],
        instagramAccounts: Array.isArray(metadata.instagram_accounts) ? metadata.instagram_accounts.slice(0, 20) : [],
    };
}
async function buildOpsSnapshot(config, jobs) {
    const [resources, userResources, apiAccounts] = await Promise.all([
        Promise.all([
            diskResource('/', 'system disk'),
            diskResource(config.sandboxStorageRoot, 'sandbox storage root'),
            diskResource(config.workspaceRoot, 'codex workspace root'),
            diskResource(config.codexHomeRoot, 'codex home root'),
            diskResource(config.hermesHomeRoot, 'hermes home root'),
        ]),
        buildOpsUserResources(config),
        getRapidApiQuotaSnapshots().catch(() => []),
    ]);
    const jobCounts = jobs.reduce((acc, job) => {
        acc[job.status] = (acc[job.status] || 0) + 1;
        return acc;
    }, {});
    return {
        ok: true,
        collectedAt: new Date().toISOString(),
        env: config.env,
        processRole: config.processRole,
        storageBackend: config.storageBackend,
        runtimeStateMode: config.runtimeStateMode,
        sandboxStorageRoot: config.sandboxStorageRoot,
        memoryReview: {
            mode: config.memoryReviewMode,
            recentJobs: jobs.length,
            jobCounts,
        },
        resources: resources.filter(Boolean),
        userResources,
        apiAccounts,
    };
}
async function buildOpsUserResources(config) {
    const [diskRows, rdsRows] = await Promise.all([
        getOpsUserDiskUsage(config).catch(() => []),
        getAgentContextOpsUserUsage(config).catch(() => []),
    ]);
    const byKey = new Map();
    for (const row of rdsRows) {
        const key = row.investorId || row.userId;
        if (!key)
            continue;
        byKey.set(key, {
            userId: row.userId,
            investorId: row.investorId,
            ecsDiskBytes: row.diskBytes,
            agentRdsBytes: row.rdsBytes,
            agentMessages: row.messages,
            agentArtifacts: row.artifacts,
            agentRuns: row.runs,
            agentThreads: row.threads,
        });
    }
    for (const row of diskRows) {
        const matched = findUserResourceByDiskSegment(byKey, row.userId);
        const key = matched?.key || row.userId;
        if (!key)
            continue;
        const existing = matched?.value || byKey.get(key) || {
            userId: row.userId,
            investorId: '',
            ecsDiskBytes: 0,
            agentRdsBytes: 0,
            agentMessages: 0,
            agentArtifacts: 0,
            agentRuns: 0,
            agentThreads: 0,
        };
        existing.ecsDiskBytes = Math.max(existing.ecsDiskBytes, row.bytes);
        byKey.set(key, existing);
    }
    return Array.from(byKey.values()).sort((a, b) => (b.ecsDiskBytes + b.agentRdsBytes) - (a.ecsDiskBytes + a.agentRdsBytes)).slice(0, 200);
}
function findUserResourceByDiskSegment(resources, segment) {
    for (const [key, value] of resources.entries()) {
        if (value.userId && sanitizePathSegment(value.userId) === segment)
            return { key, value };
    }
    return null;
}
async function getOpsUserDiskUsage(config) {
    const roots = config.runtimeStateMode === 'sandbox'
        ? [path.join(config.sandboxStorageRoot, 'users')]
        : [config.workspaceRoot, config.hermesWorkspaceRoot, config.codexHomeRoot, config.hermesHomeRoot];
    const rows = [];
    for (const root of roots) {
        const entries = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
            if (error.code === 'ENOENT')
                return [];
            throw error;
        });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const userId = entry.name;
            const bytes = await calculateDirectoryBytes(path.join(root, userId)).catch(() => 0);
            rows.push({ userId, bytes });
        }
    }
    return rows;
}
async function diskResource(pathname, label) {
    try {
        const stat = await fs.statfs(pathname);
        const totalBytes = Number(stat.blocks) * Number(stat.bsize);
        const freeBytes = Number(stat.bfree) * Number(stat.bsize);
        const usedBytes = Math.max(0, totalBytes - freeBytes);
        const percent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : null;
        return {
            resource: label,
            path: pathname,
            usedBytes,
            totalBytes,
            freeBytes,
            percent,
        };
    }
    catch (error) {
        return {
            resource: label,
            path: pathname,
            usedBytes: null,
            totalBytes: null,
            freeBytes: null,
            percent: null,
            note: error instanceof Error ? error.message : String(error),
        };
    }
}
async function runReadArtifacttool(body, config) {
    const requestedPath = typeof body.path === 'string' ? body.path.trim() : '';
    const maxChars = typeof body.maxChars === 'number' && Number.isFinite(body.maxChars)
        ? Math.max(1000, Math.min(Math.floor(body.maxChars), 60000))
        : 20000;
    if (!requestedPath) {
        return JSON.stringify({ error: 'path is required' }, null, 2);
    }
    const resolved = path.resolve(requestedPath);
    const sandboxRoot = path.resolve(config.sandboxStorageRoot);
    const normalized = resolved.split(path.sep).join('/');
    const allowed = normalized.startsWith(`${sandboxRoot.split(path.sep).join('/')}/users/`) &&
        (normalized.includes('/workspace/uploads/') ||
            normalized.includes('/workspace/artifacts/') ||
            normalized.includes('/workspace/outputs/') ||
            normalized.includes('/workspace/external-memory/'));
    if (!allowed) {
        return JSON.stringify({
            error: 'path is outside allowed workspace artifact directories',
            requestedPath,
            allowedRoot: `${sandboxRoot}/users/*/threads/*/workspace/{uploads,artifacts,outputs,external-memory}`,
        }, null, 2);
    }
    try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
            return JSON.stringify({ error: 'path is not a file', path: resolved }, null, 2);
        }
        const raw = await fs.readFile(resolved, 'utf8');
        return JSON.stringify({
            path: resolved,
            sizeBytes: stat.size,
            truncated: raw.length > maxChars,
            content: raw.slice(0, maxChars),
        }, null, 2);
    }
    catch (error) {
        return JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            path: resolved,
        }, null, 2);
    }
}
function parseSandboxExecBridgeBody(body) {
    const rawContext = isRecord(body._context) ? body._context : {};
    const context = {
        userId: typeof rawContext.userId === 'string' ? rawContext.userId : undefined,
        threadId: typeof rawContext.threadId === 'string' ? rawContext.threadId : undefined,
        runId: typeof rawContext.runId === 'string' ? rawContext.runId : undefined,
        workspace: typeof rawContext.workspace === 'string' ? rawContext.workspace : undefined,
    };
    if (isRecord(body.arguments)) {
        return { argumentsValue: body.arguments, context };
    }
    const { _context: _ignored, ...argumentsValue } = body;
    return { argumentsValue, context };
}
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        const maxBodyBytes = readMaxBodyBytes();
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
            raw += chunk;
            if (Buffer.byteLength(raw, 'utf8') > maxBodyBytes) {
                reject(new Error('request body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!raw.trim())
                return resolve(null);
            try {
                resolve(JSON.parse(raw));
            }
            catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}
function readMaxBodyBytes() {
    const value = Number(process.env.PERSONAL_AGENT_SERVER_MAX_BODY_BYTES || '');
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 80 * 1024 * 1024;
}
