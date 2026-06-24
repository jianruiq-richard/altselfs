import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCleanTurnContext } from '../agent-context-store.js';
import { LocalProfileStore } from '../profile-store.js';
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
        const events = [];
        const emit = async (type, payload) => {
            const event = { type, timestamp: nowIso(), payload: safeJson(payload) };
            events.push(event);
            await request.onEvent?.(event);
        };
        const userSegment = sanitizePathSegment(request.userId);
        const threadSegment = sanitizePathSegment(request.threadId || 'default');
        const runId = id('run');
        const runSegment = sanitizePathSegment(runId);
        const hermesHome = path.join(this.config.hermesHomeRoot, userSegment, threadSegment, runSegment, 'hermes-home');
        const codexHome = path.join(this.config.codexHomeRoot, userSegment, threadSegment, runSegment, 'codex-home');
        const workspace = path.join(this.config.hermesWorkspaceRoot, userSegment, threadSegment, runSegment, 'workspace');
        const runtimeStatePaths = { hermesHome, codexHome, workspace };
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
        await this.prepareHomes({ hermesHome, codexHome, workspace });
        const cleanContext = await loadCleanTurnContext(this.config, request);
        await emit('agent_context.loaded', {
            loaded: cleanContext.loaded,
            summaryChars: cleanContext.summaryChars,
            messageCount: cleanContext.messageCount,
            artifactCount: cleanContext.artifactCount,
            warnings: cleanContext.warnings,
        });
        const currentUserMessage = typeof request.metadata?.currentUserMessage === 'string' && request.metadata.currentUserMessage.trim()
            ? request.metadata.currentUserMessage.trim()
            : request.message;
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
        });
        await emit('hermes.source_runtime.starting', {
            runId,
            hermesHome,
            codexHome,
            workspace,
            sessionMode: this.config.runtimeStateMode,
            resumeSessionId: null,
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
            '-Q',
            '--source',
            'tool',
            '--max-turns',
            String(this.config.hermesMaxTurns),
            '-q',
            runtimeMessage,
        ];
        const result = await this.spawnHermes(args, { hermesHome, codexHome, workspace });
        const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
        const sessionId = extractSessionId(combinedOutput);
        const codexReply = await extractLatestCodexReply(codexHome, startedAtMs);
        const reply = codexReply || extractReply(combinedOutput).trim();
        await emit('hermes.source_runtime.completed', {
            sessionId: sessionId || null,
            codexReply: codexReply || null,
            stdout: truncate(result.stdout, 20000),
            stderrTail: truncate(tail(result.stderr, 120), 20000),
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
    async prepareHomes(paths) {
        await fs.mkdir(paths.hermesHome, { recursive: true });
        await fs.mkdir(paths.codexHome, { recursive: true });
        await fs.mkdir(paths.workspace, { recursive: true });
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
        const openRouterBaseUrl = this.config.hermesCodexResponsesProxyEnabled
            ? `http://127.0.0.1:${this.config.port}/openrouter-responses-proxy/v1`
            : this.config.openRouterBaseUrl;
        await fs.writeFile(path.join(paths.codexHome, 'config.toml'), [
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
        ].join('\n'), 'utf8');
    }
    spawnHermes(args, paths) {
        return new Promise((resolve, reject) => {
            const codexBinDir = path.dirname(this.config.codexBin);
            const child = spawn(this.config.uvBin, args, {
                cwd: this.config.hermesSourceRoot,
                env: {
                    ...process.env,
                    HERMES_HOME: paths.hermesHome,
                    CODEX_HOME: paths.codexHome,
                    PATH: [codexBinDir, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
                    HERMES_BACKGROUND_REVIEW_INLINE: this.config.memoryReviewMode === 'inline' && this.config.hermesBackgroundReviewInline ? '1' : '0',
                    HERMES_DISABLE_LAZY_INSTALLS: '1',
                    ALTSELFS_CODEX_DISABLE_LOCAL_ENVIRONMENT: '1',
                    ALTSELFS_CODEX_PERSONALITY: 'pragmatic',
                    ALTSELFS_CODEX_DEVELOPER_INSTRUCTIONS: buildCodexGeneralDeveloperInstructions({
                        webSearchMode: this.config.codexWebSearchMode,
                    }),
                    NO_PROXY: mergeNoProxy(process.env.NO_PROXY || process.env.no_proxy || ''),
                    no_proxy: mergeNoProxy(process.env.NO_PROXY || process.env.no_proxy || ''),
                },
                stdio: ['ignore', 'pipe', 'pipe'],
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
                clearTimeout(timeout);
                reject(error);
            });
            child.on('close', (code) => {
                clearTimeout(timeout);
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
function sanitizePathSegment(value) {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'anonymous';
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
function buildCodexGeneralDeveloperInstructions(input) {
    const currentTime = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        dateStyle: 'full',
        timeStyle: 'long',
    }).format(new Date());
    return [
        `Current time: ${currentTime} (Asia/Shanghai).`,
        `Codex web_search mode requested by host: ${input.webSearchMode}.`,
        'Answer in the user language unless the user asks otherwise.',
        '',
        'Altselfs codex-general policy:',
        '- You are a general personal agent for discussion, research, planning, and synthesis.',
        '- Do not inspect, read, write, patch, or modify local files or repositories.',
        '- Do not run shell commands, tests, builds, package managers, scripts, or local code.',
        '- Use conversation and reasoning for tasks that do not need external data.',
        '- When a task needs external, current, private-channel, or product data, first choose the most relevant registered non-local tool, channel agent, or platform/MCP capability available in this turn.',
        '- Treat altselfs_web_search as the public-web information source, not as the only possible source. Use it when the user needs current public web facts, news, industry updates, market information, or web research and no more specific channel/tool is better.',
        '- In Altselfs context, OPC usually means One Person Company / 一人公司 unless the user explicitly says OPC UA or industrial automation.',
        '- Do not claim that you searched, read a channel, checked a platform, or called an agent unless the corresponding tool/capability was actually called.',
        '- If the needed capability is unavailable, explain the limitation instead of trying local file or command tools.',
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
async function extractLatestCodexReply(codexHome, startedAtMs) {
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
        const reply = await extractCodexReplyFromRollout(candidate.file);
        if (reply)
            return reply;
    }
    return '';
}
async function extractCodexReplyFromRollout(file) {
    try {
        const raw = await fs.readFile(file, 'utf8');
        let fallback = '';
        for (const line of raw.split(/\r?\n/)) {
            if (!line.trim())
                continue;
            const parsed = JSON.parse(line);
            if (!isRecord(parsed) || !isRecord(parsed.payload))
                continue;
            if (parsed.type === 'event_msg' && parsed.payload.type === 'task_complete') {
                const message = parsed.payload.last_agent_message;
                if (typeof message === 'string' && message.trim())
                    return message.trim();
            }
            if (parsed.type === 'event_msg' && parsed.payload.type === 'agent_message') {
                const message = parsed.payload.message;
                if (typeof message === 'string' && message.trim())
                    fallback = message.trim();
            }
        }
        return fallback;
    }
    catch {
        return '';
    }
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
