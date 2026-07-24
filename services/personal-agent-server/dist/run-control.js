import { nowIso } from './util.js';
export class AgentRunCancelledError extends Error {
    runId;
    constructor(runId) {
        super(`Agent run cancelled: ${runId}`);
        this.runId = runId;
        this.name = 'AgentRunCancelledError';
    }
}
const activeRuns = new Map();
const cancelledRuns = new Map();
export function registerActiveRun(input) {
    activeRuns.set(input.runId, {
        ...input,
        competitorToolNames: input.competitorToolNames ? [...input.competitorToolNames] : undefined,
        personalDatatoolNames: input.personalDatatoolNames ? [...input.personalDatatoolNames] : undefined,
        startedAt: nowIso(),
    });
    if (cancelledRuns.has(input.runId)) {
        try {
            input.child.kill('SIGTERM');
        }
        catch {
            // The process may have already exited.
        }
    }
}
export function getActiveRuntoolScope(runId) {
    const active = activeRuns.get(runId);
    if (!active)
        return null;
    return {
        competitorToolNames: active.competitorToolNames ? [...active.competitorToolNames] : undefined,
        personalDatatoolNames: active.personalDatatoolNames ? [...active.personalDatatoolNames] : undefined,
    };
}
export function unregisterActiveRun(runId) {
    activeRuns.delete(runId);
}
export function clearRunCancellation(runId) {
    cancelledRuns.delete(runId);
}
export function cancelActiveRun(runId) {
    const now = nowIso();
    cancelledRuns.set(runId, now);
    const active = activeRuns.get(runId);
    if (!active) {
        return { cancelled: false, runId, alreadyFinished: true, cancelledAt: now };
    }
    active.cancelledAt = now;
    try {
        active.child.kill('SIGTERM');
    }
    catch {
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
export function isRunCancelled(runId) {
    return cancelledRuns.has(runId);
}
export function getRunCancelledAt(runId) {
    return cancelledRuns.get(runId) || null;
}
export function createRunCancelledError(runId) {
    return new AgentRunCancelledError(runId);
}
export function isAgentRunCancelledError(error) {
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
