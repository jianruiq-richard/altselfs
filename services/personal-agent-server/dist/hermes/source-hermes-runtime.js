import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCleanTurnContext, upsertAgentSandboxControlPlane, } from '../agent-context-store.js';
import { ingestWorkspaceAttachments } from '../artifact-ingestion.js';
import { LocalProfileStore } from '../profile-store.js';
import { createRunCancelledError, isAgentRunCancelledError, isRunCancelled, registerActiveRun, unregisterActiveRun, } from '../run-control.js';
import { calculateDirectoryBytes, prepareRuntimeDirectories, readSandboxState, resolveRuntimePaths, writeSandboxState, } from '../sandbox-runtime.js';
import { id, isRecord, nowIso, safeJson, truncate } from '../util.js';
export class HermesSourceRuntime {
    config;
    memoryReviewQueue;
    runtimeStateStore;
    profileStore;
    constructor(config, memoryReviewQueue, profileStore, runtimeStateStore) {
        this.config = config;
        this.memoryReviewQueue = memoryReviewQueue;
        this.runtimeStateStore = runtimeStateStore;
        this.profileStore = profileStore || new LocalProfileStore(config.profileStorePath);
    }
    async run(request) {
        const runtimeRunStartedAtMs = Date.now();
        const events = [];
        const emit = async (type, payload) => {
            const event = { type, timestamp: nowIso(), payload: safeJson(payload) };
            events.push(event);
            await request.onEvent?.(event);
        };
        const runId = typeof request.metadata?.runId === 'string' && request.metadata.runId.trim()
            ? request.metadata.runId.trim()
            : id('run');
        const runtimePaths = resolveRuntimePaths(this.config, request, runId);
        const { hermesHome, codexHome, workspace } = runtimePaths;
        const selectedCodexModel = resolveSelectedCodexModel(this.config, request);
        const codexModelSelection = resolveCodexModelSelection(this.config, selectedCodexModel);
        const runtimeStatePaths = { hermesHome, codexHome, workspace };
        const codexLocalEnvironmentDisabled = this.config.disableLocalEnvironmentForGeneral;
        const previousSandboxState = await readSandboxState(runtimePaths);
        const previousHermesSessionId = typeof previousSandboxState?.hermesSessionId === 'string' ? previousSandboxState.hermesSessionId.trim() : '';
        const resumeSessionId = this.config.runtimeStateMode === 'sandbox' && previousHermesSessionId
            ? previousHermesSessionId
            : '';
        if (this.runtimeStateStore && this.config.runtimeStateMode === 'snapshot') {
            const hydrateStartedAtMs = Date.now();
            const hydrated = await this.runtimeStateStore.hydrate({
                userId: request.userId,
                threadId: request.threadId || 'default',
                paths: runtimeStatePaths,
            });
            if (hydrated.enabled) {
                await emit('runtime_state.hydrated', {
                    restored: hydrated.restored,
                    warnings: hydrated.warnings,
                    durationMs: Date.now() - hydrateStartedAtMs,
                    sinceRunStartMs: Date.now() - runtimeRunStartedAtMs,
                });
            }
        }
        const prepareHomesStartedAtMs = Date.now();
        await this.prepareHomes(runtimePaths, codexModelSelection);
        await emit('hermes.runtime.prepare_homes_timing', {
            durationMs: Date.now() - prepareHomesStartedAtMs,
            sinceRunStartMs: Date.now() - runtimeRunStartedAtMs,
            hermesHome,
            codexHome,
            workspace,
            codexModelProvider: codexModelSelection.provider || null,
            codexModel: codexModelSelection.model || null,
        });
        await writeSandboxState(runtimePaths, {
            status: 'ACTIVE',
            activeRunId: runId,
            lastStartedAt: nowIso(),
            previousHermesSessionId: resumeSessionId || null,
        });
        await this.syncSandboxControlPlane({
            request,
            runtimePaths,
            runId,
            status: 'ACTIVE',
            activeSessionId: resumeSessionId || null,
            emit,
            metadata: {
                phase: 'start',
                previousHermesSessionId: resumeSessionId || null,
            },
        });
        const ingestArtifactsStartedAtMs = Date.now();
        const ingestedArtifacts = await ingestWorkspaceAttachments(this.config, request, runtimePaths, runId);
        await emit('workspace_artifacts.ingest_timing', {
            durationMs: Date.now() - ingestArtifactsStartedAtMs,
            sinceRunStartMs: Date.now() - runtimeRunStartedAtMs,
            count: ingestedArtifacts.artifacts.length,
            warningCount: ingestedArtifacts.warnings.length,
        });
        if (ingestedArtifacts.artifacts.length > 0 || ingestedArtifacts.warnings.length > 0) {
            await emit('workspace_artifacts.ingested', {
                count: ingestedArtifacts.artifacts.length,
                artifacts: ingestedArtifacts.artifacts.map((artifact) => ({
                    name: artifact.name,
                    kind: artifact.kind,
                    mimeType: artifact.mimeType,
                    sizeBytes: artifact.sizeBytes,
                    metadata: artifact.metadata,
                })),
                warnings: ingestedArtifacts.warnings,
            });
        }
        const contextLoadStartedAtMs = Date.now();
        const cleanContext = await loadCleanTurnContext(this.config, request);
        const contextLoadDurationMs = Date.now() - contextLoadStartedAtMs;
        await emit('agent_context.loaded', {
            loaded: cleanContext.loaded,
            summaryChars: cleanContext.summaryChars,
            messageCount: cleanContext.messageCount,
            artifactCount: cleanContext.artifactCount,
            warnings: cleanContext.warnings,
            durationMs: contextLoadDurationMs,
            sinceRunStartMs: Date.now() - runtimeRunStartedAtMs,
        });
        const currentUserMessage = typeof request.metadata?.currentUserMessage === 'string' && request.metadata.currentUserMessage.trim()
            ? request.metadata.currentUserMessage.trim()
            : request.message;
        const selectedAgentProfileId = typeof request.metadata?.selectedAgentProfileId === 'string' && request.metadata.selectedAgentProfileId.trim()
            ? request.metadata.selectedAgentProfileId.trim()
            : '';
        const profileLoadStartedAtMs = Date.now();
        const rememberedProfile = await this.profileStore.rememberExplicitUserProfile(request.userId, currentUserMessage, request.threadId);
        if (rememberedProfile) {
            await emit('hermes.profile.updated', {
                profileStorePath: this.config.profileStorePath,
                entry: rememberedProfile,
            });
        }
        const profileSnapshot = await this.profileStore.getSnapshot(request.userId);
        const hermesUserProfile = await readHermesUserProfile(hermesHome);
        const combinedProfile = combineProfileBlocks(profileSnapshot.rendered, hermesUserProfile);
        const runtimeMessage = buildRuntimeMessage({
            message: cleanContext.message,
            renderedProfile: combinedProfile,
        });
        await emit('hermes.profile.loaded', {
            profileStorePath: this.config.profileStorePath,
            userId: request.userId,
            entryCount: profileSnapshot.entries.length,
            hermesUserProfileChars: hermesUserProfile.length,
            injected: Boolean(combinedProfile),
            renderedProfile: truncate(combinedProfile, 4000),
            durationMs: Date.now() - profileLoadStartedAtMs,
            sinceRunStartMs: Date.now() - runtimeRunStartedAtMs,
        });
        const sourceRuntimeStartingAtMs = Date.now();
        await emit('hermes.source_runtime.starting', {
            runId,
            hermesHome,
            codexHome,
            workspace,
            userProfileDir: runtimePaths.userProfileDir || null,
            threadRoot: runtimePaths.threadRoot || null,
            sessionMode: this.config.runtimeStateMode,
            resumeSessionId: resumeSessionId || null,
            codexLocalEnvironmentDisabled,
            model: this.config.hermesModel,
            provider: 'openrouter',
            codexModel: codexModelSelection.model || null,
            codexModelProvider: codexModelSelection.provider || null,
            selectedAgentProfileId: selectedAgentProfileId || null,
            preSpawnDurationMs: sourceRuntimeStartingAtMs - runtimeRunStartedAtMs,
            sinceRunStartMs: sourceRuntimeStartingAtMs - runtimeRunStartedAtMs,
        });
        const startedAtMs = Date.now();
        const args = [
            'run',
            '--extra',
            'acp',
            'python',
            '-m',
            'hermes_cli.main',
            'chat',
            ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
            '-Q',
            '--source',
            'tool',
            '--max-turns',
            String(this.config.hermesMaxTurns),
            '-q',
            runtimeMessage,
        ];
        let result;
        const rolloutBridge = startCodexRolloutEventBridge({
            codexHome,
            startedAtMs,
            emit,
        });
        try {
            result = await this.spawnHermes(args, {
                runId,
                userId: request.userId,
                threadId: request.threadId || 'default',
                currentUserMessage,
                selectedAgentProfileId,
                enabledCompetitorTools: getEnabledCompetitorToolNames(request.metadata),
                hermesHome,
                codexHome,
                workspace,
                codexModelSelection,
            }, {
                emit,
                startedAtMs,
                runtimeRunStartedAtMs,
            });
        }
        catch (error) {
            await rolloutBridge.stop();
            const message = error instanceof Error ? error.message : String(error);
            const diskBytes = await this.calculateSandboxDiskBytes(runtimePaths);
            if (isAgentRunCancelledError(error)) {
                await writeSandboxState(runtimePaths, {
                    status: 'IDLE',
                    activeRunId: null,
                    lastCancelledAt: nowIso(),
                    hermesSessionId: previousHermesSessionId || null,
                });
                await this.syncSandboxControlPlane({
                    request,
                    runtimePaths,
                    runId,
                    status: 'IDLE',
                    activeSessionId: resumeSessionId || previousHermesSessionId || null,
                    diskBytes,
                    error: message,
                    emit,
                    metadata: { phase: 'cancelled', cancelled: true },
                });
                throw error;
            }
            await writeSandboxState(runtimePaths, {
                status: 'ERROR',
                activeRunId: null,
                lastErrorAt: nowIso(),
                error: message,
            });
            await this.syncSandboxControlPlane({
                request,
                runtimePaths,
                runId,
                status: 'ERROR',
                activeSessionId: resumeSessionId || previousHermesSessionId || null,
                diskBytes,
                error: message,
                emit,
                metadata: { phase: 'error' },
            });
            throw error;
        }
        await rolloutBridge.stop();
        const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
        const sessionId = extractSessionId(combinedOutput);
        const codexOutcome = await extractLatestCodexOutcome(codexHome, startedAtMs);
        if (codexOutcome.turnAborted && !codexOutcome.taskComplete) {
            const message = [
                'Codex turn aborted before producing a task_complete final answer',
                codexOutcome.abortReason ? `reason=${codexOutcome.abortReason}` : '',
            ].filter(Boolean).join('; ');
            await emit('codex.turn_aborted.detected', {
                reason: codexOutcome.abortReason || null,
                file: codexOutcome.file || null,
                lastAgentMessage: codexOutcome.reply ? truncate(codexOutcome.reply, 4000) : null,
            });
            const diskBytes = await this.calculateSandboxDiskBytes(runtimePaths);
            await writeSandboxState(runtimePaths, {
                status: 'ERROR',
                activeRunId: null,
                lastErrorAt: nowIso(),
                error: message,
                hermesSessionId: sessionId || previousHermesSessionId || null,
            });
            await this.syncSandboxControlPlane({
                request,
                runtimePaths,
                runId,
                status: 'ERROR',
                activeSessionId: sessionId || previousHermesSessionId || null,
                diskBytes,
                error: message,
                emit,
                metadata: {
                    phase: 'codex_turn_aborted',
                    codexRolloutFile: codexOutcome.file || null,
                    codexAbortReason: codexOutcome.abortReason || null,
                },
            });
            throw new Error(message);
        }
        const codexReply = codexOutcome.reply;
        const reply = normalizeAssistantReply(codexReply || extractReply(combinedOutput).trim());
        await emit('hermes.source_runtime.completed', {
            sessionId: sessionId || null,
            codexReply: codexReply || null,
            codexTaskComplete: codexOutcome.taskComplete,
            codexTurnAborted: codexOutcome.turnAborted,
            stdout: truncate(result.stdout, 20000),
            stderrTail: truncate(tail(result.stderr, 120), 20000),
        });
        await writeSandboxState(runtimePaths, {
            status: 'IDLE',
            activeRunId: null,
            lastCompletedAt: nowIso(),
            hermesSessionId: sessionId || previousHermesSessionId || null,
        });
        const diskBytes = await this.calculateSandboxDiskBytes(runtimePaths);
        await this.syncSandboxControlPlane({
            request,
            runtimePaths,
            runId,
            status: 'IDLE',
            activeSessionId: sessionId || previousHermesSessionId || null,
            diskBytes,
            emit,
            metadata: {
                phase: 'complete',
                hermesSessionId: sessionId || null,
            },
        });
        if (this.config.memoryReviewMode === 'async' && this.memoryReviewQueue && reply) {
            const reviewUserMessage = typeof request.metadata?.currentUserMessage === 'string' && request.metadata.currentUserMessage.trim()
                ? request.metadata.currentUserMessage.trim()
                : request.message;
            const job = await this.memoryReviewQueue.enqueue({
                userId: request.userId,
                threadId: request.threadId || 'default',
                userMessage: reviewUserMessage,
                assistantReply: reply,
                hermesHome,
                workspace,
            });
            await emit('hermes.memory_review.enqueued', {
                jobId: job.id,
                jobStorePath: this.config.memoryReviewJobStorePath,
            });
        }
        if (this.runtimeStateStore && this.config.runtimeStateMode === 'snapshot') {
            const flushed = await this.runtimeStateStore.flush({
                userId: request.userId,
                threadId: request.threadId || 'default',
                paths: runtimeStatePaths,
            });
            if (flushed.enabled) {
                await emit('runtime_state.flushed', {
                    flushed: flushed.flushed,
                    warnings: flushed.warnings,
                });
            }
        }
        if (this.config.runtimeStateMode === 'ephemeral') {
            await this.removeRunDirectories([hermesHome, codexHome, workspace], emit);
        }
        return {
            route: 'main',
            reply: reply || 'Hermes Agent 已完成本轮处理，但没有返回可展示的回复。',
            events,
            raw: {
                runId,
                hermesSessionId: sessionId,
                hermesHome,
                codexHome,
                workspace,
                profileStorePath: this.config.profileStorePath,
            },
        };
    }
    async prepareHomes(paths, codexModelSelection) {
        await prepareRuntimeDirectories(paths);
        await fs.writeFile(path.join(paths.hermesHome, 'config.yaml'), [
            'model:',
            '  provider: openrouter',
            `  default: ${yamlString(this.config.hermesModel)}`,
            '  openai_runtime: codex_app_server',
            '',
            'terminal:',
            `  cwd: ${yamlString(paths.workspace)}`,
            '',
            'display:',
            '  tool_activity: compact',
            '',
            'memory:',
            '  memory_enabled: true',
            '  user_profile_enabled: true',
            `  nudge_interval: ${this.config.memoryReviewMode === 'inline' ? this.config.hermesMemoryNudgeInterval : 0}`,
            '',
            'security:',
            '  allow_lazy_installs: false',
            '',
        ].join('\n'), 'utf8');
        await this.writeCodexConfig(paths, codexModelSelection);
        if (codexModelSelection.provider === 'openai')
            await this.ensureOpenAiAuth(paths.codexHome);
    }
    async writeCodexConfig(paths, selection) {
        const metadata = resolveCodexModelMetadata(this.config, selection.model);
        const model = selection.model || this.config.codexModel || this.config.hermesModel;
        const provider = selection.provider || 'openrouter';
        const configPath = path.join(paths.codexHome, 'config.toml');
        if (provider === 'openai') {
            await fs.writeFile(configPath, [
                `model = ${tomlString(model)}`,
                'model_provider = "openai"',
                `web_search = ${tomlString(this.config.codexWebSearchMode)}`,
                'sandbox_mode = "workspace-write"',
                'approval_policy = "never"',
                'disable_response_storage = true',
                ...codexModelMetadataLines(metadata),
                '',
                '[sandbox_workspace_write]',
                'network_access = true',
                `writable_roots = [${tomlString(paths.workspace)}]`,
                '',
            ].filter(Boolean).join('\n'), 'utf8');
            return;
        }
        const openRouterBaseUrl = this.config.hermesCodexResponsesProxyEnabled
            ? `http://127.0.0.1:${this.config.port}/openrouter-responses-proxy/v1`
            : this.config.openRouterBaseUrl;
        await fs.writeFile(configPath, [
            `model = ${tomlString(model)}`,
            'model_provider = "openrouter"',
            `web_search = ${tomlString(this.config.codexWebSearchMode)}`,
            'sandbox_mode = "workspace-write"',
            'approval_policy = "never"',
            ...codexModelMetadataLines(metadata),
            '',
            '[sandbox_workspace_write]',
            'network_access = true',
            `writable_roots = [${tomlString(paths.workspace)}]`,
            '',
            '[model_providers.openrouter]',
            'name = "OpenRouter"',
            `base_url = ${tomlString(openRouterBaseUrl)}`,
            `env_key = ${tomlString(this.config.openRouterApiKeyEnv)}`,
            'wire_api = "responses"',
            'requires_openai_auth = false',
            '',
            '[model_providers.openrouter.http_headers]',
            '"X-OpenRouter-Title" = ' + tomlString(this.config.openRouterAppTitle),
            '',
        ].join('\n'), 'utf8');
    }
    async ensureOpenAiAuth(codexHome) {
        const authPath = path.join(codexHome, 'auth.json');
        if (await pathExists(authPath))
            return;
        const source = this.config.codexOpenAiAuthJsonPath;
        if (!source)
            return;
        await fs.copyFile(source, authPath);
        await fs.chmod(authPath, 0o600).catch(() => undefined);
    }
    async calculateSandboxDiskBytes(paths) {
        try {
            return await calculateDirectoryBytes(paths.threadRoot || paths.workspace);
        }
        catch {
            return null;
        }
    }
    async syncSandboxControlPlane(input) {
        const investorId = typeof input.request.metadata?.investorId === 'string' && input.request.metadata.investorId.trim()
            ? input.request.metadata.investorId.trim()
            : input.request.userId;
        try {
            await upsertAgentSandboxControlPlane(this.config, {
                userId: input.request.userId,
                investorId,
                threadId: input.request.threadId || 'default',
                runId: input.runId,
                status: input.status,
                paths: input.runtimePaths,
                activeSessionId: input.activeSessionId || null,
                diskBytes: input.diskBytes ?? null,
                error: input.error || null,
                metadata: input.metadata || null,
            });
            await input.emit('agent_context.sandbox_state_updated', {
                status: input.status,
                sandboxPath: input.runtimePaths.threadRoot || input.runtimePaths.workspace,
                userRoot: input.runtimePaths.userRoot || null,
                threadRoot: input.runtimePaths.threadRoot || null,
                workspace: input.runtimePaths.workspace,
                activeSessionId: input.activeSessionId || null,
                diskBytes: input.diskBytes ?? null,
            });
        }
        catch (error) {
            await input.emit('agent_context.sandbox_state_failed', {
                status: input.status,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    spawnHermes(args, paths, timing) {
        return new Promise((resolve, reject) => {
            const codexBinDir = path.dirname(this.config.codexBin);
            const noProxy = mergeNoProxy(process.env.NO_PROXY || process.env.no_proxy || '');
            const spawnRequestedAtMs = Date.now();
            const emitTiming = (type, payload) => {
                if (!timing)
                    return;
                void timing.emit(type, {
                    ...payload,
                    sinceHermesStartMs: Date.now() - timing.startedAtMs,
                    sinceRunStartMs: Date.now() - timing.runtimeRunStartedAtMs,
                }).catch(() => undefined);
            };
            const child = spawn(this.config.uvBin, args, {
                cwd: this.config.hermesSourceRoot,
                env: {
                    ...process.env,
                    HERMES_HOME: paths.hermesHome,
                    CODEX_HOME: paths.codexHome,
                    PATH: [codexBinDir, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
                    HERMES_BACKGROUND_REVIEW_INLINE: this.config.memoryReviewMode === 'inline' && this.config.hermesBackgroundReviewInline ? '1' : '0',
                    HERMES_DISABLE_LAZY_INSTALLS: '1',
                    ALTSELFS_RUN_ID: paths.runId,
                    ALTSELFS_USER_ID: paths.userId,
                    ALTSELFS_THREAD_ID: paths.threadId,
                    ALTSELFS_WORKSPACE: paths.workspace,
                    ALTSELFS_HERMES_TIMING: '1',
                    ALTSELFS_CODEX_TIMING: '1',
                    ALTSELFS_CODEX_DISABLE_LOCAL_ENVIRONMENT: this.config.disableLocalEnvironmentForGeneral ? '1' : '0',
                    ALTSELFS_CODEX_PERSONALITY: 'pragmatic',
                    ALTSELFS_CODEX_SANDBOX_EXEC_DYNAMIC_TOOL: this.config.sandboxExecEnabled ? '1' : '0',
                    ALTSELFS_CODEX_COMPETITOR_DYNAMIC_TOOLS: paths.selectedAgentProfileId === 'codex-competitive-intelligence'
                        ? paths.enabledCompetitorTools.join(',')
                        : '0',
                    ALTSELFS_CODEX_WEB_SEARCH_DYNAMIC_TOOL: paths.codexModelSelection.provider === 'openai' ? '0' : '1',
                    ALTSELFS_CODEX_DEVELOPER_INSTRUCTIONS: buildCodexDeveloperInstructions({
                        webSearchMode: this.config.codexWebSearchMode,
                        runtimeStateMode: this.config.runtimeStateMode,
                        message: paths.currentUserMessage,
                        selectedAgentProfileId: paths.selectedAgentProfileId,
                        enabledCompetitorTools: paths.enabledCompetitorTools,
                        codexModelProvider: paths.codexModelSelection.provider,
                        sandboxExecEnabled: this.config.sandboxExecEnabled,
                    }),
                    NO_PROXY: noProxy,
                    no_proxy: noProxy,
                    ...this.buildCodexProcessEnv(paths.codexModelSelection, noProxy),
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            const spawnedAtMs = Date.now();
            emitTiming('hermes.process.spawned', {
                pid: child.pid || null,
                command: path.basename(this.config.uvBin),
                spawnReturnMs: spawnedAtMs - spawnRequestedAtMs,
                cwd: this.config.hermesSourceRoot,
            });
            registerActiveRun({
                runId: paths.runId,
                userId: paths.userId,
                threadId: paths.threadId,
                child,
            });
            let stdout = '';
            let stderr = '';
            let firstStdoutAtMs = null;
            let firstStderrAtMs = null;
            let stderrTimingBuffer = '';
            const timeout = setTimeout(() => {
                emitTiming('hermes.process.timeout', {
                    durationMs: Date.now() - spawnedAtMs,
                });
                child.kill('SIGTERM');
                reject(new Error('Hermes source runtime timed out after 10 minutes'));
            }, 600_000);
            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');
            child.stdout.on('data', (chunk) => {
                if (firstStdoutAtMs === null) {
                    firstStdoutAtMs = Date.now();
                    emitTiming('hermes.process.first_stdout', {
                        sinceSpawnMs: firstStdoutAtMs - spawnedAtMs,
                        bytes: Buffer.byteLength(chunk, 'utf8'),
                        preview: truncate(chunk, 2000),
                    });
                }
                stdout += chunk;
            });
            child.stderr.on('data', (chunk) => {
                const chunkText = String(chunk);
                if (firstStderrAtMs === null) {
                    firstStderrAtMs = Date.now();
                    emitTiming('hermes.process.first_stderr', {
                        sinceSpawnMs: firstStderrAtMs - spawnedAtMs,
                        bytes: Buffer.byteLength(chunkText, 'utf8'),
                        preview: truncate(chunkText, 2000),
                    });
                }
                stderr += chunkText;
                stderrTimingBuffer = emitRuntimeTimingFromStderrChunk(stderrTimingBuffer, chunkText, emitTiming);
            });
            child.on('error', (error) => {
                unregisterActiveRun(paths.runId);
                clearTimeout(timeout);
                emitTiming('hermes.process.error', {
                    durationMs: Date.now() - spawnedAtMs,
                    error: error instanceof Error ? error.message : String(error),
                });
                reject(isRunCancelled(paths.runId) ? createRunCancelledError(paths.runId) : error);
            });
            child.on('close', (code) => {
                unregisterActiveRun(paths.runId);
                clearTimeout(timeout);
                stderrTimingBuffer = flushRuntimeTimingFromStderrBuffer(stderrTimingBuffer, emitTiming);
                emitTiming('hermes.process.closed', {
                    code,
                    durationMs: Date.now() - spawnedAtMs,
                    stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
                    stderrBytes: Buffer.byteLength(stderr, 'utf8'),
                    firstStdoutDelayMs: firstStdoutAtMs === null ? null : firstStdoutAtMs - spawnedAtMs,
                    firstStderrDelayMs: firstStderrAtMs === null ? null : firstStderrAtMs - spawnedAtMs,
                });
                if (isRunCancelled(paths.runId)) {
                    reject(createRunCancelledError(paths.runId));
                    return;
                }
                if (code === 0) {
                    resolve({ stdout, stderr });
                    return;
                }
                reject(new Error(`Hermes source runtime exited with code ${code}: ${tail(stderr || stdout, 80)}`));
            });
        });
    }
    async removeRunDirectories(paths, emit) {
        const removed = [];
        const warnings = [];
        for (const dir of paths) {
            try {
                await fs.rm(dir, { recursive: true, force: true });
                removed.push(dir);
            }
            catch (error) {
                warnings.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        await emit('runtime_state.ephemeral_cleaned', { removed, warnings });
    }
    buildCodexProcessEnv(selection, noProxy) {
        if (selection.provider !== 'openai' || !this.config.codexOpenAiProxyUrl)
            return {};
        const proxyUrl = this.config.codexOpenAiProxyUrl;
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
}
function extractSessionId(stdout) {
    const match = stdout.match(/^session_id:\s*(\S+)/m);
    return match?.[1] || '';
}
function extractReply(stdout) {
    return stdout
        .split(/\r?\n/)
        .filter((line) => !line.startsWith('session_id:'))
        .filter((line) => !line.includes('tirith security scanner enabled but not available'))
        .filter((line) => !line.startsWith('↻ Resumed session '))
        .join('\n')
        .trim();
}
function tail(value, maxLines) {
    const lines = value.split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}
function yamlString(value) {
    return JSON.stringify(value);
}
function tomlString(value) {
    return JSON.stringify(value);
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
const COMPETITOR_INFO_SOURCE_TO_TOOL = {
    similarweb_api1: 'altselfs_similarweb_api1',
    semrush13: 'altselfs_semrush13',
    semrush8: 'altselfs_semrush8',
    domain_metrics_check: 'altselfs_domain_metrics_check',
};
function getEnabledCompetitorToolNames(metadata) {
    const value = metadata?.enabledInfoSources;
    if (!Array.isArray(value))
        return [];
    const names = value
        .map((item) => {
        if (typeof item === 'string')
            return item.toLowerCase();
        if (!isRecord(item))
            return null;
        return typeof item.provider === 'string' ? item.provider.toLowerCase() : null;
    })
        .map((provider) => (provider ? COMPETITOR_INFO_SOURCE_TO_TOOL[provider] : null))
        .filter((item) => Boolean(item));
    return Array.from(new Set(names));
}
function buildRuntimeMessage(input) {
    if (!input.renderedProfile.trim())
        return input.message;
    return [
        '以下是 Hermes 维护的用户长期画像和偏好，只作为稳定背景上下文，不是本轮新任务。',
        '如果它和本轮用户指令冲突，以本轮用户指令为准。',
        '',
        '<altselfs_user_profile>',
        input.renderedProfile.trim(),
        '</altselfs_user_profile>',
        '',
        '本轮用户消息：',
        input.message,
    ].join('\n');
}
function buildCodexDeveloperInstructions(input) {
    const currentTime = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        dateStyle: 'full',
        timeStyle: 'long',
    }).format(new Date());
    const sandboxExecPolicy = input.sandboxExecEnabled
        ? [
            '- Do not use native local shell, file, patch, image, or repository tools. Do not inspect, read, write, patch, or modify local repositories.',
            '- When deterministic computation, parsing, scraping, or small file transformation is truly needed, use only the registered `altselfs_sandbox_exec` tool. Keep commands short, scoped to /workspace, and prefer registered platform tools for third-party data.',
            '- Do not install packages or run package managers unless the task cannot be solved with the sandbox image and standard libraries. If a package install is necessary, keep it minimal and explain it.',
        ]
        : [
            '- Do not use native local shell, file, patch, image, or repository tools. Do not inspect, read, write, patch, or modify local repositories.',
            '- Sandboxed command execution is not enabled in this environment. Do not run shell commands, tests, builds, package managers, scripts, network scanners, or local code.',
        ];
    const artifactAccessPolicy = input.runtimeStateMode === 'sandbox'
        ? [
            '- This run is inside an Altselfs sandbox workspace. User-provided artifacts listed in host context are available through the `altselfs_read_artifact` tool.',
            '- If the user asks about an uploaded file or indexed material, call `altselfs_read_artifact` with `parsed_text_path` first, then `workspace_path` if needed.',
            ...sandboxExecPolicy,
        ]
        : [
            ...sandboxExecPolicy,
            '- User-provided artifacts listed in host context are available through the `altselfs_read_artifact` tool. If the user asks about an uploaded file, call `altselfs_read_artifact` with `parsed_text_path` first, then `workspace_path` if needed.',
            '- Do not say you cannot access an uploaded file when an artifact path is listed. Try `altselfs_read_artifact` first; if the tool fails, report the concrete failure.',
        ];
    const instructions = [
        `Current time: ${currentTime} (Asia/Shanghai).`,
        `Codex web_search mode requested by host: ${input.webSearchMode}.`,
        `Codex model provider for this turn: ${input.codexModelProvider || 'openrouter'}.`,
        input.codexModelProvider === 'openai'
            ? 'When public web research is needed, use the native web.run tool exposed by the OpenAI Codex provider.'
            : 'When public web research is needed, use the registered altselfs_web_search tool.',
        'Answer in the user language unless the user asks otherwise.',
        '',
        `Selected agent profile from Hermes Router: ${input.selectedAgentProfileId || 'main'}.`,
    ];
    if (input.selectedAgentProfileId === 'codex-competitive-intelligence') {
        const enabledCompetitorTools = input.enabledCompetitorTools || [];
        const publicWebFallbackInstruction = input.codexModelProvider === 'openai'
            ? '- Treat native web.run as a public-web fallback and cross-check source, not as a substitute for paid platform data when a more specific enabled source is available.'
            : '- Treat altselfs_web_search as a public-web fallback and cross-check source, not as a substitute for paid platform data when a more specific enabled source is available.';
        instructions.push('', 'Altselfs codex-competitive-intelligence policy:', '- You are the competitive intelligence analysis profile selected by Hermes Router for this turn.', '- Answer questions about competitors, competitive landscape, user/traffic/revenue estimates, growth rate, acquisition channels, SEO, PPC, keywords, backlinks, Semrush, Similarweb, market share, and growth intelligence.', ...artifactAccessPolicy, '- Before analysis, identify the product, website/domain, category, target market, target user, region/database, known competitors, and time window from the user message and conversation context.', '- If a critical input such as the product/domain is missing, ask one concise clarification question instead of fabricating a target.', enabledCompetitorTools.length > 0
            ? `- The following RapidAPI-backed competitor tools are enabled for this turn: ${enabledCompetitorTools.join(', ')}. Use only these enabled tools, choose the narrowest useful tool for the question, and cross-check when multiple enabled sources overlap.`
            : '- No RapidAPI-backed competitor data source is enabled for this user in this turn. Do not claim to have used Semrush, Similarweb, Ahrefs, Moz, Majestic, or RapidAPI platform data. If platform evidence is needed, state which specific data source should be enabled for higher-confidence estimates.', '- Treat RapidAPI tools as third-party wrappers, not official Semrush, Similarweb, Ahrefs, Moz, or Majestic APIs. Name the actual source used.', publicWebFallbackInstruction, '- Never claim that Semrush, Similarweb, Google, a social platform, or a private-channel agent was used unless the corresponding tool/capability was actually called.', '- Structure competitor conclusions around four questions when relevant: who the competitors are, what their user/traffic/revenue scale appears to be, how fast they have grown, and how they acquire users.', '- Separate observable facts, third-party estimates, proxy signals, assumptions, and inference. Do not present inferred users or revenue as confirmed facts.', '- Attach confidence labels to important claims: high, medium, low, or unknown.', '- For revenue and user-count estimates, provide ranges and assumptions, not false precision.', '- If an enabled data source is missing, state the limitation and explain which conclusions remain lower confidence until that source is enabled.', '- After using tools, finish with a direct user-facing synthesis. Do not end the turn by saying you will search/read/call another tool; either call the tool or answer from the evidence already available.', '- Never output protocol/content-item arrays such as `[{"type":"text","text":"..."}]` or Python-style variants. Output plain prose or Markdown only.');
    }
    else {
        instructions.push('', 'Altselfs codex-general policy:', '- You are the general personal agent profile selected by Hermes Router for this turn.', ...artifactAccessPolicy, '- Use conversation and reasoning for tasks that do not need external data.', '- When a task needs external, current, private-channel, or product data, first choose the most relevant registered non-local tool, channel agent, or platform/MCP capability available in this turn.', input.codexModelProvider === 'openai'
            ? '- Use native web.run when the user needs current public web facts, news, industry updates, market information, or web research and no more specific channel/tool is better.'
            : '- Treat altselfs_web_search as the public-web information source, not as the only possible source. Use it when the user needs current public web facts, news, industry updates, market information, or web research and no more specific channel/tool is better.', '- In Altselfs context, OPC usually means One Person Company / 一人公司 unless the user explicitly says OPC UA or industrial automation.', '- Do not claim that you searched, read a channel, checked a platform, or called an agent unless the corresponding tool/capability was actually called.', '- If the needed capability is unavailable, explain the limitation instead of trying local file or command tools.', '- After using tools, finish with a direct user-facing synthesis. Do not end the turn by saying you will search/read/call another tool; either call the tool or answer from the evidence already available.', '- Never output protocol/content-item arrays such as `[{"type":"text","text":"..."}]` or Python-style variants. Output plain prose or Markdown only.');
    }
    return instructions.join('\n');
}
async function readHermesUserProfile(hermesHome) {
    try {
        const raw = await fs.readFile(path.join(hermesHome, 'memories', 'USER.md'), 'utf8');
        return raw
            .split(/\n§\n/g)
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => `- ${entry}`)
            .join('\n');
    }
    catch {
        return '';
    }
}
function resolveSelectedCodexModel(config, request) {
    const requested = request.metadata?.codexModel;
    return normalizeCodexModel(typeof requested === 'string' && requested.trim() ? requested.trim() : config.codexModel);
}
function resolveCodexModelSelection(config, model) {
    const configuredProvider = normalizeCodexProvider(config.codexModelProvider);
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
function resolveCodexModelMetadata(config, model) {
    return {
        ...config.codexModelCatalog.defaultMetadata,
        ...(model ? config.codexModelCatalog.models[model] || {} : {}),
    };
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
async function pathExists(file) {
    try {
        await fs.access(file);
        return true;
    }
    catch {
        return false;
    }
}
function combineProfileBlocks(...blocks) {
    const seen = new Set();
    const entries = [];
    for (const block of blocks) {
        for (const rawLine of block.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line)
                continue;
            const normalized = line.replace(/^-\s*/, '').replace(/\s+/g, ' ').toLowerCase();
            if (seen.has(normalized))
                continue;
            seen.add(normalized);
            entries.push(line.startsWith('- ') ? line : `- ${line}`);
        }
    }
    return entries.join('\n');
}
async function extractLatestCodexOutcome(codexHome, startedAtMs) {
    const sessionsDir = path.join(codexHome, 'sessions');
    const files = await listFiles(sessionsDir);
    const candidates = (await Promise.all(files
        .filter((file) => file.endsWith('.jsonl'))
        .map(async (file) => {
        try {
            const stat = await fs.stat(file);
            return stat.mtimeMs >= startedAtMs - 10_000 ? { file, mtimeMs: stat.mtimeMs } : null;
        }
        catch {
            return null;
        }
    })))
        .filter((file) => Boolean(file))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const candidate of candidates.slice(0, 5)) {
        const outcome = await extractCodexOutcomeFromRollout(candidate.file);
        if (outcome.taskComplete || outcome.turnAborted || outcome.reply)
            return outcome;
    }
    return {
        reply: '',
        taskComplete: false,
        turnAborted: false,
        abortReason: '',
        file: '',
    };
}
async function extractCodexOutcomeFromRollout(file) {
    const outcome = {
        reply: '',
        taskComplete: false,
        turnAborted: false,
        abortReason: '',
        file,
    };
    try {
        const raw = await fs.readFile(file, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
            if (!line.trim())
                continue;
            const parsed = JSON.parse(line);
            if (!isRecord(parsed) || !isRecord(parsed.payload))
                continue;
            if (parsed.type === 'event_msg' && parsed.payload.type === 'task_complete') {
                const message = parsed.payload.last_agent_message;
                if (typeof message === 'string' && message.trim())
                    outcome.reply = normalizeAssistantReply(message);
                outcome.taskComplete = true;
            }
            if (parsed.type === 'event_msg' && parsed.payload.type === 'agent_message') {
                const message = parsed.payload.message;
                if (typeof message === 'string' && message.trim())
                    outcome.reply = normalizeAssistantReply(message);
            }
            if (parsed.type === 'event_msg' && parsed.payload.type === 'turn_aborted') {
                outcome.turnAborted = true;
                const reason = parsed.payload.reason;
                outcome.abortReason = typeof reason === 'string' ? reason : '';
            }
        }
        if (outcome.turnAborted && !outcome.taskComplete) {
            return {
                ...outcome,
                reply: '',
            };
        }
        return outcome;
    }
    catch {
        return outcome;
    }
}
function startCodexRolloutEventBridge(input) {
    const sessionsDir = path.join(input.codexHome, 'sessions');
    const offsets = new Map();
    const pendingText = new Map();
    let firstFileDetectedAtMs = null;
    let firstRolloutEventAtMs = null;
    let firstProjectedEventAtMs = null;
    let stopped = false;
    let scanning = false;
    let timer = null;
    const scan = async () => {
        if (stopped || scanning)
            return;
        scanning = true;
        try {
            const files = await listFiles(sessionsDir);
            const candidates = (await Promise.all(files
                .filter((file) => file.endsWith('.jsonl'))
                .map(async (file) => {
                try {
                    const stat = await fs.stat(file);
                    return stat.mtimeMs >= input.startedAtMs - 10_000 ? { file, size: stat.size } : null;
                }
                catch {
                    return null;
                }
            }))).filter((file) => Boolean(file));
            if (candidates.length > 0 && firstFileDetectedAtMs === null) {
                firstFileDetectedAtMs = Date.now();
                await input.emit('codex.rollout.first_file_detected', {
                    durationMs: firstFileDetectedAtMs - input.startedAtMs,
                    sinceHermesStartMs: firstFileDetectedAtMs - input.startedAtMs,
                    fileCount: candidates.length,
                    files: candidates.slice(0, 3).map((candidate) => path.relative(input.codexHome, candidate.file)),
                });
            }
            for (const candidate of candidates) {
                const offset = offsets.get(candidate.file) ?? 0;
                if (candidate.size <= offset)
                    continue;
                const chunk = await readFileRange(candidate.file, offset, candidate.size);
                offsets.set(candidate.file, candidate.size);
                const buffered = `${pendingText.get(candidate.file) || ''}${chunk}`;
                const lines = buffered.split(/\r?\n/);
                pendingText.set(candidate.file, lines.pop() || '');
                const rolloutFile = path.relative(input.codexHome, candidate.file);
                for (const line of lines) {
                    const parsed = parseJsonLine(line);
                    if (!parsed)
                        continue;
                    if (firstRolloutEventAtMs === null) {
                        firstRolloutEventAtMs = Date.now();
                        const payload = isRecord(parsed.payload) ? parsed.payload : {};
                        await input.emit('codex.rollout.first_event_seen', {
                            durationMs: firstRolloutEventAtMs - input.startedAtMs,
                            sinceHermesStartMs: firstRolloutEventAtMs - input.startedAtMs,
                            rolloutFile,
                            rolloutType: typeof parsed.type === 'string' ? parsed.type : '',
                            payloadType: typeof payload.type === 'string' ? payload.type : '',
                            rolloutTimestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
                        });
                    }
                    const events = projectCodexRolloutEvents(parsed, rolloutFile);
                    for (const event of events) {
                        if (firstProjectedEventAtMs === null) {
                            firstProjectedEventAtMs = Date.now();
                            await input.emit('codex.rollout.first_projected_event', {
                                durationMs: firstProjectedEventAtMs - input.startedAtMs,
                                sinceHermesStartMs: firstProjectedEventAtMs - input.startedAtMs,
                                projectedType: event.type,
                                rolloutFile,
                            });
                        }
                        await input.emit(event.type, event.payload);
                    }
                }
            }
        }
        catch (error) {
            await input.emit('codex.rollout.bridge_error', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        finally {
            scanning = false;
        }
    };
    const flushPending = async () => {
        for (const [file, line] of pendingText.entries()) {
            const parsed = parseJsonLine(line);
            if (!parsed)
                continue;
            const rolloutFile = path.relative(input.codexHome, file);
            if (firstRolloutEventAtMs === null) {
                firstRolloutEventAtMs = Date.now();
                const payload = isRecord(parsed.payload) ? parsed.payload : {};
                await input.emit('codex.rollout.first_event_seen', {
                    durationMs: firstRolloutEventAtMs - input.startedAtMs,
                    sinceHermesStartMs: firstRolloutEventAtMs - input.startedAtMs,
                    rolloutFile,
                    rolloutType: typeof parsed.type === 'string' ? parsed.type : '',
                    payloadType: typeof payload.type === 'string' ? payload.type : '',
                    rolloutTimestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
                });
            }
            const events = projectCodexRolloutEvents(parsed, rolloutFile);
            for (const event of events) {
                if (firstProjectedEventAtMs === null) {
                    firstProjectedEventAtMs = Date.now();
                    await input.emit('codex.rollout.first_projected_event', {
                        durationMs: firstProjectedEventAtMs - input.startedAtMs,
                        sinceHermesStartMs: firstProjectedEventAtMs - input.startedAtMs,
                        projectedType: event.type,
                        rolloutFile,
                    });
                }
                await input.emit(event.type, event.payload);
            }
        }
        pendingText.clear();
    };
    timer = setInterval(() => {
        void scan();
    }, 500);
    void scan();
    return {
        stop: async () => {
            stopped = true;
            if (timer)
                clearInterval(timer);
            while (scanning) {
                await sleep(50);
            }
            stopped = false;
            await scan();
            await flushPending();
            stopped = true;
        },
    };
}
async function readFileRange(file, start, end) {
    const length = Math.max(0, end - start);
    if (length === 0)
        return '';
    const handle = await fs.open(file, 'r');
    try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        return buffer.subarray(0, bytesRead).toString('utf8');
    }
    finally {
        await handle.close();
    }
}
const STDERR_TIMING_PREFIXES = [
    { prefix: 'ALTSELFS_CODEX_TIMING ', eventType: 'codex.timing', source: 'stderr' },
    { prefix: 'ALTSELFS_HERMES_TIMING ', eventType: 'hermes.timing', source: 'stderr' },
];
function emitRuntimeTimingFromStderrChunk(buffer, chunk, emitTiming) {
    const combined = buffer + chunk;
    const lines = combined.split(/\r?\n/);
    const nextBuffer = lines.pop() || '';
    for (const line of lines) {
        emitRuntimeTimingFromStderrLine(line, emitTiming);
    }
    return nextBuffer;
}
function flushRuntimeTimingFromStderrBuffer(buffer, emitTiming) {
    if (buffer.trim()) {
        emitRuntimeTimingFromStderrLine(buffer, emitTiming);
    }
    return '';
}
function emitRuntimeTimingFromStderrLine(line, emitTiming) {
    for (const timingPrefix of STDERR_TIMING_PREFIXES) {
        const prefixIndex = line.indexOf(timingPrefix.prefix);
        if (prefixIndex < 0)
            continue;
        const rawPayload = line.slice(prefixIndex + timingPrefix.prefix.length).trim();
        const parsed = parseJsonValue(rawPayload);
        if (!isRecord(parsed))
            return;
        emitTiming(timingPrefix.eventType, {
            source: timingPrefix.source,
            ...safeJson(parsed),
        });
        return;
    }
}
function projectCodexRolloutEvents(parsed, rolloutFile) {
    const payload = isRecord(parsed.payload) ? parsed.payload : {};
    const rolloutType = typeof parsed.type === 'string' ? parsed.type : '';
    const payloadType = typeof payload.type === 'string' ? payload.type : '';
    const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : null;
    const base = {
        rolloutFile,
        rolloutType,
        payloadType,
        rolloutTimestamp: timestamp,
    };
    if (rolloutType === 'event_msg' && payloadType === 'warning') {
        const message = typeof payload.message === 'string' ? payload.message : '';
        const timingPrefix = 'ALTSELFS_CODEX_TIMING ';
        if (message.startsWith(timingPrefix)) {
            const parsedTiming = parseJsonValue(message.slice(timingPrefix.length));
            if (isRecord(parsedTiming)) {
                return [{
                        type: 'codex.timing',
                        payload: {
                            ...base,
                            ...safeJson(parsedTiming),
                        },
                    }];
            }
        }
    }
    if (rolloutType === 'response_item' && payloadType === 'function_call') {
        const name = typeof payload.name === 'string' ? payload.name : 'function_call';
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
        const args = typeof payload.arguments === 'string' ? payload.arguments : '';
        const parsedArgs = parseJsonValue(args);
        if (name === 'update_plan') {
            return [{
                    type: 'codex.plan.updated',
                    payload: {
                        ...base,
                        callId,
                        arguments: truncate(args, 12000),
                        parsedArguments: safeJson(parsedArgs),
                    },
                }];
        }
        return [{
                type: 'codex.tool.call',
                payload: {
                    ...base,
                    name,
                    callId,
                    arguments: truncate(args, 12000),
                    parsedArguments: safeJson(parsedArgs),
                },
            }];
    }
    if (rolloutType === 'response_item' && payloadType === 'function_call_output') {
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
        const output = typeof payload.output === 'string' ? payload.output : '';
        return [{
                type: 'codex.tool.output',
                payload: {
                    ...base,
                    callId,
                    output: truncate(output, 16000),
                },
            }];
    }
    if (rolloutType === 'response_item' && payloadType === 'message') {
        const role = typeof payload.role === 'string' ? payload.role : '';
        const message = extractContentItemText(payload.content);
        if (role === 'assistant' && message.trim()) {
            return [{
                    type: 'codex.agent_message',
                    payload: {
                        ...base,
                        message: truncate(normalizeAssistantReply(message), 12000),
                    },
                }];
        }
    }
    if (rolloutType === 'event_msg' && payloadType === 'agent_message') {
        const message = typeof payload.message === 'string' ? payload.message : '';
        if (!message.trim())
            return [];
        return [{
                type: 'codex.agent_message',
                payload: {
                    ...base,
                    message: truncate(normalizeAssistantReply(message), 12000),
                },
            }];
    }
    if (rolloutType === 'event_msg' && payloadType === 'task_complete') {
        const message = typeof payload.last_agent_message === 'string' ? payload.last_agent_message : '';
        return [{
                type: 'codex.task_complete',
                payload: {
                    ...base,
                    lastAgentMessage: truncate(normalizeAssistantReply(message), 12000),
                },
            }];
    }
    if (rolloutType === 'event_msg' && payloadType === 'turn_aborted') {
        return [{
                type: 'codex.turn_aborted',
                payload: {
                    ...base,
                    reason: typeof payload.reason === 'string' ? payload.reason : null,
                },
            }];
    }
    return [];
}
function parseJsonValue(value) {
    if (!value.trim())
        return null;
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function parseJsonLine(line) {
    if (!line.trim())
        return null;
    try {
        const parsed = JSON.parse(line);
        return isRecord(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
        // DeepSeek sometimes emits Python-style content item strings with single quotes.
    }
    const pythonStyleText = extractPythonStyleContentItemText(trimmed);
    return pythonStyleText || trimmed;
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
function extractPythonStyleContentItemText(value) {
    const match = value.match(/^\s*\[\s*\{\s*['"]type['"]\s*:\s*['"]text['"]\s*,\s*['"]text['"]\s*:\s*(['"])([\s\S]*)\1\s*\}\s*\]\s*$/);
    if (!match?.[2])
        return '';
    return match[2]
        .replace(/\\n/g, '\n')
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .trim();
}
async function listFiles(dir) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const nested = await Promise.all(entries.map((entry) => {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory())
                return listFiles(entryPath);
            if (entry.isFile())
                return Promise.resolve([entryPath]);
            return Promise.resolve([]);
        }));
        return nested.flat();
    }
    catch {
        return [];
    }
}
