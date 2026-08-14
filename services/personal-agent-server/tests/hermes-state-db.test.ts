import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { readLatestHermesAssistantReply } from '../src/hermes/source-hermes-runtime.js';

const execFileAsync = promisify(execFile);

test('recovers the latest active final assistant message for the exact Hermes session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-hermes-state-'));
  const stateDb = path.join(root, 'state.db');
  const script = [
    'import sqlite3, sys',
    'conn = sqlite3.connect(sys.argv[1])',
    'conn.execute("""CREATE TABLE messages (',
    'id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,',
    'content TEXT, tool_calls TEXT, finish_reason TEXT, timestamp REAL NOT NULL,',
    'active INTEGER NOT NULL DEFAULT 1)""")',
    'rows = [',
    '  ("other-session", "assistant", "Wrong session", None, "stop", 101.0, 1),',
    '  ("target-session", "assistant", "Previous turn response", None, "stop", 99.0, 1),',
    '  ("target-session", "assistant", "", "[{\\"type\\":\\"function\\"}]", "tool_calls", 100.5, 1),',
    '  ("target-session", "assistant", "Recovered final response", None, "stop", 101.0, 1),',
    '  ("target-session", "assistant", "Inactive newer response", None, "stop", 102.0, 0),',
    ']',
    'conn.executemany("INSERT INTO messages (session_id, role, content, tool_calls, finish_reason, timestamp, active) VALUES (?, ?, ?, ?, ?, ?, ?)", rows)',
    'conn.commit()',
  ].join('\n');

  await execFileAsync('python3', ['-c', script, stateDb]);

  assert.equal(
    await readLatestHermesAssistantReply(root, 'target-session', 100_000),
    'Recovered final response'
  );
  assert.equal(await readLatestHermesAssistantReply(root, 'target-session', 103_000), '');
  assert.equal(await readLatestHermesAssistantReply(root, 'missing-session', 100_000), '');
  assert.equal(await readLatestHermesAssistantReply(root, '', 100_000), '');

  await fs.rm(root, { recursive: true, force: true });
});

test('ignores tool-call assistants and empty terminal sentinels', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-hermes-state-empty-'));
  const stateDb = path.join(root, 'state.db');
  const script = [
    'import sqlite3, sys',
    'conn = sqlite3.connect(sys.argv[1])',
    'conn.execute("""CREATE TABLE messages (',
    'id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,',
    'content TEXT, tool_calls TEXT, finish_reason TEXT, timestamp REAL NOT NULL,',
    'active INTEGER NOT NULL DEFAULT 1)""")',
    'conn.execute("INSERT INTO messages (session_id, role, content, tool_calls, finish_reason, timestamp) VALUES (?, ?, ?, ?, ?, ?)",',
    '             ("session-1", "assistant", "(empty)", None, "stop", 101.0))',
    'conn.execute("INSERT INTO messages (session_id, role, content, tool_calls, finish_reason, timestamp) VALUES (?, ?, ?, ?, ?, ?)",',
    '             ("session-1", "assistant", "Tool preparation", "[]", "tool_calls", 102.0))',
    'conn.commit()',
  ].join('\n');

  await execFileAsync('python3', ['-c', script, stateDb]);

  assert.equal(await readLatestHermesAssistantReply(root, 'session-1', 100_000), '');
  assert.equal(await readLatestHermesAssistantReply(path.join(root, 'missing'), 'session-1', 100_000), '');

  await fs.rm(root, { recursive: true, force: true });
});
