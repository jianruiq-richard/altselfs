import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  extractCodexOutcomeFromRollout,
  startCodexRolloutEventBridge,
} from '../src/hermes/source-hermes-runtime.js';

function rolloutLine(timestamp: string, payload: Record<string, unknown>) {
  return `${JSON.stringify({ timestamp, type: 'event_msg', payload })}\n`;
}

test('rollout bridge tails an existing resumed session without replaying old events', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-rollout-bridge-'));
  const rollout = path.join(root, 'sessions', '2026', '07', '23', 'rollout.jsonl');
  await fs.mkdir(path.dirname(rollout), { recursive: true });
  await fs.writeFile(
    rollout,
    [
      rolloutLine('2026-07-23T07:00:00.000Z', {
        type: 'agent_message',
        message: 'old response',
      }),
      rolloutLine('2026-07-23T07:00:01.000Z', {
        type: 'task_complete',
        last_agent_message: 'old response',
      }),
    ].join('')
  );

  const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const startedAtMs = Date.now();
  const bridge = await startCodexRolloutEventBridge({
    codexHome: root,
    startedAtMs,
    emit: async (type, payload) => {
      emitted.push({ type, payload });
    },
  });

  const currentTimestamp = new Date(startedAtMs + 10).toISOString();
  await fs.appendFile(
    rollout,
    [
      rolloutLine(currentTimestamp, {
        type: 'agent_message',
        message: 'current response',
      }),
      rolloutLine(currentTimestamp, {
        type: 'task_complete',
        last_agent_message: 'current response',
      }),
    ].join('')
  );

  await new Promise((resolve) => setTimeout(resolve, 650));
  await bridge.stop();

  const projected = emitted.filter((event) => event.type === 'codex.agent_message' || event.type === 'codex.task_complete');
  assert.deepEqual(projected.map((event) => event.type), ['codex.agent_message', 'codex.task_complete']);
  assert.equal(projected[0]?.payload.message, 'current response');
  assert.equal(projected[1]?.payload.lastAgentMessage, 'current response');
  assert.equal(JSON.stringify(emitted).includes('old response'), false);

  await fs.rm(root, { recursive: true, force: true });
});

test('rollout outcome ignores task completion from an earlier turn', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-rollout-outcome-'));
  const rollout = path.join(root, 'rollout.jsonl');
  const startedAtMs = Date.now();
  await fs.writeFile(
    rollout,
    [
      rolloutLine('2026-07-23T07:00:00.000Z', {
        type: 'task_complete',
        last_agent_message: 'old response',
      }),
      rolloutLine(new Date(startedAtMs + 10).toISOString(), {
        type: 'agent_message',
        message: 'current partial response',
      }),
    ].join('')
  );

  const outcome = await extractCodexOutcomeFromRollout(rollout, startedAtMs);
  assert.equal(outcome.reply, 'current partial response');
  assert.equal(outcome.taskComplete, false);
  assert.equal(outcome.turnAborted, false);

  await fs.rm(root, { recursive: true, force: true });
});
