import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isRecord, id, truncate } from './util.js';
const URL_RE = /^https?:\/\//i;
const SNAPSHOT_FORMAT = 'lark-cli-profile-snapshot-v1';
const SNAPSHOT_MAX_FILES = 300;
const SNAPSHOT_MAX_FILE_BYTES = 1024 * 1024;
const SNAPSHOT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const SNAPSHOT_EXCLUDED_NAMES = new Set(['.DS_Store', '.npm', 'node_modules']);
export async function startFeishuCliAuthorization(config, input) {
    const profileName = makeFeishuCliProfileName(input.investorId);
    return withTemporaryFeishuCliHome(config, profileName, async (cliHome) => {
        await ensureFeishuCliProfile(config, profileName, cliHome);
        const args = ['auth', 'login', '--no-wait', '--json', '--recommend'];
        if (config.feishuCliAuthDomains.length > 0)
            args.push('--domain', config.feishuCliAuthDomains.join(','));
        if (config.feishuCliAuthExtraScopes.length > 0)
            args.push('--scope', config.feishuCliAuthExtraScopes.join(' '));
        const data = await runLarkCliJson(config, args, { profileName, cliHome });
        const authUrl = findFirstString(data, ['verification_uri_complete', 'verification_url', 'auth_url', 'url'], URL_RE);
        const deviceCode = findFirstString(data, ['device_code', 'deviceCode']);
        const userCode = findFirstString(data, ['user_code', 'userCode']);
        const expiresIn = findFirstNumber(data, ['expires_in', 'expiresIn']);
        if (!authUrl || !deviceCode) {
            throw new Error(`lark-cli did not return authorization URL/device code: ${JSON.stringify(data).slice(0, 1000)}`);
        }
        return {
            profileName,
            authUrl,
            deviceCode,
            userCode: userCode || null,
            expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
            requestedDomains: config.feishuCliAuthDomains,
            requestedScopes: config.feishuCliAuthExtraScopes,
        };
    });
}
export async function completeFeishuCliAuthorization(config, input) {
    const profileName = normalizeProfileName(input.profileName);
    if (!profileName)
        throw new Error('profileName is required.');
    const deviceCode = input.deviceCode.trim();
    if (!deviceCode)
        throw new Error('deviceCode is required.');
    return withTemporaryFeishuCliHome(config, profileName, async (cliHome) => {
        await ensureFeishuCliProfile(config, profileName, cliHome);
        await runLarkCliJson(config, ['auth', 'login', '--device-code', deviceCode, '--json'], { profileName, cliHome });
        const [whoami, authStatus] = await Promise.all([
            runLarkCliJson(config, ['whoami', '--json'], { profileName, cliHome, allowFailure: true }),
            runLarkCliJson(config, ['auth', 'status', '--json', '--verify'], { profileName, cliHome, allowFailure: true }),
        ]);
        const profileSnapshot = await captureFeishuCliProfileSnapshot(config, profileName, { cliHome });
        const accountId = findFirstString(whoami, ['open_id', 'openId', 'union_id', 'unionId', 'user_id', 'userId', 'id']) ||
            findFirstString(authStatus, ['open_id', 'openId', 'union_id', 'unionId', 'user_id', 'userId', 'id']) ||
            profileName;
        const displayName = findFirstString(whoami, ['name', 'display_name', 'displayName', 'localized_name', 'localizedName', 'email']) ||
            findFirstString(authStatus, ['name', 'display_name', 'displayName', 'email']) ||
            '飞书用户';
        return {
            profileName,
            accountId,
            displayName,
            scopes: findStringArray(authStatus, ['scopes', 'scope']) || findStringArray(whoami, ['scopes', 'scope']) || [],
            profileSnapshot,
            whoami,
            authStatus,
        };
    });
}
export async function runFeishuCliForProfile(config, profileName, args, options = {}) {
    const normalized = normalizeProfileName(profileName);
    if (!normalized)
        throw new Error('Feishu CLI profile is missing. Reconnect the Feishu account.');
    return withTemporaryFeishuCliHome(config, normalized, async (cliHome) => {
        await ensureFeishuCliProfile(config, normalized, cliHome);
        return runLarkCliJson(config, args, {
            profileName: normalized,
            cliHome,
            timeoutMs: options.timeoutMs,
        });
    });
}
export async function runFeishuCliWithSnapshot(config, profileName, snapshot, args, options = {}) {
    const normalized = normalizeProfileName(profileName);
    if (!normalized)
        throw new Error('Feishu CLI profile is missing. Reconnect the Feishu account.');
    return withTemporaryFeishuCliHome(config, normalized, async (cliHome) => {
        await restoreFeishuCliProfileSnapshot(config, normalized, snapshot, { cliHome });
        const result = await runLarkCliJson(config, args, {
            profileName: normalized,
            cliHome,
            timeoutMs: options.timeoutMs,
        });
        const profileSnapshot = await captureFeishuCliProfileSnapshot(config, normalized, { cliHome });
        return { result, profileSnapshot };
    });
}
export async function captureFeishuCliProfileSnapshot(config, profileName, options = {}) {
    const normalized = normalizeProfileName(profileName);
    if (!normalized)
        throw new Error('profileName is required.');
    const root = resolveLarkCliHome(config, normalized, options.cliHome);
    const files = [];
    const budget = { totalBytes: 0 };
    await collectSnapshotFiles(root, '', files, budget);
    if (files.length === 0) {
        throw new Error(`lark-cli profile ${normalized} produced no local credential snapshot.`);
    }
    return {
        format: SNAPSHOT_FORMAT,
        profileName: normalized,
        capturedAt: new Date().toISOString(),
        files,
    };
}
export async function restoreFeishuCliProfileSnapshot(config, profileName, snapshot, options = {}) {
    const normalized = normalizeProfileName(profileName);
    if (!normalized)
        throw new Error('profileName is required.');
    if (!snapshot || snapshot.format !== SNAPSHOT_FORMAT || !Array.isArray(snapshot.files)) {
        throw new Error('Invalid lark-cli profile snapshot. Rebind Feishu.');
    }
    const snapshotProfile = normalizeProfileName(snapshot.profileName || normalized);
    if (snapshotProfile && snapshotProfile !== normalized) {
        throw new Error('lark-cli profile snapshot does not match the requested Feishu account.');
    }
    const root = resolveLarkCliHome(config, normalized, options.cliHome);
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    for (const file of snapshot.files) {
        const relativePath = normalizeSnapshotPath(file.path);
        if (!relativePath)
            continue;
        const destination = path.join(root, relativePath);
        if (!destination.startsWith(`${root}${path.sep}`))
            continue;
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        await fs.writeFile(destination, Buffer.from(file.contentBase64, 'base64'), { mode: 0o600 });
        if (file.mode && Number.isFinite(file.mode)) {
            await fs.chmod(destination, file.mode & 0o777).catch(() => null);
        }
    }
}
export function makeFeishuCliProfileName(investorId) {
    const safeInvestor = investorId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 28) || 'user';
    return `altselfs_${safeInvestor}_${id('lark').replace(/[^a-zA-Z0-9_-]/g, '')}`.slice(0, 80);
}
export function normalizeProfileName(value) {
    return value.trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 120);
}
async function ensureFeishuCliProfile(config, profileName, cliHome) {
    const appId = process.env.FEISHU_APP_ID?.trim();
    const appSecret = process.env.FEISHU_APP_SECRET?.trim();
    if (!appId || !appSecret)
        throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET must be configured on personal-agent-server.');
    const result = await runLarkCli(config, ['profile', 'add', '--name', profileName, '--app-id', appId, '--app-secret-stdin', '--brand', 'feishu'], {
        profileName,
        cliHome,
        stdin: `${appSecret}\n`,
        allowFailure: true,
    });
    if (result.code !== 0 && !`${result.stderr}\n${result.stdout}`.toLowerCase().includes('already')) {
        throw new Error(`lark-cli profile add failed: ${truncate(result.stderr || result.stdout, 1000)}`);
    }
}
async function runLarkCliJson(config, args, options = {}) {
    const result = await runLarkCli(config, [
        ...(options.profileName ? ['--profile', options.profileName] : []),
        ...args,
    ], options);
    const raw = result.code === 0 ? result.stdout : result.stderr || result.stdout;
    const parsed = parseJsonEnvelope(raw);
    if (result.code !== 0 && !options.allowFailure) {
        throw new Error(`lark-cli ${args.join(' ')} failed: ${truncate(raw || `exit ${result.code}`, 1500)}`);
    }
    return parsed || {
        ok: result.code === 0,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
    };
}
async function runLarkCli(config, args, options = {}) {
    const cliHome = resolveLarkCliHome(config, options.profileName, options.cliHome);
    await fs.mkdir(cliHome, { recursive: true, mode: 0o700 });
    return new Promise((resolve, reject) => {
        const child = spawn(config.larkCliBin, args, {
            cwd: cliHome,
            env: buildLarkCliEnv(config, cliHome),
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stdout = [];
        const stderr = [];
        const timeout = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`lark-cli timed out after ${options.timeoutMs || config.larkCliTimeoutMs}ms`));
        }, options.timeoutMs || config.larkCliTimeoutMs);
        child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
        child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timeout);
            resolve({
                code: code || 0,
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
            });
        });
        if (options.stdin)
            child.stdin.end(options.stdin);
        else
            child.stdin.end();
    });
}
async function withTemporaryFeishuCliHome(config, profileName, fn) {
    const root = path.resolve(config.larkCliHomeRoot);
    const runtimeRoot = path.join(root, 'runtime');
    const normalized = normalizeProfileName(profileName) || 'profile';
    const cliHome = path.join(runtimeRoot, `${normalized}_${id('run').replace(/[^a-zA-Z0-9_-]/g, '')}`);
    await fs.mkdir(cliHome, { recursive: true, mode: 0o700 });
    try {
        return await fn(cliHome);
    }
    finally {
        await fs.rm(cliHome, { recursive: true, force: true }).catch(() => null);
    }
}
function resolveLarkCliHome(config, profileName, cliHome) {
    if (cliHome)
        return path.resolve(cliHome);
    const root = path.resolve(config.larkCliHomeRoot);
    const normalized = profileName ? normalizeProfileName(profileName) : '';
    return normalized ? path.join(root, 'runtime', normalized) : root;
}
function buildLarkCliEnv(config, cliHome) {
    const env = {
        ...process.env,
        HOME: cliHome,
        XDG_CONFIG_HOME: path.join(cliHome, '.config'),
        XDG_CACHE_HOME: path.join(cliHome, '.cache'),
        npm_config_cache: path.join(cliHome, '.npm'),
        CI: '1',
        NO_UPDATE_NOTIFIER: '1',
    };
    if (config.outboundProxyUrl) {
        env.HTTP_PROXY = config.outboundProxyUrl;
        env.HTTPS_PROXY = config.outboundProxyUrl;
        env.http_proxy = config.outboundProxyUrl;
        env.https_proxy = config.outboundProxyUrl;
    }
    return env;
}
async function collectSnapshotFiles(root, relativeDir, files, budget) {
    let entries;
    try {
        entries = await fs.readdir(path.join(root, relativeDir), { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return;
        throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        if (SNAPSHOT_EXCLUDED_NAMES.has(entry.name) || entry.isSymbolicLink())
            continue;
        const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
        if (entry.isDirectory()) {
            await collectSnapshotFiles(root, relativePath, files, budget);
            continue;
        }
        if (!entry.isFile())
            continue;
        const fullPath = path.join(root, relativePath);
        const stat = await fs.stat(fullPath);
        if (stat.size > SNAPSHOT_MAX_FILE_BYTES)
            continue;
        if (files.length >= SNAPSHOT_MAX_FILES)
            throw new Error('lark-cli profile snapshot has too many files.');
        if (budget.totalBytes + stat.size > SNAPSHOT_MAX_TOTAL_BYTES)
            throw new Error('lark-cli profile snapshot is too large.');
        const content = await fs.readFile(fullPath);
        budget.totalBytes += content.length;
        files.push({
            path: relativePath.split(path.sep).join('/'),
            contentBase64: content.toString('base64'),
            mode: stat.mode & 0o777,
        });
    }
}
function normalizeSnapshotPath(value) {
    if (typeof value !== 'string' || !value.trim())
        return '';
    const normalized = path.normalize(value.replace(/\\/g, '/'));
    if (path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${path.sep}`))
        return '';
    return normalized;
}
function parseJsonEnvelope(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        const first = trimmed.indexOf('{');
        const last = trimmed.lastIndexOf('}');
        if (first >= 0 && last > first) {
            try {
                return JSON.parse(trimmed.slice(first, last + 1));
            }
            catch {
                return null;
            }
        }
        return null;
    }
}
function findFirstString(value, keys, pattern) {
    const found = findValue(value, keys, (item) => typeof item === 'string' && (!pattern || pattern.test(item)));
    return typeof found === 'string' ? found : '';
}
function findFirstNumber(value, keys) {
    const found = findValue(value, keys, (item) => typeof item === 'number' && Number.isFinite(item));
    return typeof found === 'number' ? found : null;
}
function findStringArray(value, keys) {
    const found = findValue(value, keys, (item) => (Array.isArray(item) && item.every((entry) => typeof entry === 'string')) || typeof item === 'string');
    if (typeof found === 'string')
        return found.split(/\s+|,/).map((item) => item.trim()).filter(Boolean);
    if (Array.isArray(found))
        return found.map(String);
    return null;
}
function findValue(value, keys, predicate) {
    const queue = [value];
    const wanted = new Set(keys.map((key) => key.toLowerCase()));
    while (queue.length > 0) {
        const current = queue.shift();
        if (Array.isArray(current)) {
            for (const item of current)
                queue.push(item);
            continue;
        }
        if (!isRecord(current))
            continue;
        for (const [key, entry] of Object.entries(current)) {
            if (wanted.has(key.toLowerCase()) && predicate(entry))
                return entry;
            if (isRecord(entry) || Array.isArray(entry))
                queue.push(entry);
        }
    }
    return undefined;
}
