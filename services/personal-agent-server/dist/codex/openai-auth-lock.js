import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const DEFAULT_WAIT_TIMEOUT_MS = 650_000;
const DEFAULT_STALE_LOCK_MS = 20 * 60_000;
const DEFAULT_POLL_MS = 250;
const DEFAULT_TEMP_AUTH_TTL_MS = 24 * 60 * 60_000;
export async function prepareTemporaryOpenAiAuth(input) {
    if (!input.sourcePath)
        return undefined;
    const codexHome = path.resolve(input.codexHome);
    await fs.mkdir(codexHome, { recursive: true });
    const sourcePath = path.resolve(input.sourcePath);
    const authPath = path.join(codexHome, 'auth.json');
    const releaseAuthMountLock = await acquireDirectoryLock(path.join(codexHome, '.auth.json.lock'), {
        waitTimeoutMs: input.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
        staleLockMs: input.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
        pollMs: input.pollMs ?? DEFAULT_POLL_MS,
    });
    let released = false;
    let tempDir = '';
    let tempAuthPath = '';
    let initialAuthContent;
    const release = async () => {
        if (released)
            return;
        released = true;
        try {
            if (tempAuthPath) {
                let writeBackError;
                try {
                    if (initialAuthContent) {
                        await syncTemporaryAuthBackToSource({
                            tempAuthPath,
                            sourcePath,
                            initialAuthContent,
                            waitTimeoutMs: input.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
                            staleLockMs: input.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
                            pollMs: input.pollMs ?? DEFAULT_POLL_MS,
                        });
                    }
                }
                catch (error) {
                    writeBackError = error;
                }
                await cleanupMountedTemporaryAuth(authPath, tempAuthPath);
                if (writeBackError)
                    throw writeBackError;
            }
        }
        finally {
            try {
                if (tempDir)
                    await fs.rm(tempDir, { recursive: true, force: true });
            }
            finally {
                await releaseAuthMountLock();
            }
        }
    };
    try {
        await fs.stat(sourcePath);
        const tempParent = input.tempRoot ? path.resolve(input.tempRoot) : path.join(codexHome, '.tmp-auth');
        await fs.mkdir(tempParent, { recursive: true });
        await cleanupStaleTemporaryAuthDirs(tempParent, DEFAULT_TEMP_AUTH_TTL_MS).catch(() => undefined);
        const label = sanitizeTempPathSegment(input.label || 'codex');
        tempDir = path.join(tempParent, `${label}-${process.pid}-${randomUUID()}`);
        await fs.mkdir(tempDir, { recursive: false });
        tempAuthPath = path.join(tempDir, 'auth.json');
        initialAuthContent = await fs.readFile(sourcePath);
        await writeAuthFileAtomically(initialAuthContent, tempAuthPath);
        await replaceAuthWithSymlink({ authPath, targetPath: tempAuthPath });
        return { authPath, sourcePath, tempDir, release };
    }
    catch (error) {
        await release().catch(() => undefined);
        throw error;
    }
}
export async function acquireSharedOpenAiAuthLock(input) {
    if (!input.sourcePath)
        return undefined;
    const sourcePath = path.resolve(input.sourcePath);
    const authPath = path.join(input.codexHome, 'auth.json');
    const lockPath = `${sourcePath}.lock`;
    const releaseDirectoryLock = await acquireDirectoryLock(lockPath, {
        waitTimeoutMs: input.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
        staleLockMs: input.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
        pollMs: input.pollMs ?? DEFAULT_POLL_MS,
    });
    let released = false;
    const release = async () => {
        if (released)
            return;
        released = true;
        try {
            await syncAuthBackToSource(authPath, sourcePath);
        }
        finally {
            await releaseDirectoryLock();
        }
    };
    try {
        await ensureAuthSymlink({ authPath, codexHome: input.codexHome, sourcePath });
        return { authPath, sourcePath, release };
    }
    catch (error) {
        await release().catch(() => undefined);
        throw error;
    }
}
async function ensureAuthSymlink(input) {
    await fs.mkdir(input.codexHome, { recursive: true });
    const sourceStat = await fs.stat(input.sourcePath);
    try {
        const existing = await fs.lstat(input.authPath);
        if (existing.isSymbolicLink()) {
            const target = await fs.readlink(input.authPath);
            const resolvedTarget = path.resolve(path.dirname(input.authPath), target);
            if (resolvedTarget === input.sourcePath) {
                await fs.chmod(input.sourcePath, 0o600).catch(() => undefined);
                return;
            }
            await fs.unlink(input.authPath);
        }
        else if (existing.isFile()) {
            if (existing.mtimeMs > sourceStat.mtimeMs + 1000) {
                await copyAuthFileAtomically(input.authPath, input.sourcePath);
            }
            await fs.unlink(input.authPath);
        }
        else {
            throw new Error(`Refusing to replace non-file Codex auth path: ${input.authPath}`);
        }
    }
    catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT')
            throw error;
    }
    await fs.symlink(input.sourcePath, input.authPath);
    await fs.chmod(input.sourcePath, 0o600).catch(() => undefined);
}
async function syncAuthBackToSource(authPath, sourcePath) {
    try {
        const existing = await fs.lstat(authPath);
        if (existing.isSymbolicLink()) {
            const target = await fs.readlink(authPath);
            const resolvedTarget = path.resolve(path.dirname(authPath), target);
            if (resolvedTarget === sourcePath) {
                await fs.chmod(sourcePath, 0o600).catch(() => undefined);
                return;
            }
        }
        if (!existing.isFile())
            return;
        await copyAuthFileAtomically(authPath, sourcePath);
        await fs.unlink(authPath).catch(() => undefined);
        await fs.symlink(sourcePath, authPath).catch(() => undefined);
    }
    catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT')
            return;
        throw error;
    }
}
async function replaceAuthWithSymlink(input) {
    try {
        const existing = await fs.lstat(input.authPath);
        if (existing.isDirectory() && !existing.isSymbolicLink()) {
            throw new Error(`Refusing to replace non-file Codex auth path: ${input.authPath}`);
        }
        await fs.unlink(input.authPath);
    }
    catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT')
            throw error;
    }
    await fs.symlink(input.targetPath, input.authPath);
    await fs.chmod(input.targetPath, 0o600).catch(() => undefined);
}
async function cleanupMountedTemporaryAuth(authPath, expectedTargetPath) {
    try {
        const existing = await fs.lstat(authPath);
        if (existing.isSymbolicLink()) {
            const target = await fs.readlink(authPath);
            const resolvedTarget = path.resolve(path.dirname(authPath), target);
            if (resolvedTarget === expectedTargetPath)
                await fs.unlink(authPath);
            return;
        }
        if (existing.isFile()) {
            await fs.unlink(authPath);
        }
    }
    catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT')
            throw error;
    }
}
async function cleanupStaleTemporaryAuthDirs(tempParent, ttlMs) {
    const entries = await fs.readdir(tempParent, { withFileTypes: true });
    const now = Date.now();
    await Promise.all(entries.map(async (entry) => {
        if (!entry.isDirectory())
            return;
        const fullPath = path.join(tempParent, entry.name);
        const stat = await fs.stat(fullPath).catch(() => undefined);
        if (!stat || now - stat.mtimeMs < ttlMs)
            return;
        await fs.rm(fullPath, { recursive: true, force: true });
    }));
}
async function syncTemporaryAuthBackToSource(input) {
    const tempContent = await fs.readFile(input.tempAuthPath).catch((error) => {
        if (isNodeError(error) && error.code === 'ENOENT')
            return undefined;
        throw error;
    });
    if (!tempContent)
        return;
    if (Buffer.compare(tempContent, input.initialAuthContent) === 0)
        return;
    const releaseSourceLock = await acquireDirectoryLock(`${input.sourcePath}.lock`, {
        waitTimeoutMs: input.waitTimeoutMs,
        staleLockMs: input.staleLockMs,
        pollMs: input.pollMs,
    });
    try {
        const tempStat = await fs.stat(input.tempAuthPath).catch((error) => {
            if (isNodeError(error) && error.code === 'ENOENT')
                return undefined;
            throw error;
        });
        if (!tempStat)
            return;
        const sourceStat = await fs.stat(input.sourcePath).catch((error) => {
            if (isNodeError(error) && error.code === 'ENOENT')
                return undefined;
            throw error;
        });
        const sourceContent = await fs.readFile(input.sourcePath).catch((error) => {
            if (isNodeError(error) && error.code === 'ENOENT')
                return undefined;
            throw error;
        });
        if (sourceContent && Buffer.compare(sourceContent, tempContent) === 0) {
            await fs.chmod(input.sourcePath, 0o600).catch(() => undefined);
            return;
        }
        const sourceChangedSinceTempStarted = sourceContent && Buffer.compare(sourceContent, input.initialAuthContent) !== 0;
        if (sourceChangedSinceTempStarted && sourceStat && tempStat.mtimeMs <= sourceStat.mtimeMs) {
            return;
        }
        await writeAuthFileAtomically(tempContent, input.sourcePath);
    }
    finally {
        await releaseSourceLock();
    }
}
async function copyAuthFileAtomically(from, to) {
    await fs.mkdir(path.dirname(to), { recursive: true });
    const tempPath = `${to}.tmp-${process.pid}-${randomUUID()}`;
    try {
        await fs.copyFile(from, tempPath);
        await fs.chmod(tempPath, 0o600).catch(() => undefined);
        await fs.rename(tempPath, to);
        await fs.chmod(to, 0o600).catch(() => undefined);
    }
    catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
async function writeAuthFileAtomically(content, to) {
    await fs.mkdir(path.dirname(to), { recursive: true });
    const tempPath = `${to}.tmp-${process.pid}-${randomUUID()}`;
    try {
        await fs.writeFile(tempPath, content);
        await fs.chmod(tempPath, 0o600).catch(() => undefined);
        await fs.rename(tempPath, to);
        await fs.chmod(to, 0o600).catch(() => undefined);
    }
    catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
async function acquireDirectoryLock(lockPath, options) {
    const startedAt = Date.now();
    for (;;) {
        try {
            await fs.mkdir(lockPath, { recursive: false });
            const ownerPath = path.join(lockPath, 'owner.json');
            await fs.writeFile(ownerPath, JSON.stringify({ pid: process.pid, hostname: process.env.HOSTNAME || null, acquiredAt: new Date().toISOString() }), 'utf8').catch(() => undefined);
            return async () => {
                await fs.rm(lockPath, { recursive: true, force: true });
            };
        }
        catch (error) {
            if (!isNodeError(error) || error.code !== 'EEXIST')
                throw error;
            const ageMs = await getLockAgeMs(lockPath);
            if (ageMs !== null && ageMs > options.staleLockMs) {
                await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
                continue;
            }
            if (Date.now() - startedAt > options.waitTimeoutMs) {
                throw new Error(`Timed out waiting for Codex OpenAI auth lock: ${lockPath}`);
            }
            await sleep(options.pollMs);
        }
    }
}
async function getLockAgeMs(lockPath) {
    try {
        const stat = await fs.stat(lockPath);
        return Date.now() - stat.mtimeMs;
    }
    catch {
        return null;
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function sanitizeTempPathSegment(value) {
    const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
    return sanitized || 'codex';
}
function isNodeError(error) {
    return error instanceof Error && 'code' in error;
}
