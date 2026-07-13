import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_WAIT_TIMEOUT_MS = 650_000;
const DEFAULT_STALE_LOCK_MS = 20 * 60_000;
const DEFAULT_POLL_MS = 250;

export type SharedOpenAiAuthLock = {
  authPath: string;
  sourcePath: string;
  release: () => Promise<void>;
};

export async function acquireSharedOpenAiAuthLock(input: {
  codexHome: string;
  sourcePath?: string;
  waitTimeoutMs?: number;
  staleLockMs?: number;
  pollMs?: number;
}): Promise<SharedOpenAiAuthLock | undefined> {
  if (!input.sourcePath) return undefined;

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
    if (released) return;
    released = true;
    try {
      await syncAuthBackToSource(authPath, sourcePath);
    } finally {
      await releaseDirectoryLock();
    }
  };

  try {
    await ensureAuthSymlink({ authPath, codexHome: input.codexHome, sourcePath });
    return { authPath, sourcePath, release };
  } catch (error) {
    await release().catch(() => undefined);
    throw error;
  }
}

async function ensureAuthSymlink(input: { authPath: string; codexHome: string; sourcePath: string }) {
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
    } else if (existing.isFile()) {
      if (existing.mtimeMs > sourceStat.mtimeMs + 1000) {
        await copyAuthFileAtomically(input.authPath, input.sourcePath);
      }
      await fs.unlink(input.authPath);
    } else {
      throw new Error(`Refusing to replace non-file Codex auth path: ${input.authPath}`);
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }

  await fs.symlink(input.sourcePath, input.authPath);
  await fs.chmod(input.sourcePath, 0o600).catch(() => undefined);
}

async function syncAuthBackToSource(authPath: string, sourcePath: string) {
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
    if (!existing.isFile()) return;
    await copyAuthFileAtomically(authPath, sourcePath);
    await fs.unlink(authPath).catch(() => undefined);
    await fs.symlink(sourcePath, authPath).catch(() => undefined);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
}

async function copyAuthFileAtomically(from: string, to: string) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  const tempPath = `${to}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.copyFile(from, tempPath);
    await fs.chmod(tempPath, 0o600).catch(() => undefined);
    await fs.rename(tempPath, to);
    await fs.chmod(to, 0o600).catch(() => undefined);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function acquireDirectoryLock(
  lockPath: string,
  options: { waitTimeoutMs: number; staleLockMs: number; pollMs: number }
) {
  const startedAt = Date.now();
  for (;;) {
    try {
      await fs.mkdir(lockPath, { recursive: false });
      const ownerPath = path.join(lockPath, 'owner.json');
      await fs.writeFile(
        ownerPath,
        JSON.stringify({ pid: process.pid, hostname: process.env.HOSTNAME || null, acquiredAt: new Date().toISOString() }),
        'utf8'
      ).catch(() => undefined);
      return async () => {
        await fs.rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
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

async function getLockAgeMs(lockPath: string) {
  try {
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
