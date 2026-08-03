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
  sigtermSentAt?: string;
  sigkillSentAt?: string;
  lastSignal?: 'SIGTERM' | 'SIGKILL';
  processGroupId?: number;
  cancelGraceMs?: number;
  killEscalationTimer?: ReturnType<typeof setTimeout>;
  competitorToolNames?: string[];
  personalDatatoolNames?: string[];
};

const activeRuns = new Map<string, ActiveRun>();
const cancelledRuns = new Map<string, string>();

export function registerActiveRun(input: {
  runId: string;
  userId: string;
  threadId: string;
  child: ChildProcess;
  killProcessGroup?: boolean;
  cancelGraceMs?: number;
  competitorToolNames?: string[];
  personalDatatoolNames?: string[];
}) {
  activeRuns.set(input.runId, {
    ...input,
    competitorToolNames: input.competitorToolNames ? [...input.competitorToolNames] : undefined,
    personalDatatoolNames: input.personalDatatoolNames ? [...input.personalDatatoolNames] : undefined,
    processGroupId: input.killProcessGroup && typeof input.child.pid === 'number' ? input.child.pid : undefined,
    cancelGraceMs: input.cancelGraceMs,
    startedAt: nowIso(),
  });
  if (cancelledRuns.has(input.runId)) {
    cancelActiveRun(input.runId, { graceMs: input.cancelGraceMs });
  }
}

export function getActiveRuntoolScope(runId: string) {
  const active = activeRuns.get(runId);
  if (!active) return null;
  return {
    competitorToolNames: active.competitorToolNames ? [...active.competitorToolNames] : undefined,
    personalDatatoolNames: active.personalDatatoolNames ? [...active.personalDatatoolNames] : undefined,
  };
}

export function unregisterActiveRun(runId: string) {
  const active = activeRuns.get(runId);
  if (active?.killEscalationTimer) {
    clearTimeout(active.killEscalationTimer);
    active.killEscalationTimer = undefined;
  }
  activeRuns.delete(runId);
}

export function clearRunCancellation(runId: string) {
  cancelledRuns.delete(runId);
}

export function cancelActiveRun(runId: string, options: { graceMs?: number } = {}) {
  const cancellationRequestedAt = cancelledRuns.get(runId) || nowIso();
  cancelledRuns.set(runId, cancellationRequestedAt);
  const active = activeRuns.get(runId);
  if (!active) {
    return { cancelled: false, runId, alreadyFinished: true, cancelledAt: cancellationRequestedAt };
  }
  const alreadyRequested = Boolean(active.cancelledAt);
  active.cancelledAt = active.cancelledAt || cancellationRequestedAt;
  let signalTarget: 'process_group' | 'child' | 'none' = 'none';
  let signalSent = false;
  let signalError: string | undefined;

  if (!active.sigtermSentAt) {
    const signalResult = signalActiveRun(active, 'SIGTERM');
    signalTarget = signalResult.target;
    signalSent = signalResult.sent;
    signalError = signalResult.error;
    active.sigtermSentAt = nowIso();
    active.lastSignal = 'SIGTERM';
  }

  const graceMs = normalizeCancelGraceMs(options.graceMs ?? active.cancelGraceMs);
  if (!active.killEscalationTimer) {
    active.killEscalationTimer = setTimeout(() => {
      const stillActive = activeRuns.get(runId);
      if (!stillActive || stillActive.sigkillSentAt) return;
      const killResult = signalActiveRun(stillActive, 'SIGKILL');
      stillActive.sigkillSentAt = nowIso();
      stillActive.lastSignal = 'SIGKILL';
      console.warn(
        [
          `[run-control] escalated cancellation run=${runId}`,
          'signal=SIGKILL',
          `target=${killResult.target}`,
          `sent=${killResult.sent}`,
          killResult.error ? `error=${killResult.error}` : '',
        ].filter(Boolean).join(' ')
      );
    }, graceMs);
    unrefTimer(active.killEscalationTimer);
  }
  return {
    cancelled: true,
    runId,
    userId: active.userId,
    threadId: active.threadId,
    startedAt: active.startedAt,
    cancelledAt: active.cancelledAt,
    alreadyRequested,
    signal: active.lastSignal || 'SIGTERM',
    signalSent,
    signalTarget,
    signalError,
    processGroupId: active.processGroupId || null,
    graceMs,
    sigtermSentAt: active.sigtermSentAt || null,
    sigkillSentAt: active.sigkillSentAt || null,
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
    sigtermSentAt: run.sigtermSentAt || null,
    sigkillSentAt: run.sigkillSentAt || null,
    lastSignal: run.lastSignal || null,
    processGroupId: run.processGroupId || null,
  }));
}

function normalizeCancelGraceMs(value: number | undefined) {
  return Math.min(Math.max(Math.floor(value || 5000), 1000), 30_000);
}

function signalActiveRun(active: ActiveRun, signal: 'SIGTERM' | 'SIGKILL') {
  if (active.processGroupId) {
    try {
      process.kill(-active.processGroupId, signal);
      return { sent: true, target: 'process_group' as const };
    } catch (error) {
      const groupError = error instanceof Error ? error.message : String(error);
      try {
        return { sent: active.child.kill(signal), target: 'child' as const, error: groupError };
      } catch (childError) {
        return {
          sent: false,
          target: 'process_group' as const,
          error: `${groupError}; child fallback failed: ${childError instanceof Error ? childError.message : String(childError)}`,
        };
      }
    }
  }
  try {
    return { sent: active.child.kill(signal), target: 'child' as const };
  } catch (error) {
    return {
      sent: false,
      target: 'child' as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function unrefTimer(timer: ReturnType<typeof setTimeout>) {
  if (typeof timer !== 'object' || timer === null) return;
  const maybeTimer = timer as { unref?: () => void };
  if (typeof maybeTimer.unref === 'function') maybeTimer.unref();
}
