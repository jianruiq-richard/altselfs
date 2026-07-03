import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { calculateDirectoryBytes, sanitizePathSegment } from '../sandbox-runtime.js';
import { isRecord, nowIso, truncate } from '../util.js';
export function createSandboxExecDynamicTool() {
    return {
        namespace: null,
        name: 'altselfs_sandbox_exec',
        description: 'Run a short Python or shell command in the current Altselfs sandbox workspace when deterministic computation, parsing, scraping, or file transformation is needed. The command runs in an isolated Docker container with limited CPU, memory, process count, timeout, and workspace-only filesystem access. Prefer registered platform tools for third-party data. Do not use this for repository edits or package builds.',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'Shell command or Python one-liner/script to run inside /workspace.',
                },
                cwd: {
                    type: 'string',
                    description: 'Optional working directory relative to /workspace, default ".".',
                },
                stdin: {
                    type: 'string',
                    description: 'Optional stdin passed to the command.',
                },
                timeoutMs: {
                    type: 'number',
                    description: 'Optional timeout in milliseconds. Capped by server policy.',
                },
                useProxy: {
                    type: 'boolean',
                    description: 'Set true only when network access is needed and the server has configured a proxy/VPN for sandbox execution.',
                },
            },
            required: ['command'],
            additionalProperties: false,
        },
        deferLoading: false,
    };
}
export function isSandboxExecTool(toolName) {
    return toolName === 'altselfs_sandbox_exec';
}
export async function runSandboxExecTool(argumentsValue, config, context = {}) {
    const fetchedAt = nowIso();
    const parsedArgs = parseSandboxExecArgs(argumentsValue, config);
    if ('error' in parsedArgs) {
        return JSON.stringify({ source: 'altselfs_sandbox_exec', fetchedAt, error: parsedArgs.error }, null, 2);
    }
    if (!config.sandboxExecEnabled) {
        return JSON.stringify({
            source: 'altselfs_sandbox_exec',
            fetchedAt,
            error: 'Sandbox execution is disabled. Set SANDBOX_EXEC_ENABLED=true and mount a Docker socket to enable it.',
            command: truncate(parsedArgs.command, 500),
        }, null, 2);
    }
    const workspaceResult = resolveWorkspace(config, context);
    if ('error' in workspaceResult) {
        return JSON.stringify({
            source: 'altselfs_sandbox_exec',
            fetchedAt,
            error: workspaceResult.error,
            context: publicContext(context),
        }, null, 2);
    }
    const socketOk = await dockerSocketAvailable(config.sandboxExecDockerSocketPath);
    if (!socketOk) {
        return JSON.stringify({
            source: 'altselfs_sandbox_exec',
            fetchedAt,
            error: `Docker socket is not available at ${config.sandboxExecDockerSocketPath}. Mount the host Docker socket into the personal-agent-server container before enabling sandbox_exec.`,
            workspace: workspaceResult.workspace,
            command: truncate(parsedArgs.command, 500),
        }, null, 2);
    }
    try {
        return JSON.stringify(await runInDockerSandbox({
            args: parsedArgs,
            config,
            context,
            workspace: workspaceResult.workspace,
            fetchedAt,
        }), null, 2);
    }
    catch (error) {
        return JSON.stringify({
            source: 'altselfs_sandbox_exec',
            fetchedAt,
            error: error instanceof Error ? error.message : String(error),
            workspace: workspaceResult.workspace,
            command: truncate(parsedArgs.command, 1000),
            limitations: [
                'The command was attempted through the Docker sandbox bridge, not on the personal-agent-server host process.',
            ],
        }, null, 2);
    }
}
async function runInDockerSandbox(input) {
    const { args, config, context, workspace } = input;
    await ensureSandboxWorkspaceLayout(workspace);
    const cwdHost = path.join(workspace, args.cwd === '.' ? '' : args.cwd);
    const cwdStat = await fs.stat(cwdHost).catch(() => null);
    if (!cwdStat?.isDirectory()) {
        return {
            source: 'altselfs_sandbox_exec',
            fetchedAt: input.fetchedAt,
            ok: false,
            error: 'cwd does not exist or is not a directory',
            cwd: args.cwd,
            workspace,
        };
    }
    const workspaceBytesBefore = await calculateDirectoryBytes(workspace);
    if (workspaceBytesBefore > config.sandboxExecWorkspaceMaxBytes) {
        return {
            source: 'altselfs_sandbox_exec',
            fetchedAt: input.fetchedAt,
            ok: false,
            error: 'workspace size exceeds configured limit before execution',
            workspaceBytesBefore,
            workspaceMaxBytes: config.sandboxExecWorkspaceMaxBytes,
        };
    }
    const runSegment = sanitizePathSegment(context.runId || 'adhoc');
    const execSegment = `exec-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const execRelative = path.posix.join('.runs', runSegment, execSegment);
    const execDir = path.join(workspace, execRelative);
    await fs.mkdir(execDir, { recursive: true });
    await fs.chmod(execDir, 0o777).catch(() => undefined);
    const commandPath = path.join(execDir, 'user-command.sh');
    const runnerPath = path.join(execDir, 'runner.sh');
    const stdinPath = path.join(execDir, 'stdin.txt');
    const stdoutPath = path.join(execDir, 'stdout.txt');
    const stderrPath = path.join(execDir, 'stderr.txt');
    const exitCodePath = path.join(execDir, 'exit-code.txt');
    await fs.writeFile(commandPath, `${args.command.replace(/\r\n/g, '\n')}\n`, 'utf8');
    await fs.chmod(commandPath, 0o755).catch(() => undefined);
    if (args.stdin)
        await fs.writeFile(stdinPath, args.stdin, 'utf8');
    await fs.writeFile(stdoutPath, '', 'utf8');
    await fs.writeFile(stderrPath, '', 'utf8');
    await fs.writeFile(exitCodePath, '', 'utf8');
    await Promise.all([stdoutPath, stderrPath, exitCodePath].map((file) => fs.chmod(file, 0o666).catch(() => undefined)));
    const runner = buildRunnerScript({
        cwd: args.cwd,
        execRelative,
        hasStdin: Boolean(args.stdin),
    });
    await fs.writeFile(runnerPath, runner, 'utf8');
    await fs.chmod(runnerPath, 0o755).catch(() => undefined);
    const containerName = `altselfs-sandbox-${runSegment.slice(0, 32)}-${execSegment}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
    let containerId = '';
    let timedOut = false;
    const startedAt = Date.now();
    await appendCommandAudit(workspace, {
        timestamp: input.fetchedAt,
        runId: context.runId || null,
        userId: context.userId || null,
        threadId: context.threadId || null,
        execDir: execRelative,
        command: truncate(args.command, 4000),
        cwd: args.cwd,
        stdinBytes: Buffer.byteLength(args.stdin || '', 'utf8'),
        timeoutMs: args.timeoutMs,
        networkMode: config.sandboxExecNetworkEnabled ? 'bridge' : 'none',
        useProxy: args.useProxy,
    }).catch(() => undefined);
    try {
        const create = await dockerRequest(config, 'POST', `/containers/create?name=${encodeURIComponent(containerName)}`, dockerContainerCreateBody({
            args,
            config,
            workspace,
            runnerContainerPath: path.posix.join('/workspace', execRelative, 'runner.sh'),
        }), 15_000);
        const body = isRecord(create.body) ? create.body : {};
        containerId = typeof body.Id === 'string' ? body.Id : '';
        if (!containerId)
            throw new Error(`Docker did not return a container id: ${create.bodyText.slice(0, 500)}`);
        await dockerRequest(config, 'POST', `/containers/${containerId}/start`, undefined, 15_000);
        const waitPromise = dockerRequest(config, 'POST', `/containers/${containerId}/wait`, undefined, args.timeoutMs + 20_000);
        const waitResult = await Promise.race([
            waitPromise,
            delay(args.timeoutMs).then(() => null),
        ]);
        if (waitResult === null) {
            timedOut = true;
            await dockerRequest(config, 'POST', `/containers/${containerId}/kill`, undefined, 10_000).catch(() => null);
            await waitPromise.catch(() => null);
        }
    }
    finally {
        if (containerId) {
            await dockerRequest(config, 'DELETE', `/containers/${containerId}?force=true&v=false`, undefined, 10_000).catch(() => null);
        }
    }
    const durationMs = Date.now() - startedAt;
    const exitCode = await readExitCode(exitCodePath, timedOut);
    const stdout = await readOutputFile(stdoutPath, config.sandboxExecMaxOutputBytes);
    const stderr = await readOutputFile(stderrPath, config.sandboxExecMaxOutputBytes);
    const workspaceBytesAfter = await calculateDirectoryBytes(workspace);
    return {
        source: 'altselfs_sandbox_exec',
        fetchedAt: input.fetchedAt,
        ok: !timedOut && exitCode === 0 && workspaceBytesAfter <= config.sandboxExecWorkspaceMaxBytes,
        backend: 'docker',
        image: config.sandboxExecImage,
        command: truncate(args.command, 1000),
        cwd: args.cwd,
        exitCode,
        timedOut,
        durationMs,
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: stdout.truncated || stderr.truncated,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        execDir: execRelative,
        workspaceBytesBefore,
        workspaceBytesAfter,
        workspaceMaxBytes: config.sandboxExecWorkspaceMaxBytes,
        networkMode: config.sandboxExecNetworkEnabled ? 'bridge' : 'none',
        proxyEnabled: args.useProxy && Boolean(config.sandboxExecProxyUrl),
        limitations: [
            'The command ran in a short-lived Docker sandbox with the current workspace bind-mounted at /workspace.',
            'Only stdout/stderr and files written under /workspace are retained.',
        ],
    };
}
function dockerContainerCreateBody(input) {
    const env = [
        'HOME=/tmp',
        'PYTHONUNBUFFERED=1',
        'PIP_DISABLE_PIP_VERSION_CHECK=1',
    ];
    if (input.args.useProxy && input.config.sandboxExecProxyUrl) {
        const proxyUrl = input.config.sandboxExecProxyUrl;
        env.push(`HTTP_PROXY=${proxyUrl}`, `HTTPS_PROXY=${proxyUrl}`, `ALL_PROXY=${proxyUrl}`, `http_proxy=${proxyUrl}`, `https_proxy=${proxyUrl}`, `all_proxy=${proxyUrl}`, 'NO_PROXY=127.0.0.1,localhost,::1', 'no_proxy=127.0.0.1,localhost,::1');
    }
    return {
        Image: input.config.sandboxExecImage,
        Cmd: ['/bin/sh', input.runnerContainerPath],
        WorkingDir: '/workspace',
        User: '65534:65534',
        Env: env,
        HostConfig: {
            Binds: [`${input.workspace}:/workspace:rw`],
            ReadonlyRootfs: true,
            NetworkMode: input.config.sandboxExecNetworkEnabled ? 'bridge' : 'none',
            Memory: input.config.sandboxExecMemoryBytes,
            NanoCpus: input.config.sandboxExecNanoCpus,
            PidsLimit: input.config.sandboxExecPidsLimit,
            CapDrop: ['ALL'],
            SecurityOpt: ['no-new-privileges:true'],
            AutoRemove: false,
            Tmpfs: {
                '/tmp': `rw,nosuid,nodev,size=${input.config.sandboxExecTmpfsSizeBytes}`,
            },
        },
    };
}
function buildRunnerScript(input) {
    const execPath = path.posix.join('/workspace', input.execRelative);
    const commandPath = path.posix.join(execPath, 'user-command.sh');
    const stdinPath = path.posix.join(execPath, 'stdin.txt');
    const stdoutPath = path.posix.join(execPath, 'stdout.txt');
    const stderrPath = path.posix.join(execPath, 'stderr.txt');
    const exitCodePath = path.posix.join(execPath, 'exit-code.txt');
    const cdTarget = path.posix.join('/workspace', input.cwd === '.' ? '' : input.cwd);
    return [
        '#!/bin/sh',
        'set +e',
        `cd ${shellQuote(cdTarget)} 2> ${shellQuote(stderrPath)}`,
        'cd_status=$?',
        'if [ "$cd_status" -ne 0 ]; then',
        `  printf "%s" "$cd_status" > ${shellQuote(exitCodePath)}`,
        '  exit 0',
        'fi',
        input.hasStdin
            ? `/bin/sh ${shellQuote(commandPath)} < ${shellQuote(stdinPath)} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`
            : `/bin/sh ${shellQuote(commandPath)} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`,
        'exit_code=$?',
        `printf "%s" "$exit_code" > ${shellQuote(exitCodePath)}`,
        'exit 0',
        '',
    ].join('\n');
}
function parseSandboxExecArgs(argumentsValue, config) {
    const args = isRecord(argumentsValue) ? argumentsValue : {};
    const command = typeof args.command === 'string' ? args.command.trim() : '';
    if (!command)
        return { error: 'command is required' };
    if (Buffer.byteLength(command, 'utf8') > 64 * 1024)
        return { error: 'command is too large' };
    const cwd = normalizeRelativeWorkspacePath(typeof args.cwd === 'string' ? args.cwd : '.');
    if (!cwd)
        return { error: 'cwd must be a relative path inside /workspace' };
    const stdin = typeof args.stdin === 'string' ? args.stdin : '';
    if (Buffer.byteLength(stdin, 'utf8') > 1024 * 1024)
        return { error: 'stdin is too large' };
    const rawTimeout = typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)
        ? Math.floor(args.timeoutMs)
        : config.sandboxExecTimeoutMs;
    const timeoutMs = Math.max(1000, Math.min(rawTimeout, config.sandboxExecTimeoutMs));
    return {
        command,
        cwd,
        stdin,
        timeoutMs,
        useProxy: args.useProxy === true,
    };
}
function normalizeRelativeWorkspacePath(value) {
    const normalized = path.posix.normalize(value.replace(/\\/g, '/').replace(/\0/g, '') || '.');
    if (normalized === '.')
        return '.';
    if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../'))
        return '';
    return normalized;
}
function resolveWorkspace(config, context) {
    const explicit = typeof context.workspace === 'string' && context.workspace.trim()
        ? path.resolve(context.workspace.trim())
        : '';
    const fallback = context.userId
        ? path.join(config.sandboxStorageRoot, 'users', sanitizePathSegment(context.userId), 'threads', sanitizePathSegment(context.threadId || 'default'), 'workspace')
        : '';
    const workspace = explicit || fallback;
    if (!workspace)
        return { error: 'sandbox workspace context is missing' };
    if (!isAllowedWorkspace(config, workspace)) {
        return {
            error: `workspace is outside allowed roots: ${workspace}`,
        };
    }
    return { workspace };
}
function isAllowedWorkspace(config, workspace) {
    const resolved = path.resolve(workspace);
    const roots = [
        path.resolve(config.sandboxStorageRoot),
        path.resolve(config.workspaceRoot),
        path.resolve(config.hermesWorkspaceRoot),
    ];
    return roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}
async function ensureSandboxWorkspaceLayout(workspace) {
    await fs.mkdir(workspace, { recursive: true });
    await fs.chmod(workspace, 0o777).catch(() => undefined);
    const dirs = ['uploads', 'artifacts', path.join('artifacts', 'parsed'), 'outputs', 'scripts', 'cache', '.runs'];
    for (const dir of dirs) {
        const fullPath = path.join(workspace, dir);
        await fs.mkdir(fullPath, { recursive: true });
        await fs.chmod(fullPath, 0o777).catch(() => undefined);
    }
}
function dockerSocketAvailable(socketPath) {
    return fs.stat(socketPath).then((stat) => stat.isSocket()).catch(() => false);
}
function dockerRequest(config, method, requestPath, body, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
        const bodyBuffer = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
        const request = http.request({
            socketPath: config.sandboxExecDockerSocketPath,
            method,
            path: requestPath,
            headers: bodyBuffer
                ? {
                    'content-type': 'application/json',
                    'content-length': String(bodyBuffer.length),
                }
                : undefined,
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            response.on('end', () => {
                const bodyText = Buffer.concat(chunks).toString('utf8');
                const parsed = parseJsonBody(bodyText);
                const result = {
                    statusCode: response.statusCode || 0,
                    headers: response.headers,
                    bodyText,
                    body: parsed,
                };
                if ((response.statusCode || 0) >= 400) {
                    reject(new Error(`Docker API ${method} ${requestPath} failed with HTTP ${response.statusCode}: ${bodyText.slice(0, 1000)}`));
                    return;
                }
                resolve(result);
            });
        });
        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Docker API ${method} ${requestPath} timed out after ${timeoutMs}ms`));
        });
        request.on('error', reject);
        if (bodyBuffer)
            request.write(bodyBuffer);
        request.end();
    });
}
function parseJsonBody(text) {
    if (!text.trim())
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
async function readOutputFile(filePath, maxBytes) {
    const raw = await fs.readFile(filePath).catch(() => Buffer.alloc(0));
    const truncated = raw.length > maxBytes;
    return {
        text: raw.slice(0, maxBytes).toString('utf8'),
        truncated,
        sizeBytes: raw.length,
    };
}
async function readExitCode(filePath, timedOut) {
    if (timedOut)
        return null;
    const raw = await fs.readFile(filePath, 'utf8').catch(() => '');
    const value = Number(raw.trim());
    return Number.isFinite(value) ? value : null;
}
async function appendCommandAudit(workspace, payload) {
    const logPath = path.join(workspace, '.runs', 'commands.jsonl');
    await fs.appendFile(logPath, `${JSON.stringify(payload)}\n`, 'utf8');
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
function publicContext(context) {
    return {
        userId: context.userId || null,
        threadId: context.threadId || null,
        runId: context.runId || null,
        workspace: context.workspace || null,
    };
}
