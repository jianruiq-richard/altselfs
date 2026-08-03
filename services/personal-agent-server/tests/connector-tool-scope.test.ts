import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';
import {
  buildConnectorToolScopeInstruction,
  normalizeToolNameList,
} from '../src/connector-tool-scope.js';
import {
  cancelActiveRun,
  clearRunCancellation,
  getActiveRuntoolScope,
  registerActiveRun,
  unregisterActiveRun,
} from '../src/run-control.js';

function fakeChildProcess(onKill?: (signal: string) => void) {
  return Object.assign(new EventEmitter(), {
    kill: (signal?: NodeJS.Signals | number) => {
      onKill?.(String(signal || 'SIGTERM'));
      return true;
    },
  }) as unknown as ChildProcess;
}

test('active run preserves an explicitly empty connector tool allowlist', () => {
  const runId = 'run-empty-connector-scope';
  registerActiveRun({
    runId,
    userId: 'user',
    threadId: 'thread',
    child: fakeChildProcess(),
    competitorToolNames: [],
    personalDatatoolNames: [],
  });

  try {
    assert.deepEqual(getActiveRuntoolScope(runId), {
      competitorToolNames: [],
      personalDatatoolNames: [],
    });
  } finally {
    unregisterActiveRun(runId);
  }
});

test('active run connector tool allowlists are copied on write and read', () => {
  const runId = 'run-copied-connector-scope';
  const competitorToolNames = ['altselfs_similarweb_api1'];
  registerActiveRun({
    runId,
    userId: 'user',
    threadId: 'thread',
    child: fakeChildProcess(),
    competitorToolNames,
  });
  competitorToolNames.push('altselfs_semrush13');

  try {
    const firstRead = getActiveRuntoolScope(runId);
    assert.deepEqual(firstRead?.competitorToolNames, ['altselfs_similarweb_api1']);
    firstRead?.competitorToolNames?.push('altselfs_domain_metrics_check');
    assert.deepEqual(
      getActiveRuntoolScope(runId)?.competitorToolNames,
      ['altselfs_similarweb_api1']
    );
  } finally {
    unregisterActiveRun(runId);
  }
});

test('active run cancellation sends SIGTERM once then escalates to SIGKILL', async () => {
  const runId = 'run-cancel-escalation';
  const signals: string[] = [];
  const originalWarn = console.warn;
  console.warn = () => undefined;
  registerActiveRun({
    runId,
    userId: 'user',
    threadId: 'thread',
    child: fakeChildProcess((signal) => signals.push(signal)),
    cancelGraceMs: 1000,
  });

  try {
    const first = cancelActiveRun(runId, { graceMs: 1000 });
    assert.equal(first.cancelled, true);
    assert.equal(first.alreadyRequested, false);
    assert.deepEqual(signals, ['SIGTERM']);

    const second = cancelActiveRun(runId, { graceMs: 1000 });
    assert.equal(second.cancelled, true);
    assert.equal(second.alreadyRequested, true);
    assert.deepEqual(signals, ['SIGTERM']);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  } finally {
    console.warn = originalWarn;
    unregisterActiveRun(runId);
    clearRunCancellation(runId);
  }
});

test('Codex receives an explicit none instruction when connector tools are disabled', () => {
  const instruction = buildConnectorToolScopeInstruction([]);
  assert.match(instruction, /for this turn: none/);
  assert.match(instruction, /older resumed Codex session/);
});

test('bridge connector scope treats a missing or empty list as no enabled tools', () => {
  assert.deepEqual(normalizeToolNameList(undefined), []);
  assert.deepEqual(normalizeToolNameList([]), []);
  assert.deepEqual(
    normalizeToolNameList(['altselfs_similarweb_api1', '', 'altselfs_similarweb_api1']),
    ['altselfs_similarweb_api1']
  );
});
