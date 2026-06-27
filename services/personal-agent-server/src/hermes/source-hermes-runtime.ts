import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadCleanTurnContext,
  upsertAgentSandboxControlPlane,
  type AgentSandboxControlPlaneInput,
} from '../agent-context-store.js';
import { ingestWorkspaceAttachments } from '../artifact-ingestion.js';
import type { ServerConfig } from '../config.js';
import type { MemoryReviewJobStore } from '../memory-review-queue.js';
import { LocalProfileStore, type UserProfileStore } from '../profile-store.js';
import {
  createRunCancelledError,
  isAgentRunCancelledError,
  isRunCancelled,
  registerActiveRun,
  unregisterActiveRun,
} from '../run-control.js';
import type { RuntimeStateStore } from '../runtime-state-store.js';
import {
  calculateDirectoryBytes,
  prepareRuntimeDirectories,
  readSandboxState,
  resolveRuntimePaths,
  type RuntimePaths,
  writeSandboxState,
} from '../sandbox-runtime.js';
import type { AgentEvent, SourceAgentRunResult, TurnStartRequest } from '../types.js';
import { id, isRecord, nowIso, safeJson, truncate } from '../util.js';

export class HermesSourceRuntime {
  private profileStore: UserProfileStore;

  constructor(
    private config: ServerConfig,
    private memoryReviewQueue?: MemoryReviewJobStore,
    profileStore?: UserProfileStore,
    private runtimeStateStore?: RuntimeStateStore
  ) {
    this.profileStore = profileStore || new LocalProfileStore(config.profileStorePath);
  }

  async run(request: TurnStartRequest): Promise<SourceAgentRunResult> {
    const events: AgentEvent[] = [];
    const emit = async (type: string, payload: Record<string, unknown>) => {
      const event = { type, timestamp: nowIso(), payload: safeJson(payload) };
      events.push(event);
      await request.onEvent?.(event);
    };

    const runId = typeof request.metadata?.runId === 'string' && request.metadata.runId.trim()
      ? request.metadata.runId.trim()
      : id('run');
    const runtimePaths = resolveRuntimePaths(this.config, request, runId);
    const { hermesHome, codexHome, workspace } = runtimePaths;
    const runtimeStatePaths = { hermesHome, codexHome, workspace };
    const codexLocalEnvironmentDisabled = this.config.disableLocalEnvironmentForGeneral;
    const previousSandboxState = await readSandboxState(runtimePaths);
    const previousHermesSessionId =
      typeof previousSandboxState?.hermesSessionId === 'string' ? previousSandboxState.hermesSessionId.trim() : '';
    const resumeSessionId =
      this.config.runtimeStateMode === 'sandbox' && previousHermesSessionId
        ? previousHermesSessionId
        : '';

    if (this.runtimeStateStore && this.config.runtimeStateMode === 'snapshot') {
      const hydrated = await this.runtimeStateStore.hydrate({
        userId: request.userId,
        threadId: request.threadId || 'default',
        paths: runtimeStatePaths,
      });
      if (hydrated.enabled) {
        await emit('runtime_state.hydrated', {
          restored: hydrated.restored,
          warnings: hydrated.warnings,
        });
      }
    }

    await this.prepareHomes(runtimePaths);
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

    const ingestedArtifacts = await ingestWorkspaceAttachments(this.config, request, runtimePaths, runId);
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
    const cleanContext = await loadCleanTurnContext(this.config, request);
    await emit('agent_context.loaded', {
      loaded: cleanContext.loaded,
      summaryChars: cleanContext.summaryChars,
      messageCount: cleanContext.messageCount,
      artifactCount: cleanContext.artifactCount,
      warnings: cleanContext.warnings,
    });

    const currentUserMessage =
      typeof request.metadata?.currentUserMessage === 'string' && request.metadata.currentUserMessage.trim()
        ? request.metadata.currentUserMessage.trim()
        : request.message;
    const rememberedProfile = await this.profileStore.rememberExplicitUserProfile(
      request.userId,
      currentUserMessage,
      request.threadId
    );
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
    });

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

    let result: { stdout: string; stderr: string };
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
        hermesHome,
        codexHome,
        workspace,
      });
    } catch (error) {
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
      const reviewUserMessage =
        typeof request.metadata?.currentUserMessage === 'string' && request.metadata.currentUserMessage.trim()
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

  private async prepareHomes(paths: RuntimePaths) {
    await prepareRuntimeDirectories(paths);

    await fs.writeFile(
      path.join(paths.hermesHome, 'config.yaml'),
      [
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
      ].join('\n'),
      'utf8'
    );

    const openRouterBaseUrl = this.config.hermesCodexResponsesProxyEnabled
      ? `http://127.0.0.1:${this.config.port}/openrouter-responses-proxy/v1`
      : this.config.openRouterBaseUrl;

    await fs.writeFile(
      path.join(paths.codexHome, 'config.toml'),
      [
        `model = ${tomlString(this.config.codexModel || this.config.hermesModel)}`,
        'model_provider = "openrouter"',
        `web_search = ${tomlString(this.config.codexWebSearchMode)}`,
        'sandbox_mode = "workspace-write"',
        'approval_policy = "never"',
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
      ].join('\n'),
      'utf8'
    );
  }

  private async calculateSandboxDiskBytes(paths: RuntimePaths) {
    try {
      return await calculateDirectoryBytes(paths.threadRoot || paths.workspace);
    } catch {
      return null;
    }
  }

  private async syncSandboxControlPlane(input: {
    request: TurnStartRequest;
    runtimePaths: RuntimePaths;
    runId: string;
    status: AgentSandboxControlPlaneInput['status'];
    activeSessionId?: string | null;
    diskBytes?: number | null;
    error?: string | null;
    metadata?: Record<string, unknown> | null;
    emit: (type: string, payload: Record<string, unknown>) => Promise<void>;
  }) {
    const investorId =
      typeof input.request.metadata?.investorId === 'string' && input.request.metadata.investorId.trim()
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
    } catch (error) {
      await input.emit('agent_context.sandbox_state_failed', {
        status: input.status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private spawnHermes(
    args: string[],
    paths: {
      runId: string;
      userId: string;
      threadId: string;
      hermesHome: string;
      codexHome: string;
      workspace: string;
    }
  ) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const codexBinDir = path.dirname(this.config.codexBin);
      const child = spawn(this.config.uvBin, args, {
        cwd: this.config.hermesSourceRoot,
        env: {
          ...process.env,
          HERMES_HOME: paths.hermesHome,
          CODEX_HOME: paths.codexHome,
          PATH: [codexBinDir, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
          HERMES_BACKGROUND_REVIEW_INLINE:
            this.config.memoryReviewMode === 'inline' && this.config.hermesBackgroundReviewInline ? '1' : '0',
          HERMES_DISABLE_LAZY_INSTALLS: '1',
          ALTSELFS_CODEX_DISABLE_LOCAL_ENVIRONMENT: this.config.disableLocalEnvironmentForGeneral ? '1' : '0',
          ALTSELFS_CODEX_PERSONALITY: 'pragmatic',
          ALTSELFS_CODEX_DEVELOPER_INSTRUCTIONS: buildCodexGeneralDeveloperInstructions({
            webSearchMode: this.config.codexWebSearchMode,
            runtimeStateMode: this.config.runtimeStateMode,
          }),
          NO_PROXY: mergeNoProxy(process.env.NO_PROXY || process.env.no_proxy || ''),
          no_proxy: mergeNoProxy(process.env.NO_PROXY || process.env.no_proxy || ''),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      registerActiveRun({
        runId: paths.runId,
        userId: paths.userId,
        threadId: paths.threadId,
        child,
      });

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Hermes source runtime timed out after 10 minutes'));
      }, 600_000);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        unregisterActiveRun(paths.runId);
        clearTimeout(timeout);
        reject(isRunCancelled(paths.runId) ? createRunCancelledError(paths.runId) : error);
      });
      child.on('close', (code) => {
        unregisterActiveRun(paths.runId);
        clearTimeout(timeout);
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

  private async removeRunDirectories(paths: string[], emit: (type: string, payload: Record<string, unknown>) => Promise<void>) {
    const removed: string[] = [];
    const warnings: string[] = [];
    for (const dir of paths) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
        removed.push(dir);
      } catch (error) {
        warnings.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await emit('runtime_state.ephemeral_cleaned', { removed, warnings });
  }
}

function extractSessionId(stdout: string) {
  const match = stdout.match(/^session_id:\s*(\S+)/m);
  return match?.[1] || '';
}

function extractReply(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('session_id:'))
    .filter((line) => !line.includes('tirith security scanner enabled but not available'))
    .filter((line) => !line.startsWith('↻ Resumed session '))
    .join('\n')
    .trim();
}

function tail(value: string, maxLines: number) {
  const lines = value.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

function mergeNoProxy(value: string) {
  const entries = new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  entries.add('127.0.0.1');
  entries.add('localhost');
  entries.add('::1');
  return Array.from(entries).join(',');
}

function buildRuntimeMessage(input: { message: string; renderedProfile: string }) {
  if (!input.renderedProfile.trim()) return input.message;
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

function buildCodexGeneralDeveloperInstructions(input: { webSearchMode: string; runtimeStateMode: string }) {
  const currentTime = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(new Date());

  const artifactAccessPolicy = input.runtimeStateMode === 'sandbox'
    ? [
        '- This run is inside an Altselfs sandbox workspace. User-provided artifacts listed in host context are available through the `altselfs_read_artifact` tool.',
        '- If the user asks about an uploaded file or indexed material, call `altselfs_read_artifact` with `parsed_text_path` first, then `workspace_path` if needed.',
        '- Do not inspect arbitrary local repositories, source trees, system directories, or unrelated filesystem paths.',
        '- Do not run shell commands, tests, builds, package managers, scripts, network scanners, or local code.',
      ]
    : [
        '- Do not inspect, read, write, patch, or modify local repositories or arbitrary local filesystem paths.',
        '- User-provided artifacts listed in host context are available through the `altselfs_read_artifact` tool. If the user asks about an uploaded file, call `altselfs_read_artifact` with `parsed_text_path` first, then `workspace_path` if needed.',
        '- Do not say you cannot access an uploaded file when an artifact path is listed. Try `altselfs_read_artifact` first; if the tool fails, report the concrete failure.',
        '- Do not run shell commands, tests, builds, package managers, scripts, or local code.',
      ];

  return [
    `Current time: ${currentTime} (Asia/Shanghai).`,
    `Codex web_search mode requested by host: ${input.webSearchMode}.`,
    'Answer in the user language unless the user asks otherwise.',
    '',
    'Altselfs codex-general policy:',
    '- You are a general personal agent for discussion, research, planning, and synthesis.',
    ...artifactAccessPolicy,
    '- Use conversation and reasoning for tasks that do not need external data.',
    '- When a task needs external, current, private-channel, or product data, first choose the most relevant registered non-local tool, channel agent, or platform/MCP capability available in this turn.',
    '- Treat altselfs_web_search as the public-web information source, not as the only possible source. Use it when the user needs current public web facts, news, industry updates, market information, or web research and no more specific channel/tool is better.',
    '- In Altselfs context, OPC usually means One Person Company / 一人公司 unless the user explicitly says OPC UA or industrial automation.',
    '- Do not claim that you searched, read a channel, checked a platform, or called an agent unless the corresponding tool/capability was actually called.',
    '- If the needed capability is unavailable, explain the limitation instead of trying local file or command tools.',
    '- After using tools, finish with a direct user-facing synthesis. Do not end the turn by saying you will search/read/call another tool; either call the tool or answer from the evidence already available.',
    '- Never output protocol/content-item arrays such as `[{"type":"text","text":"..."}]` or Python-style variants. Output plain prose or Markdown only.',
  ].join('\n');
}

async function readHermesUserProfile(hermesHome: string) {
  try {
    const raw = await fs.readFile(path.join(hermesHome, 'memories', 'USER.md'), 'utf8');
    return raw
      .split(/\n§\n/g)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => `- ${entry}`)
      .join('\n');
  } catch {
    return '';
  }
}

function combineProfileBlocks(...blocks: string[]) {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const block of blocks) {
    for (const rawLine of block.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const normalized = line.replace(/^-\s*/, '').replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      entries.push(line.startsWith('- ') ? line : `- ${line}`);
    }
  }
  return entries.join('\n');
}

type CodexRolloutOutcome = {
  reply: string;
  taskComplete: boolean;
  turnAborted: boolean;
  abortReason: string;
  file: string;
};

async function extractLatestCodexOutcome(codexHome: string, startedAtMs: number): Promise<CodexRolloutOutcome> {
  const sessionsDir = path.join(codexHome, 'sessions');
  const files = await listFiles(sessionsDir);
  const candidates = (
    await Promise.all(
      files
        .filter((file) => file.endsWith('.jsonl'))
        .map(async (file) => {
          try {
            const stat = await fs.stat(file);
            return stat.mtimeMs >= startedAtMs - 10_000 ? { file, mtimeMs: stat.mtimeMs } : null;
          } catch {
            return null;
          }
        })
    )
  )
    .filter((file): file is { file: string; mtimeMs: number } => Boolean(file))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const candidate of candidates.slice(0, 5)) {
    const outcome = await extractCodexOutcomeFromRollout(candidate.file);
    if (outcome.taskComplete || outcome.turnAborted || outcome.reply) return outcome;
  }
  return {
    reply: '',
    taskComplete: false,
    turnAborted: false,
    abortReason: '',
    file: '',
  };
}

async function extractCodexOutcomeFromRollout(file: string): Promise<CodexRolloutOutcome> {
  const outcome: CodexRolloutOutcome = {
    reply: '',
    taskComplete: false,
    turnAborted: false,
    abortReason: '',
    file,
  };

  try {
    const raw = await fs.readFile(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed) || !isRecord(parsed.payload)) continue;
      if (parsed.type === 'event_msg' && parsed.payload.type === 'task_complete') {
        const message = parsed.payload.last_agent_message;
        if (typeof message === 'string' && message.trim()) outcome.reply = normalizeAssistantReply(message);
        outcome.taskComplete = true;
      }
      if (parsed.type === 'event_msg' && parsed.payload.type === 'agent_message') {
        const message = parsed.payload.message;
        if (typeof message === 'string' && message.trim()) outcome.reply = normalizeAssistantReply(message);
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
  } catch {
    return outcome;
  }
}

function startCodexRolloutEventBridge(input: {
  codexHome: string;
  startedAtMs: number;
  emit: (type: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const sessionsDir = path.join(input.codexHome, 'sessions');
  const offsets = new Map<string, number>();
  const pendingText = new Map<string, string>();
  let stopped = false;
  let scanning = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const scan = async () => {
    if (stopped || scanning) return;
    scanning = true;
    try {
      const files = await listFiles(sessionsDir);
      const candidates = (
        await Promise.all(
          files
            .filter((file) => file.endsWith('.jsonl'))
            .map(async (file) => {
              try {
                const stat = await fs.stat(file);
                return stat.mtimeMs >= input.startedAtMs - 10_000 ? { file, size: stat.size } : null;
              } catch {
                return null;
              }
            })
        )
      ).filter((file): file is { file: string; size: number } => Boolean(file));

      for (const candidate of candidates) {
        const offset = offsets.get(candidate.file) ?? 0;
        if (candidate.size <= offset) continue;
        const chunk = await readFileRange(candidate.file, offset, candidate.size);
        offsets.set(candidate.file, candidate.size);
        const buffered = `${pendingText.get(candidate.file) || ''}${chunk}`;
        const lines = buffered.split(/\r?\n/);
        pendingText.set(candidate.file, lines.pop() || '');
        const rolloutFile = path.relative(input.codexHome, candidate.file);
        for (const line of lines) {
          const parsed = parseJsonLine(line);
          if (!parsed) continue;
          const events = projectCodexRolloutEvents(parsed, rolloutFile);
          for (const event of events) {
            await input.emit(event.type, event.payload);
          }
        }
      }
    } catch (error) {
      await input.emit('codex.rollout.bridge_error', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      scanning = false;
    }
  };

  const flushPending = async () => {
    for (const [file, line] of pendingText.entries()) {
      const parsed = parseJsonLine(line);
      if (!parsed) continue;
      const rolloutFile = path.relative(input.codexHome, file);
      const events = projectCodexRolloutEvents(parsed, rolloutFile);
      for (const event of events) {
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
      if (timer) clearInterval(timer);
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

async function readFileRange(file: string, start: number, end: number) {
  const length = Math.max(0, end - start);
  if (length === 0) return '';
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function projectCodexRolloutEvents(parsed: Record<string, unknown>, rolloutFile: string) {
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
    if (!message.trim()) return [];
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

function parseJsonValue(value: string) {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseJsonLine(line: string) {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAssistantReply(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const text = extractContentItemText(parsed);
    if (text) return text.trim();
  } catch {
    // DeepSeek sometimes emits Python-style content item strings with single quotes.
  }

  const pythonStyleText = extractPythonStyleContentItemText(trimmed);
  return pythonStyleText || trimmed;
}

function extractContentItemText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!isRecord(item)) return '';
      if (typeof item.text === 'string') return item.text;
      if (typeof item.content === 'string') return item.content;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractPythonStyleContentItemText(value: string) {
  const match = value.match(/^\s*\[\s*\{\s*['"]type['"]\s*:\s*['"]text['"]\s*,\s*['"]text['"]\s*:\s*(['"])([\s\S]*)\1\s*\}\s*\]\s*$/);
  if (!match?.[2]) return '';
  return match[2]
    .replace(/\\n/g, '\n')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .trim();
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return listFiles(entryPath);
        if (entry.isFile()) return Promise.resolve([entryPath]);
        return Promise.resolve([]);
      })
    );
    return nested.flat();
  } catch {
    return [];
  }
}
