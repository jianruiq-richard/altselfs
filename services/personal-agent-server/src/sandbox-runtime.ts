import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerConfig } from './config.js';
import type { TurnStartRequest } from './types.js';
import { nowIso } from './util.js';

export type RuntimePaths = {
  mode: ServerConfig['runtimeStateMode'];
  runId: string;
  userId: string;
  threadId: string;
  userSegment: string;
  threadSegment: string;
  hermesHome: string;
  codexHome: string;
  workspace: string;
  userRoot?: string;
  userProfileDir?: string;
  threadRoot?: string;
  statePath?: string;
};

export function resolveRuntimePaths(config: ServerConfig, request: TurnStartRequest, runId: string): RuntimePaths {
  const userId = request.userId || 'anonymous';
  const threadId = request.threadId || 'default';
  const userSegment = sanitizePathSegment(userId);
  const threadSegment = sanitizePathSegment(threadId);

  if (config.runtimeStateMode === 'sandbox') {
    const userRoot = path.join(config.sandboxStorageRoot, 'users', userSegment);
    const threadRoot = path.join(userRoot, 'threads', threadSegment);
    return {
      mode: 'sandbox',
      runId,
      userId,
      threadId,
      userSegment,
      threadSegment,
      userRoot,
      userProfileDir: path.join(userRoot, 'profile'),
      threadRoot,
      statePath: path.join(threadRoot, 'state.json'),
      hermesHome: path.join(userRoot, 'hermes-home'),
      codexHome: path.join(threadRoot, 'codex-home'),
      workspace: path.join(threadRoot, 'workspace'),
    };
  }

  const runSegment = sanitizePathSegment(runId);
  return {
    mode: config.runtimeStateMode,
    runId,
    userId,
    threadId,
    userSegment,
    threadSegment,
    hermesHome: path.join(config.hermesHomeRoot, userSegment, threadSegment, runSegment, 'hermes-home'),
    codexHome: path.join(config.codexHomeRoot, userSegment, threadSegment, runSegment, 'codex-home'),
    workspace: path.join(config.hermesWorkspaceRoot, userSegment, threadSegment, runSegment, 'workspace'),
  };
}

export async function prepareRuntimeDirectories(paths: RuntimePaths) {
  await fs.mkdir(paths.hermesHome, { recursive: true });
  await fs.mkdir(paths.codexHome, { recursive: true });
  await fs.mkdir(paths.workspace, { recursive: true });
  if (paths.userProfileDir) await fs.mkdir(paths.userProfileDir, { recursive: true });
  await fs.mkdir(path.join(paths.workspace, 'uploads'), { recursive: true });
  await fs.mkdir(path.join(paths.workspace, 'artifacts'), { recursive: true });
  await fs.mkdir(path.join(paths.workspace, 'artifacts', 'parsed'), { recursive: true });
  await fs.mkdir(path.join(paths.workspace, 'outputs'), { recursive: true });
  await fs.mkdir(path.join(paths.workspace, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(paths.workspace, 'cache'), { recursive: true });
  await fs.mkdir(path.join(paths.workspace, '.runs'), { recursive: true });
  await fs.mkdir(path.join(paths.workspace, 'external-memory'), { recursive: true });
  await fs.mkdir(path.join(paths.workspace, 'logs'), { recursive: true });
}

export async function readSandboxState(paths: RuntimePaths) {
  if (!paths.statePath) return null;
  try {
    return JSON.parse(await fs.readFile(paths.statePath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeSandboxState(paths: RuntimePaths, patch: Record<string, unknown>) {
  if (!paths.statePath) return;
  const previous = (await readSandboxState(paths)) || {};
  const state = {
    ...previous,
    ...patch,
    userId: paths.userId,
    threadId: paths.threadId,
    mode: paths.mode,
    hermesHome: paths.hermesHome,
    codexHome: paths.codexHome,
    workspace: paths.workspace,
    updatedAt: nowIso(),
  };
  await fs.mkdir(path.dirname(paths.statePath), { recursive: true });
  await fs.writeFile(paths.statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function calculateDirectoryBytes(root: string) {
  try {
    return await calculateDirectoryBytesInner(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

async function calculateDirectoryBytesInner(root: string): Promise<number> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      total += await calculateDirectoryBytesInner(fullPath);
      continue;
    }
    if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      total += stat.size;
    }
  }
  return total;
}

export function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'anonymous';
}
