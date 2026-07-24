import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCleanTurnContext, upsertAgentSandboxControlPlane, } from '../agent-context-store.js';
import { collectGeneratedWorkspaceArtifacts, ingestWorkspaceAttachments } from '../artifact-ingestion.js';
import { createPersonalDataDynamictools } from '../tools/personal-data.js';
import { LocalProfileStore } from '../profile-store.js';
import { createRunCancelledError, isAgentRunCancelledError, isRunCancelled, registerActiveRun, unregisterActiveRun, } from '../run-control.js';
import { calculateDirectoryBytes, prepareRuntimeDirectories, readSandboxState, resolveRuntimePaths, writeSandboxState, } from '../sandbox-runtime.js';
import { buildAgentRunUsage, readHermesUsageSnapshot } from '../usage-meter.js';
import { id, isRecord, nowIso, safeJson, truncate } from '../util.js';
import { resolveHermesApiKey, resolveHermesModelSelection } from './llm-provider.js';
export const HERMES_PROMPT_CACHE_TTL = '1h';
export const ALTSELFS_HERMES_DYNAMIC_USER_CONTEXT_ENV = 'ALTSELFS_HERMES_DYNAMIC_USER_CONTEXT';
const ALTSELFS_RUNTIME_CONTEXT_PLUGIN_NAME = 'altselfs-runtime-context';
const ALTSELFS_RUNTIME_CONTEXT_PLUGIN_MANIFEST = [
    `name: ${ALTSELFS_RUNTIME_CONTEXT_PLUGIN_NAME}`,
    'version: "0.1.0"',
    'description: "Inject Altselfs per-turn runtime context into the current user message without persisting it."',
    'hooks:',
    '  - pre_llm_call',
    '',
].join('\n');
const ALTSELFS_RUNTIME_CONTEXT_PLUGIN_SOURCE = [
    '"""Altselfs per-turn context injection for Hermes."""',
    '',
    'import os',
    '',
    `ENV_KEY = "${ALTSELFS_HERMES_DYNAMIC_USER_CONTEXT_ENV}"`,
    '',
    '',
    'def _inject_runtime_context(**_kwargs):',
    '    context = os.getenv(ENV_KEY, "").strip()',
    '    if not context:',
    '        return None',
    '    return {"context": context}',
    '',
    '',
    'def register(ctx):',
    '    ctx.register_hook("pre_llm_call", _inject_runtime_context)',
    '',
].join('\n');
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
        const hermesUsageLogPath = path.join(workspace, '.altselfs-runtime', `hermes-usage-${runId}.jsonl`);
        const selectedCodexModel = resolveSelectedCodexModel(this.config, request);
        const codexModelSelection = resolveCodexModelSelection(this.config, selectedCodexModel);
        const hermesModelSelection = resolveHermesModelSelection(this.config, request.metadata?.hermesModel);
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
        await this.prepareHomes(runtimePaths, codexModelSelection, hermesModelSelection);
        await fs.mkdir(path.dirname(hermesUsageLogPath), { recursive: true });
        await emit('hermes.runtime.prepare_homes_timing', {
            durationMs: Date.now() - prepareHomesStartedAtMs,
            sinceRunStartMs: Date.now() - runtimeRunStartedAtMs,
            hermesHome,
            codexHome,
            workspace,
            codexModelProvider: codexModelSelection.provider || null,
            codexModel: codexModelSelection.model || null,
            hermesProvider: hermesModelSelection.provider,
            hermesModel: hermesModelSelection.model,
        });
        const hermesUsageBefore = await readHermesUsageSnapshot(hermesHome, resumeSessionId || previousHermesSessionId || null);
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
        const investorId = typeof request.metadata?.investorId === 'string' && request.metadata.investorId.trim()
            ? request.metadata.investorId.trim()
            : request.userId;
        const selectedAgentProfileId = typeof request.metadata?.selectedAgentProfileId === 'string' && request.metadata.selectedAgentProfileId.trim()
            ? request.metadata.selectedAgentProfileId.trim()
            : '';
        const connectorScope = getConnectorScope(request.metadata);
        const enabledInfoSources = getEnabledInfoSourceNames(request.metadata, connectorScope.enabledConnectorKeys);
        const enabledCompetitortools = getEnabledCompetitortoolNames(request.metadata, connectorScope.enabledConnectorKeys);
        const personalDatatoolNames = await getPersonalDatatoolNames(this.config, investorId, request.userId, connectorScope);
        const profileLoadStartedAtMs = Date.now();
        const profileSnapshot = await this.profileStore.getSnapshot(request.userId);
        const hermesUserProfile = await readHermesUserProfile(hermesHome);
        const combinedProfile = combineProfileBlocks(profileSnapshot.rendered, hermesUserProfile);
        const ephemeralArtifactContext = buildEphemeralArtifactContext(cleanContext.artifactContext);
        const hermesStableSystemPrompt = buildHermesStableSystemPrompt();
        const hermesDynamicUserContext = buildHermesDynamicUserContext({
            artifactContext: ephemeralArtifactContext,
            renderedProfile: combinedProfile,
            selectedAgentProfileId,
            enabledInfoSources,
            enabledCompetitortools,
            personalDatatoolNames,
            codexModelProvider: codexModelSelection.provider,
            sandboxExecEnabled: this.config.sandboxExecEnabled,
        });
        await emit('hermes.profile.loaded', {
            profileStorePath: this.config.profileStorePath,
            userId: request.userId,
            entryCount: profileSnapshot.entries.length,
            hermesUserProfileChars: hermesUserProfile.length,
            injected: Boolean(combinedProfile),
            renderedProfile: truncate(combinedProfile, 4000),
            ephemeralPromptChars: hermesStableSystemPrompt.length,
            dynamicUserContextChars: hermesDynamicUserContext.length,
            ephemeralArtifactContextChars: ephemeralArtifactContext.length,
            cleanUserMessageChars: currentUserMessage.length,
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
            model: hermesModelSelection.model,
            provider: hermesModelSelection.provider,
            baseUrl: hermesModelSelection.baseUrl,
            apiKeyEnv: hermesModelSelection.apiKeyEnv,
            apiKeyPresent: Boolean(resolveHermesApiKey(hermesModelSelection)),
            codexModel: codexModelSelection.model || null,
            codexModelProvider: codexModelSelection.provider || null,
            selectedAgentProfileId: selectedAgentProfileId || null,
            enabledConnectorCount: connectorScope.enabledConnectorKeys.length,
            enabledInfoSourceCount: enabledInfoSources.length,
            enabledCompetitortoolCount: enabledCompetitortools.length,
            personalDatatoolCount: personalDatatoolNames.length,
            cleanUserMessageChars: currentUserMessage.length,
            ephemeralPromptChars: hermesStableSystemPrompt.length,
            dynamicUserContextChars: hermesDynamicUserContext.length,
            ephemeralArtifactContextChars: ephemeralArtifactContext.length,
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
            '--toolsets',
            'altselfs_codex',
            '--max-turns',
            String(this.config.hermesMaxTurns),
            '-q',
            currentUserMessage,
        ];
        let result;
        const rolloutBridge = await startCodexRolloutEventBridge({
            codexHome,
            startedAtMs,
            emit,
        });
        try {
            result = await this.spawnHermes(args, {
                runId,
                userId: request.userId,
                investorId,
                threadId: request.threadId || 'default',
                currentUserMessage,
                selectedAgentProfileId,
                enabledCompetitortools,
                enabledInfoSources,
                connectorScope,
                personalDatatoolNames,
                hermesHome,
                codexHome,
                workspace,
                statePath: runtimePaths.statePath || '',
                hermesModelSelection,
                codexModelSelection,
                hermesStableSystemPrompt,
                hermesDynamicUserContext,
                hermesUsageLogPath,
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
            await emit('codex.turn_aborted.detected', {
                reason: codexOutcome.abortReason || null,
                file: codexOutcome.file || null,
                lastAgentMessage: codexOutcome.reply ? truncate(codexOutcome.reply, 4000) : null,
                handledByHermes: true,
            });
        }
        const codexReply = codexOutcome.reply;
        const baseReply = normalizeAssistantReply(extractReply(combinedOutput).trim());
        const generatedArtifacts = await collectGeneratedWorkspaceArtifacts(this.config, request, runtimePaths, runId, startedAtMs);
        if (generatedArtifacts.artifacts.length > 0 || generatedArtifacts.warnings.length > 0) {
            await emit('workspace_artifacts.generated', {
                count: generatedArtifacts.artifacts.length,
                artifacts: generatedArtifacts.artifacts.map((artifact) => ({
                    id: artifact.id,
                    name: artifact.name,
                    kind: artifact.kind,
                    mimeType: artifact.mimeType,
                    sizeBytes: artifact.sizeBytes,
                    metadata: artifact.metadata,
                })),
                warnings: generatedArtifacts.warnings,
            });
        }
        const reply = appendGeneratedArtifactLinks(baseReply, generatedArtifacts.artifacts);
        const usage = await buildAgentRunUsage({
            config: this.config,
            runId,
            taskLabel: currentUserMessage,
            hermesHome,
            hermesUsageLogPath,
            hermesSessionId: sessionId || previousHermesSessionId || null,
            hermesBefore: hermesUsageBefore,
            hermesModel: hermesModelSelection.model,
            hermesProvider: hermesModelSelection.provider,
            codexHome,
            codexModel: codexModelSelection.model || this.config.codexModel || 'gpt-5.5',
            startedAtMs,
        });
        await emit('billing.usage_measured', {
            pricingVersion: usage.pricingVersion,
            totalCredits: usage.totalCredits,
            hermesCredits: usage.hermes.credits,
            codexCredits: usage.codex.credits,
        });
        await emit('hermes.source_runtime.completed', {
            sessionId: sessionId || null,
            codexReply: codexReply || null,
            hermesReply: reply || null,
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
                runId,
                investorId,
                hermesModel: hermesModelSelection.model,
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
            reply: reply || 'Hermes Agent completed the run, but did not return a final response.',
            events,
            raw: {
                runId,
                hermesSessionId: sessionId,
                hermesHome,
                codexHome,
                workspace,
                profileStorePath: this.config.profileStorePath,
                generatedArtifacts: generatedArtifacts.artifacts.map(publicGeneratedArtifact),
                usage,
            },
        };
    }
    async prepareHomes(paths, codexModelSelection, hermesModelSelection) {
        await prepareRuntimeDirectories(paths);
        await prepareHermesRuntimeContextPlugin(paths.hermesHome);
        const codexMcpServerPath = await resolveCodexMcpServerPath();
        const codexMcpEnvLines = buildCodexMcpEnvEntries(this.config, codexModelSelection)
            .map(([key, value]) => `      ${key}: ${yamlString(value)}`);
        await fs.writeFile(path.join(paths.hermesHome, 'config.yaml'), [
            'model:',
            `  provider: ${yamlString(hermesModelSelection.provider)}`,
            `  default: ${yamlString(hermesModelSelection.model)}`,
            `  base_url: ${yamlString(hermesModelSelection.baseUrl)}`,
            `  api_mode: ${yamlString(hermesModelSelection.apiMode)}`,
            `  key_env: ${yamlString(hermesModelSelection.apiKeyEnv)}`,
            '',
            ...hermesProviderConfigYamlLines(hermesModelSelection),
            '',
            ...buildHermesPromptCachingYamlLines(),
            '',
            'terminal:',
            `  cwd: ${yamlString(paths.workspace)}`,
            '',
            'mcp_servers:',
            '  altselfs_codex:',
            '    enabled: true',
            `    command: ${yamlString(process.execPath)}`,
            '    args:',
            `      - ${yamlString(codexMcpServerPath)}`,
            '    timeout: 900',
            '    connect_timeout: 30',
            '    supports_parallel_tool_calls: false',
            '    tools:',
            '      include:',
            '        - codex_agent',
            '      resources: false',
            '      prompts: false',
            '    env:',
            ...codexMcpEnvLines,
            '',
            'display:',
            '  tool_activity: compact',
            '',
            'memory:',
            '  memory_enabled: true',
            '  user_profile_enabled: true',
            `  nudge_interval: ${this.config.memoryReviewMode === 'inline' ? this.config.hermesMemoryNudgeInterval : 0}`,
            '',
            'plugins:',
            '  enabled:',
            `    - ${yamlString(ALTSELFS_RUNTIME_CONTEXT_PLUGIN_NAME)}`,
            '',
            'security:',
            '  allow_lazy_installs: false',
            '',
        ].join('\n'), 'utf8');
        await this.writeCodexConfig(paths, codexModelSelection);
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
                    HERMES_EPHEMERAL_SYSTEM_PROMPT: paths.hermesStableSystemPrompt,
                    HERMES_DISABLE_LAZY_INSTALLS: '1',
                    [ALTSELFS_HERMES_DYNAMIC_USER_CONTEXT_ENV]: paths.hermesDynamicUserContext,
                    ALTSELFS_RUN_ID: paths.runId,
                    ALTSELFS_USER_ID: paths.userId,
                    ALTSELFS_INVESTOR_ID: paths.investorId,
                    ALTSELFS_THREAD_ID: paths.threadId,
                    ALTSELFS_WORKSPACE: paths.workspace,
                    ALTSELFS_STATE_PATH: paths.statePath,
                    ALTSELFS_CODEX_HOME: paths.codexHome,
                    ALTSELFS_HERMES_MODEL: paths.hermesModelSelection.model,
                    ALTSELFS_HERMES_PROVIDER: paths.hermesModelSelection.provider,
                    ALTSELFS_HERMES_BASE_URL: paths.hermesModelSelection.baseUrl,
                    ALTSELFS_HERMES_API_KEY_ENV: paths.hermesModelSelection.apiKeyEnv,
                    ALTSELFS_SELECTED_AGENT_PROFILE_ID: paths.selectedAgentProfileId,
                    ALTSELFS_CONNECTOR_SCOPE_JSON: JSON.stringify(paths.connectorScope),
                    ALTSELFS_ENABLED_INFO_SOURCES_JSON: JSON.stringify(paths.enabledInfoSources),
                    ALTSELFS_CODEX_MODEL: paths.codexModelSelection.model || '',
                    ALTSELFS_CODEX_MODEL_PROVIDER: paths.codexModelSelection.provider || '',
                    ALTSELFS_HERMES_TIMING: '1',
                    ALTSELFS_HERMES_USAGE_LOG_PATH: paths.hermesUsageLogPath,
                    ALTSELFS_CODEX_TIMING: '1',
                    ALTSELFS_CODEX_DISABLE_LOCAL_ENVIRONMENT: this.config.disableLocalEnvironmentForGeneral ? '1' : '0',
                    ALTSELFS_CODEX_PERSONALITY: 'pragmatic',
                    ALTSELFS_CODEX_SANDBOX_EXEC_DYNAMIC_TOOL: this.config.sandboxExecEnabled ? '1' : '0',
                    ALTSELFS_CODEX_COMPETITOR_DYNAMIC_TOOLS: paths.enabledCompetitortools.join(','),
                    ALTSELFS_CODEX_PERSONAL_DATA_DYNAMIC_TOOLS: paths.personalDatatoolNames.join(','),
                    ALTSELFS_CODEX_WEB_SEARCH_DYNAMIC_TOOL: paths.codexModelSelection.provider === 'openai' ? '0' : '1',
                    ALTSELFS_CODEX_DEVELOPER_INSTRUCTIONS: buildCodexDeveloperInstructions(),
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
                competitorToolNames: paths.enabledCompetitortools,
                personalDatatoolNames: paths.personalDatatoolNames,
            });
            let stdout = '';
            let stderr = '';
            let firstStdoutAtMs = null;
            let firstStderrAtMs = null;
            let stderrTimingBuffer = '';
            const timeoutMs = Math.max(1_000, this.config.hermesSourceRuntimeTimeoutMs);
            const timeout = setTimeout(() => {
                emitTiming('hermes.process.timeout', {
                    durationMs: Date.now() - spawnedAtMs,
                    timeoutMs,
                });
                child.kill('SIGTERM');
                reject(new Error(`Hermes source runtime timed out after ${timeoutMs}ms`));
            }, timeoutMs);
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
function hermesProviderConfigYamlLines(selection) {
    if (!selection.provider || selection.provider === 'openrouter')
        return [];
    return [
        'providers:',
        `  ${selection.provider}:`,
        `    name: ${yamlString(selection.provider.toUpperCase())}`,
        `    base_url: ${yamlString(selection.baseUrl)}`,
        `    key_env: ${yamlString(selection.apiKeyEnv)}`,
        `    default_model: ${yamlString(selection.model)}`,
        `    transport: ${yamlString(selection.apiMode)}`,
    ];
}
function tomlString(value) {
    return JSON.stringify(value);
}
async function resolveCodexMcpServerPath() {
    const compiledNextToRuntime = fileURLToPath(new URL('./codex-agent-mcp-server.js', import.meta.url));
    if (await fileExists(compiledNextToRuntime))
        return compiledNextToRuntime;
    const builtFromServiceRoot = path.resolve(process.cwd(), 'dist', 'hermes', 'codex-agent-mcp-server.js');
    if (await fileExists(builtFromServiceRoot))
        return builtFromServiceRoot;
    return compiledNextToRuntime;
}
async function fileExists(file) {
    try {
        await fs.access(file);
        return true;
    }
    catch {
        return false;
    }
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
function buildCodexMcpEnvEntries(config, selection) {
    const entries = new Map();
    const set = (key, value) => {
        if (value !== undefined && value !== '')
            entries.set(key, value);
    };
    const refIfPresent = (key) => {
        if (process.env[key]?.trim())
            set(key, `\${${key}}`);
    };
    set('ALTSELFS_RUN_ID', '${ALTSELFS_RUN_ID}');
    set('ALTSELFS_USER_ID', '${ALTSELFS_USER_ID}');
    set('ALTSELFS_INVESTOR_ID', '${ALTSELFS_INVESTOR_ID}');
    set('ALTSELFS_THREAD_ID', '${ALTSELFS_THREAD_ID}');
    set('ALTSELFS_WORKSPACE', '${ALTSELFS_WORKSPACE}');
    set('ALTSELFS_STATE_PATH', '${ALTSELFS_STATE_PATH}');
    set('ALTSELFS_CODEX_HOME', '${ALTSELFS_CODEX_HOME}');
    set('ALTSELFS_SELECTED_AGENT_PROFILE_ID', '${ALTSELFS_SELECTED_AGENT_PROFILE_ID}');
    set('ALTSELFS_CONNECTOR_SCOPE_JSON', '${ALTSELFS_CONNECTOR_SCOPE_JSON}');
    set('ALTSELFS_ENABLED_INFO_SOURCES_JSON', '${ALTSELFS_ENABLED_INFO_SOURCES_JSON}');
    set('ALTSELFS_CODEX_TIMING', '${ALTSELFS_CODEX_TIMING}');
    set('ALTSELFS_CODEX_SANDBOX_EXEC_DYNAMIC_TOOL', '${ALTSELFS_CODEX_SANDBOX_EXEC_DYNAMIC_TOOL}');
    set('ALTSELFS_CODEX_COMPETITOR_DYNAMIC_TOOLS', '${ALTSELFS_CODEX_COMPETITOR_DYNAMIC_TOOLS}');
    set('ALTSELFS_CODEX_WEB_SEARCH_DYNAMIC_TOOL', '${ALTSELFS_CODEX_WEB_SEARCH_DYNAMIC_TOOL}');
    set('CODEX_HOME', '${CODEX_HOME}');
    set('CODEX_BIN', config.codexBin);
    set('CODEX_MODEL', selection.model || config.codexModel || '');
    set('CODEX_MODEL_PROVIDER', selection.provider || config.codexModelProvider || '');
    set('ALTSELFS_CODEX_MODEL', selection.model || config.codexModel || '');
    set('ALTSELFS_CODEX_MODEL_PROVIDER', selection.provider || config.codexModelProvider || '');
    set('CODEX_OPENAI_AUTH_JSON_PATH', config.codexOpenAiAuthJsonPath || '');
    set('CODEX_OPENAI_PROXY_URL', config.codexOpenAiProxyUrl || '');
    set('CODEX_WEB_SEARCH_MODE', config.codexWebSearchMode);
    set('OPENROUTER_BASE_URL', config.openRouterBaseUrl);
    set('OPENROUTER_API_KEY_ENV', config.openRouterApiKeyEnv);
    set('OPENROUTER_APP_TITLE', config.openRouterAppTitle);
    set('RAPIDAPI_KEY_ENV', config.rapidApiKeyEnv);
    set('RAPIDAPI_REQUEST_TIMEOUT_MS', String(config.rapidApiRequestTimeoutMs));
    set('SERPAPI_API_KEY_ENV', config.serpApiKeyEnv);
    set('SERPER_API_KEY_ENV', config.serperApiKeyEnv);
    set('GOOGLE_CSE_API_KEY_ENV', config.googleCseApiKeyEnv);
    set('GOOGLE_CSE_ID_ENV', config.googleCseIdEnv);
    set('BING_SEARCH_API_KEY_ENV', config.bingSearchApiKeyEnv);
    set('BING_SEARCH_ENDPOINT', config.bingSearchEndpoint);
    set('WEB_SEARCH_PROVIDER', config.webSearchProvider);
    set('WEB_SEARCH_TIMEOUT_MS', String(config.webSearchTimeoutMs));
    set('OUTBOUND_PROXY_URL', config.outboundProxyUrl || '');
    set('LARK_CLI_BIN', config.larkCliBin);
    set('LARK_CLI_HOME_ROOT', config.larkCliHomeRoot);
    set('LARK_CLI_TIMEOUT_MS', String(config.larkCliTimeoutMs));
    set('LARK_CLI_PROXY_URL', config.larkCliProxyUrl || '');
    set('SANDBOX_EXEC_ENABLED', config.sandboxExecEnabled ? 'true' : 'false');
    set('SANDBOX_DOCKER_SOCKET_PATH', config.sandboxExecDockerSocketPath);
    set('SANDBOX_EXEC_IMAGE', config.sandboxExecImage);
    set('SANDBOX_EXEC_NETWORK_ENABLED', config.sandboxExecNetworkEnabled ? 'true' : 'false');
    set('SANDBOX_EXEC_PROXY_URL', config.sandboxExecProxyUrl || '');
    set('STORAGE_BACKEND', config.storageBackend);
    set('ALTSELFS_AGENT_ENV', config.env);
    refIfPresent('NODE_ENV');
    refIfPresent('DATABASE_URL');
    refIfPresent('AGENT_CONTEXT_DATABASE_URL');
    refIfPresent('CREDENTIAL_VAULT_MASTER_KEY_FILE');
    refIfPresent('CREDENTIAL_VAULT_MASTER_KEY_BASE64');
    refIfPresent('CREDENTIAL_VAULT_KEY_VERSION');
    refIfPresent(config.openRouterApiKeyEnv);
    refIfPresent(config.rapidApiKeyEnv);
    refIfPresent(config.serpApiKeyEnv);
    refIfPresent(config.serperApiKeyEnv);
    refIfPresent(config.googleCseApiKeyEnv);
    refIfPresent(config.googleCseIdEnv);
    refIfPresent(config.bingSearchApiKeyEnv);
    refIfPresent('RAPIDAPI_QUOTA_SNAPSHOT_PATH');
    refIfPresent('FEISHU_APP_ID');
    refIfPresent('FEISHU_APP_SECRET');
    refIfPresent('GOOGLE_CLIENT_ID');
    refIfPresent('GOOGLE_CLIENT_SECRET');
    refIfPresent('META_GRAPH_API_VERSION');
    return Array.from(entries.entries()).sort(([a], [b]) => a.localeCompare(b));
}
const COMPETITOR_INFO_SOURCE_TO_TOOL = {
    similarweb_api1: 'altselfs_similarweb_api1',
    semrush13: 'altselfs_semrush13',
    semrush8: 'altselfs_semrush8',
    domain_metrics_check: 'altselfs_domain_metrics_check',
};
function getEnabledCompetitortoolNames(metadata, enabledConnectorKeys) {
    const providers = getEnabledInfoSourceNames(metadata, enabledConnectorKeys);
    const names = providers
        .map((provider) => COMPETITOR_INFO_SOURCE_TO_TOOL[provider])
        .filter((item) => Boolean(item));
    return Array.from(new Set(names));
}
function getEnabledInfoSourceNames(metadata, enabledConnectorKeys) {
    const value = metadata?.enabledInfoSources;
    if (!Array.isArray(value))
        return [];
    const allowed = new Set(enabledConnectorKeys || []);
    const names = value
        .map((item) => {
        if (typeof item === 'string')
            return item.toLowerCase();
        if (!isRecord(item))
            return null;
        return typeof item.provider === 'string' ? item.provider.toLowerCase() : null;
    })
        .filter((provider) => provider ? allowed.has(provider) : false)
        .filter((item) => Boolean(item));
    return Array.from(new Set(names));
}
function getConnectorScope(metadata) {
    const scope = isRecord(metadata?.connectorScope) ? metadata.connectorScope : null;
    const enabledConnectorKeys = normalizeOptionalStringArray(scope?.enabledConnectorKeys, true);
    const enabledConnectionIds = normalizeOptionalStringArray(scope?.enabledConnectionIds, false);
    const personalProviderKeys = enabledConnectorKeys.filter((key) => key === 'gmail' || key === 'feishu' || key === 'meta');
    return { enabledConnectorKeys, enabledConnectionIds, personalProviderKeys };
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
async function getPersonalDatatoolNames(config, investorId, userId, connectorScope) {
    try {
        const tools = await createPersonalDataDynamictools(config, {
            investorId,
            userId,
            enabledProviders: connectorScope?.personalProviderKeys || [],
            enabledConnectionIds: connectorScope?.enabledConnectionIds || [],
        });
        return tools
            .map((tool) => isRecord(tool) && typeof tool.name === 'string' ? tool.name : '')
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
function buildEphemeralArtifactContext(artifactContext) {
    return artifactContext.trim();
}
export function buildHermesStableSystemPrompt() {
    return [
        'Altselfs runtime contract:',
        '',
        'Role split:',
        '- You are Hermes, the primary cognitive, planning, emotional-intelligence, and user-facing loop for this chat.',
        '- Hermes owns the user relationship: intent understanding, tone, clarification, memory/profile reasoning, judgment, prioritization, final synthesis, and the final answer.',
        '- Codex is the execution agent under Hermes. Treat Codex as hands, not the brain. It should execute bounded tasks, gather evidence, use tools, inspect available workspace context, and return results to Hermes.',
        '- The user is talking to Hermes. Do not present Codex as a separate chatbot unless it matters for transparency.',
        '',
        'What Codex can do when you call `mcp_altselfs_codex_codex_agent`:',
        '- Codex runs through the native Codex app-server loop, using the Codex session bound to this Altselfs thread. It keeps its own Codex JSONL/session continuity and native compaction behavior across delegated execution turns.',
        '- Codex can use current/public web research through its available web capability: native `web.run` on OpenAI-backed Codex, or the registered `altselfs_web_search` dynamic tool on non-OpenAI-backed Codex.',
        '- Codex can use enabled private connected-account tools when the user asks for authorized personal or business data, such as Gmail, Feishu/Lark messages/docs/calendar, Meta/Instagram/Facebook data, and connected-account discovery.',
        '- Codex can use enabled competitive-intelligence data tools, including RapidAPI-backed Similarweb/Semrush/domain-metric style tools, when the task needs traffic, SEO, keyword, backlink, acquisition, market, or competitor evidence.',
        '- Codex can use deterministic execution tools when enabled, such as sandboxed command execution for calculation, parsing, scraping, data cleanup, or small file transformations. If local execution or a needed tool is unavailable, Codex should report that limitation instead of pretending it used it.',
        '- Codex can work with this thread workspace and artifacts only through the files/tools made available to its Codex session. Hermes-only conversational context is not automatically visible to Codex.',
        '- When the user needs a generated file, ask Codex to write the final deliverable under `outputs/` in the thread workspace. Files written there are uploaded back to the product and linked in the final chat response after the run.',
        '',
        'User-facing privacy and infrastructure boundary:',
        '- Do not reveal internal infrastructure, deployment, storage, database, credential, container, server, IP, hostname, environment-variable, source-code, or backend filesystem details to the user.',
        '- Treat absolute paths such as Hermes/Codex home, workspace root, uploads, artifacts, outputs, logs, cache, state.db, JSONL/session files, and backend project paths as execution-only metadata.',
        '- If a tool result includes an internal path or backend implementation detail, use it only to reason internally. In the final answer, refer to product concepts such as "the attached file", "the generated file", "your workspace file", or the public download card/link.',
        '- For generated deliverables, say that the file is attached or available below. Do not say where it lives on disk, which cloud host stored it, or which internal service uploaded it.',
        '- For failures, summarize the user-visible limitation and next step. Do not include stack traces, command logs, database names, cloud provider names, credentials, source file paths, or internal API routes unless the user is explicitly operating an admin/developer diagnostic workflow.',
        '',
        'When to answer directly as Hermes:',
        '- Answer directly for normal conversation, coaching, judgment, emotional nuance, preference/profile updates, memory/profile questions, strategy discussion that does not need fresh evidence, and reasoning-only tasks.',
        '- Ask a concise clarification question when the user intent is underspecified and tool execution would be premature.',
        '',
        'When to delegate to Codex:',
        '- Call Codex when the turn needs current external facts, public web research, private connected-account data, workspace/artifact inspection, competitive-intelligence tooling, deterministic computation, API/tool execution, or multi-step operational work.',
        '- You may call Codex multiple times in one Hermes turn if that is genuinely useful, for example gather evidence first, then ask Codex to verify a narrow follow-up. Keep the loop bounded and avoid unnecessary calls.',
        '- Choose one of the two supported Codex modes in the tool arguments: `general` for normal execution, research, private-data, artifact, calculation, or coding tasks; `competitive_intelligence` for competitor, market, traffic, SEO, keyword, backlink, acquisition, user, revenue, or growth analysis.',
        '',
        'How to delegate:',
        '- Send Codex a concrete task with a clear success condition. Include target entities, dates, accounts, domains, files, or constraints that matter.',
        '- Put necessary Hermes-only background in the Codex `task` or `hermesContext` field. Keep it focused; do not dump the full chat history, full profile, or irrelevant emotional/contextual material.',
        '- Use `expectedReturn` only to guide the shape of Codex output when helpful. Do not force JSON or rigid structure unless Hermes needs machine-readable data.',
        '- Do not ask Codex to make the final user-facing judgment when Hermes should synthesize. Codex should return findings, evidence, execution results, limitations, or a draft when requested.',
        '',
        'After Codex returns:',
        '- Treat Codex output as tool evidence, not as the automatic final response. Decide whether to answer, clarify, call Codex again, or add Hermes-level synthesis.',
        '- In the final answer, be transparent about important limitations and whether evidence came from connected tools, public web, workspace artifacts, or inference.',
        '- Never claim that Hermes or Codex searched, read private accounts, used a platform, inspected files, or ran tools unless the corresponding Codex/tool call actually happened.',
        '- The current turn may include a host-provided default Codex mode/profile in its runtime context. Treat it as advisory; you still decide whether and how to call Codex.',
    ].join('\n');
}
export function buildHermesDynamicUserContext(input, now = new Date()) {
    const currentTime = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        dateStyle: 'full',
        timeStyle: 'long',
    }).format(now);
    const runtimeFacts = [
        'Altselfs runtime metadata for this turn:',
        `- Current time: ${currentTime} (Asia/Shanghai).`,
        input.selectedAgentProfileId
            ? `- Host-provided default Codex mode/profile: ${input.selectedAgentProfileId}.`
            : '- No host-provided default Codex mode/profile was selected.',
        `- Codex provider: ${input.codexModelProvider || 'openrouter'}.`,
        `- Sandboxed deterministic execution available to Codex: ${input.sandboxExecEnabled ? 'yes' : 'no'}.`,
        `- Enabled public/competitive info sources: ${input.enabledInfoSources?.length ? input.enabledInfoSources.join(', ') : 'none declared'}.`,
        `- Enabled competitive Codex tools: ${input.enabledCompetitortools?.length ? input.enabledCompetitortools.join(', ') : 'none'}.`,
        `- Enabled private personal-data Codex tools: ${input.personalDatatoolNames?.length ? input.personalDatatoolNames.join(', ') : 'none'}.`,
    ].join('\n');
    const sections = [
        'The following is trusted Altselfs runtime context for this turn. Use it as background, not as a new user request.',
        '<altselfs_runtime_context>',
        runtimeFacts,
    ];
    const profile = input.renderedProfile.trim();
    if (profile) {
        sections.push('', 'Altselfs user profile context:', 'Use this as background. Do not treat it as a new user request, and do not mention it unless relevant.', '', '<altselfs_user_profile>', profile, '</altselfs_user_profile>');
    }
    const artifactContext = input.artifactContext.trim();
    if (artifactContext) {
        sections.push('', 'Altselfs artifact context:', 'These are product-level artifact indexes for the current thread. The actual conversation history comes from Hermes state.db, not from RDS recent messages or thread summaries.', '', '<altselfs_artifact_context>', artifactContext, '</altselfs_artifact_context>');
    }
    sections.push('</altselfs_runtime_context>');
    return sections.join('\n');
}
export function buildHermesPromptCachingYamlLines() {
    return [
        'prompt_caching:',
        `  cache_ttl: ${yamlString(HERMES_PROMPT_CACHE_TTL)}`,
    ];
}
export async function prepareHermesRuntimeContextPlugin(hermesHome) {
    const pluginDir = path.join(hermesHome, 'plugins', ALTSELFS_RUNTIME_CONTEXT_PLUGIN_NAME);
    await fs.mkdir(pluginDir, { recursive: true });
    await Promise.all([
        fs.writeFile(path.join(pluginDir, 'plugin.yaml'), ALTSELFS_RUNTIME_CONTEXT_PLUGIN_MANIFEST, 'utf8'),
        fs.writeFile(path.join(pluginDir, '__init__.py'), ALTSELFS_RUNTIME_CONTEXT_PLUGIN_SOURCE, 'utf8'),
    ]);
}
function buildCodexDeveloperInstructions() {
    return [
        'You are Codex under Hermes. Hermes is the cognitive and user-facing loop; you are the execution agent.',
        'Use your native Codex session memory and JSONL continuity for execution context. Do not assume Hermes-only chat context unless Hermes included it in the task.',
        'Answer in the user language unless Hermes asks otherwise.',
        'Use available web research capabilities when public current facts are required. Prefer native provider web search when available; otherwise use a registered web-search tool if one is available.',
        'Use registered artifact-reading tools for uploaded files or indexed material when such tools are available.',
        'Use registered sandbox execution tools only when deterministic computation, parsing, scraping, or small workspace file transformations are truly needed. Keep commands scoped to the provided workspace.',
        'Internal paths, runtime homes, workspace roots, state databases, JSONL/session files, source paths, container/cloud hosts, IP addresses, credentials, and environment variables are execution-only. Do not include them in text returned to Hermes or the user.',
        'When you create or transform a file, mention the filename and result only. Do not mention the absolute path; Hermes/product UI will attach or link generated files automatically.',
        'Do not use native local shell, file, patch, image, or repository tools unless explicitly provided by the active Codex environment.',
        'Use private personal-data tools only when the delegated task asks for private-channel content such as Gmail, Feishu/Lark, calendar, docs, messages, or connected accounts.',
        'For competitive intelligence tasks, use enabled competitor-data tools when relevant; label third-party estimates as estimates and separate facts, assumptions, and inference.',
        'Never claim that you searched, read private accounts, used a platform, or called a tool unless the corresponding tool was actually called.',
        'Return the result to Hermes directly. Do not say you will call another tool after the turn ends; either call it or report the limitation.',
        'Never output protocol/content-item arrays such as `[{"type":"text","text":"..."}]` or Python-style variants. Output plain prose or Markdown only.',
    ].join('\n');
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
        const outcome = await extractCodexOutcomeFromRollout(candidate.file, startedAtMs);
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
export async function extractCodexOutcomeFromRollout(file, startedAtMs) {
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
            if (!isCurrentRolloutEvent(parsed, startedAtMs))
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
export async function startCodexRolloutEventBridge(input) {
    const sessionsDir = path.join(input.codexHome, 'sessions');
    const offsets = new Map();
    const pendingText = new Map();
    let firstFileDetectedAtMs = null;
    let firstRolloutEventAtMs = null;
    let firstProjectedEventAtMs = null;
    let stopped = false;
    let scanning = false;
    let timer = null;
    const existingFiles = await listFiles(sessionsDir);
    await Promise.all(existingFiles
        .filter((file) => file.endsWith('.jsonl'))
        .map(async (file) => {
        const stat = await fs.stat(file).catch(() => undefined);
        if (stat)
            offsets.set(file, stat.size);
    }));
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
                const previousOffset = offsets.get(candidate.file) ?? 0;
                const offset = candidate.size < previousOffset ? 0 : previousOffset;
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
                    if (!isCurrentRolloutEvent(parsed, input.startedAtMs))
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
            if (!isCurrentRolloutEvent(parsed, input.startedAtMs))
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
        const passthroughType = typeof parsed.type === 'string' ? parsed.type : '';
        if (passthroughType === 'codex.agent_message.delta' || passthroughType === 'codex.agent_message.final') {
            const payload = isRecord(parsed.payload) ? parsed.payload : {};
            emitTiming(passthroughType, {
                source: timingPrefix.source,
                timingTimestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
                ...safeJson(payload),
            });
            return;
        }
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
const ROLLOUT_EVENT_CLOCK_SKEW_MS = 2_000;
function isCurrentRolloutEvent(parsed, startedAtMs) {
    if (typeof parsed.timestamp !== 'string')
        return false;
    const timestampMs = Date.parse(parsed.timestamp);
    if (!Number.isFinite(timestampMs))
        return false;
    return timestampMs >= startedAtMs - ROLLOUT_EVENT_CLOCK_SKEW_MS;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function appendGeneratedArtifactLinks(reply, artifacts) {
    const links = artifacts
        .map(publicGeneratedArtifact)
        .filter((artifact) => artifact.downloadPath)
        .map((artifact) => `- [${escapeMarkdownLinkText(artifact.name)}](${artifact.downloadPath})`);
    if (links.length === 0)
        return reply;
    return [
        reply.trim() || 'Done.',
        '',
        'Generated files:',
        ...links,
    ].join('\n');
}
function publicGeneratedArtifact(artifact) {
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    return {
        id: artifact.id || '',
        name: artifact.name,
        kind: artifact.kind,
        mimeType: artifact.mimeType || null,
        sizeBytes: artifact.sizeBytes || null,
        downloadPath: typeof metadata.downloadPath === 'string' ? metadata.downloadPath : null,
    };
}
function escapeMarkdownLinkText(value) {
    return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
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
