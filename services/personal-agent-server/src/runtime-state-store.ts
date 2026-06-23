import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ServerConfig } from './config.js';
import { getPostgresPool } from './postgres-stores.js';
import { nowIso } from './util.js';

const execFileAsync = promisify(execFile);

type RuntimeStateKind = 'user_runtime' | 'thread_workspace';

export type RuntimeStatePaths = {
  hermesHome: string;
  codexHome: string;
  workspace: string;
};

export type RuntimeStateSyncInput = {
  userId: string;
  threadId: string;
  paths: RuntimeStatePaths;
};

export type RuntimeStateSyncResult = {
  enabled: boolean;
  restored: Array<{ kind: RuntimeStateKind; sizeBytes: number; updatedAt?: string }>;
  flushed: Array<{ kind: RuntimeStateKind; sizeBytes: number; checksum: string }>;
  swept: string[];
  warnings: string[];
};

export interface RuntimeStateStore {
  hydrate(input: RuntimeStateSyncInput): Promise<Pick<RuntimeStateSyncResult, 'enabled' | 'restored' | 'warnings'>>;
  flush(input: RuntimeStateSyncInput): Promise<Pick<RuntimeStateSyncResult, 'enabled' | 'flushed' | 'warnings'>>;
  sweep(input: {
    roots: string[];
    excludePaths: string[];
    ttlMs: number;
  }): Promise<Pick<RuntimeStateSyncResult, 'enabled' | 'swept' | 'warnings'>>;
}

export class NoopRuntimeStateStore implements RuntimeStateStore {
  async hydrate() {
    return { enabled: false, restored: [], warnings: [] };
  }

  async flush() {
    return { enabled: false, flushed: [], warnings: [] };
  }

  async sweep() {
    return { enabled: false, swept: [], warnings: [] };
  }
}

export class PostgresRuntimeStateStore implements RuntimeStateStore {
  private schemaReady = false;

  constructor(private config: ServerConfig) {}

  async hydrate(input: RuntimeStateSyncInput) {
    if (!this.config.runtimeStateSyncEnabled) return { enabled: false, restored: [], warnings: [] };
    const warnings: string[] = [];
    const restored: RuntimeStateSyncResult['restored'] = [];
    await this.ensureSchema();
    for (const item of runtimeStateItems(input)) {
      try {
        const snapshot = await this.readSnapshot(input.userId, input.threadId, item.kind);
        if (!snapshot) continue;
        await unpackArchive(snapshot.archiveBytes, item.entries);
        restored.push({
          kind: item.kind,
          sizeBytes: snapshot.sizeBytes,
          updatedAt: snapshot.updatedAt,
        });
      } catch (error) {
        warnings.push(`${item.kind} hydrate failed: ${errorMessage(error)}`);
      }
    }
    return { enabled: true, restored, warnings };
  }

  async flush(input: RuntimeStateSyncInput) {
    if (!this.config.runtimeStateSyncEnabled) return { enabled: false, flushed: [], warnings: [] };
    const warnings: string[] = [];
    const flushed: RuntimeStateSyncResult['flushed'] = [];
    await this.ensureSchema();
    for (const item of runtimeStateItems(input)) {
      try {
        const archiveBytes = await packDirectories(item.entries);
        if (!archiveBytes) continue;
        if (archiveBytes.byteLength > this.config.runtimeStateMaxArchiveBytes) {
          warnings.push(
            `${item.kind} archive ${archiveBytes.byteLength} bytes exceeds RUNTIME_STATE_MAX_ARCHIVE_BYTES=${this.config.runtimeStateMaxArchiveBytes}; skipped`
          );
          continue;
        }
        const checksum = sha256(archiveBytes);
        await this.writeSnapshot({
          userId: input.userId,
          threadId: item.kind === 'thread_workspace' ? input.threadId : null,
          kind: item.kind,
          archiveBytes,
          checksum,
          paths: Object.fromEntries(item.entries.map((entry) => [entry.label, entry.path])),
        });
        flushed.push({ kind: item.kind, sizeBytes: archiveBytes.byteLength, checksum });
      } catch (error) {
        warnings.push(`${item.kind} flush failed: ${errorMessage(error)}`);
      }
    }
    return { enabled: true, flushed, warnings };
  }

  async sweep(input: { roots: string[]; excludePaths: string[]; ttlMs: number }) {
    if (!this.config.runtimeStateSyncEnabled) return { enabled: false, swept: [], warnings: [] };
    const warnings: string[] = [];
    const swept: string[] = [];
    const exclude = new Set(input.excludePaths.map((item) => path.resolve(item)));
    const cutoff = Date.now() - input.ttlMs;
    for (const root of input.roots) {
      try {
        const resolvedRoot = path.resolve(root);
        const entries = await fs.readdir(resolvedRoot, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const candidate = path.join(resolvedRoot, entry.name);
          if (exclude.has(path.resolve(candidate))) continue;
          const stat = await fs.stat(candidate).catch(() => null);
          if (!stat || stat.mtimeMs >= cutoff) continue;
          await fs.rm(candidate, { recursive: true, force: true });
          swept.push(candidate);
        }
      } catch (error) {
        warnings.push(`${root} sweep failed: ${errorMessage(error)}`);
      }
    }
    return { enabled: true, swept, warnings };
  }

  private async readSnapshot(userId: string, threadId: string, kind: RuntimeStateKind) {
    const pool = await getPostgresPool(this.config);
    const result = await pool.query(
      [
        'select archive_bytes, archive_size_bytes, checksum_sha256, updated_at',
        'from agent_runtime_state_snapshots',
        'where state_key = $1',
        'limit 1',
      ].join(' '),
      [stateKey(userId, kind === 'thread_workspace' ? threadId : null, kind)]
    );
    const row = result.rows[0];
    if (!row) return null;
    const archiveBytes = row.archive_bytes;
    if (!Buffer.isBuffer(archiveBytes)) return null;
    return {
      archiveBytes,
      sizeBytes: Number(row.archive_size_bytes || archiveBytes.byteLength),
      checksum: String(row.checksum_sha256 || ''),
      updatedAt: row.updated_at ? new Date(row.updated_at as string | Date).toISOString() : undefined,
    };
  }

  private async writeSnapshot(input: {
    userId: string;
    threadId: string | null;
    kind: RuntimeStateKind;
    archiveBytes: Buffer;
    checksum: string;
    paths: Record<string, string>;
  }) {
    const pool = await getPostgresPool(this.config);
    await pool.query(
      [
        'insert into agent_runtime_state_snapshots',
        '(state_key, user_id, thread_id, state_kind, archive_format, archive_bytes, archive_size_bytes, checksum_sha256, revision, paths, created_at, updated_at)',
        "values ($1, $2, $3, $4, 'tar.gz', $5, $6, $7, 1, $8::jsonb, now(), now())",
        'on conflict (state_key) do update set',
        'archive_bytes = excluded.archive_bytes,',
        'archive_size_bytes = excluded.archive_size_bytes,',
        'checksum_sha256 = excluded.checksum_sha256,',
        'revision = agent_runtime_state_snapshots.revision + 1,',
        'paths = excluded.paths,',
        'updated_at = now()',
      ].join(' '),
      [
        stateKey(input.userId, input.threadId, input.kind),
        input.userId,
        input.threadId,
        input.kind,
        input.archiveBytes,
        input.archiveBytes.byteLength,
        input.checksum,
        JSON.stringify(input.paths),
      ]
    );
  }

  private async ensureSchema() {
    if (this.schemaReady) return;
    const pool = await getPostgresPool(this.config);
    await pool.query(`
      create table if not exists agent_runtime_state_snapshots (
        state_key text primary key,
        user_id text not null,
        thread_id text,
        state_kind text not null check (state_kind in ('user_runtime', 'thread_workspace')),
        archive_format text not null default 'tar.gz',
        archive_bytes bytea not null,
        archive_size_bytes integer not null,
        checksum_sha256 text not null,
        revision integer not null default 1,
        paths jsonb not null default '{}',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await pool.query(`
      create index if not exists agent_runtime_state_snapshots_user_kind_idx
      on agent_runtime_state_snapshots (user_id, state_kind, updated_at desc)
    `);
    this.schemaReady = true;
  }
}

function runtimeStateItems(input: RuntimeStateSyncInput): Array<{
  kind: RuntimeStateKind;
  entries: Array<{ label: string; path: string }>;
}> {
  return [
    {
      kind: 'user_runtime',
      entries: [
        { label: 'hermes-home', path: input.paths.hermesHome },
        { label: 'codex-home', path: input.paths.codexHome },
      ],
    },
    {
      kind: 'thread_workspace',
      entries: [{ label: 'workspace', path: input.paths.workspace }],
    },
  ];
}

async function packDirectories(entries: Array<{ label: string; path: string }>) {
  const existing = [];
  for (const entry of entries) {
    const stat = await fs.stat(entry.path).catch(() => null);
    if (stat?.isDirectory()) existing.push(entry);
  }
  if (existing.length === 0) return null;

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-runtime-state-pack-'));
  try {
    const staging = path.join(tempRoot, 'state');
    await fs.mkdir(staging, { recursive: true });
    for (const entry of existing) {
      await fs.cp(entry.path, path.join(staging, entry.label), {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
    }
    const archivePath = path.join(tempRoot, 'state.tar.gz');
    await execFileAsync('tar', ['-czf', archivePath, '-C', staging, '.']);
    return await fs.readFile(archivePath);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function unpackArchive(archiveBytes: Buffer, entries: Array<{ label: string; path: string }>) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-runtime-state-unpack-'));
  try {
    const archivePath = path.join(tempRoot, 'state.tar.gz');
    const extractRoot = path.join(tempRoot, 'extract');
    await fs.writeFile(archivePath, archiveBytes);
    await fs.mkdir(extractRoot, { recursive: true });
    await execFileAsync('tar', ['-xzf', archivePath, '-C', extractRoot]);
    for (const entry of entries) {
      const extracted = path.join(extractRoot, entry.label);
      const stat = await fs.stat(extracted).catch(() => null);
      if (!stat?.isDirectory()) continue;
      await fs.rm(entry.path, { recursive: true, force: true });
      await fs.mkdir(path.dirname(entry.path), { recursive: true });
      await fs.cp(extracted, entry.path, {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function stateKey(userId: string, threadId: string | null, kind: RuntimeStateKind) {
  return createHash('sha256').update(`${kind}\0${userId}\0${threadId || ''}`).digest('hex');
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
