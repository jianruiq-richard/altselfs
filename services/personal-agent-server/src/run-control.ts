import type { ChildProcess } from 'node:child_process';
import { nowIso } from './util.js';

export class AgentRunCancelledError extends Error {
  constructor(public readonly runId: string) {
    super(`Agent run cancelled: ${runId}`);
    this.name = 'AgentRunCancelledError';
  }
}

type ActiveRun = {
  runId: string;
  userId: string;
  threadId: string;
  child: ChildProcess;
  startedAt: string;
  cancelledAt?: string;
  personalDatatoolNames?: string[];
};

const activeRuns = new Map<string, ActiveRun>();
const cancelledRuns = new Map<string, string>();

export function registerActiveRun(input: {
  runId: string;
  userId: string;
  threadId: string;
  child: ChildProcess;
  personalDatatoolNames?: string[];
}) {
  activeRuns.set(input.runId, {
    ...input,
    personalDatatoolNames: input.personalDatatoolNames ? [...input.personalDatatoolNames] : undefined,
    startedAt: nowIso(),
  });
  if (cancelledRuns.has(input.runId)) {
    try {
      input.child.kill('SIGTERM');
    } catch {
      // The process may have already exited.
    }
  }
}

export function getActiveRuntoolScope(runId: string) {
  const active = activeRuns.get(runId);
  if (!active) return null;
  return {
    personalDatatoolNames: active.personalDatatoolNames ? [...active.personalDatatoolNames] : undefined,
  };
}

export function unregisterActiveRun(runId: string) {
  activeRuns.delete(runId);
}

export function clearRunCancellation(runId: string) {
  cancelledRuns.delete(runId);
}

export function cancelActiveRun(runId: string) {
  const now = nowIso();
  cancelledRuns.set(runId, now);
  const active = activeRuns.get(runId);
  if (!active) {
    return { cancelled: false, runId, alreadyFinished: true, cancelledAt: now };
  }
  active.cancelledAt = now;
  try {
    active.child.kill('SIGTERM');
  } catch {
    // The process may have exited between lookup and kill.
  }
  return {
    cancelled: true,
    runId,
    userId: active.userId,
    threadId: active.threadId,
    startedAt: active.startedAt,
    cancelledAt: now,
  };
}

export function isRunCancelled(runId: string) {
  return cancelledRuns.has(runId);
}

export function getRunCancelledAt(runId: string) {
  return cancelledRuns.get(runId) || null;
}

export function createRunCancelledError(runId: string) {
  return new AgentRunCancelledError(runId);
}

export function isAgentRunCancelledError(error: unknown): error is AgentRunCancelledError {
  return error instanceof AgentRunCancelledError;
}

export function listActiveRuns() {
  return Array.from(activeRuns.values()).map((run) => ({
    runId: run.runId,
    userId: run.userId,
    threadId: run.threadId,
    startedAt: run.startedAt,
    cancelledAt: run.cancelledAt || null,
  }));
}
