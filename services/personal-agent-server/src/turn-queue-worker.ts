import type { ServerConfig } from './config.js';
import type { PersonalMainAgent } from './main-agent.js';
import {
  claimNextQueuedAgentTurn,
  expireStaleAgentTurns,
  listRequestedAgentRunCancellations,
  processAgentBillingOutbox,
  persistAgentRunEvent,
  persistAgentTurnTimeout,
} from './agent-context-store.js';
import { cancelActiveRun, clearRunCancellation } from './run-control.js';
import { executePersistedTurn } from './turn-executor.js';
import { id, nowIso } from './util.js';
import type { AgentEvent } from './types.js';

type RunningTurn = {
  runId: string;
  threadId: string;
  startedAt: string;
};

export class AgentTurnQueueWorker {
  private readonly workerId = `${process.env.HOSTNAME || 'worker'}-${process.pid}-${id('tw')}`;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cancelTimer: ReturnType<typeof setInterval> | null = null;
  private running = new Map<string, RunningTurn>();
  private draining = false;
  private ticking = false;
  private pollingCancellations = false;

  constructor(
    private agent: PersonalMainAgent,
    private config: ServerConfig
  ) {}

  start() {
    if (!this.config.contextDatabaseUrl) {
      console.warn('[agent-turn-worker] disabled: AGENT_CONTEXT_DATABASE_URL is not configured');
      return;
    }
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.turnQueuePollMs);
    this.cancelTimer = setInterval(() => {
      void this.pollCancellationRequests();
    }, this.config.turnQueueCancelPollMs);
    void this.tick();
    console.log(
      [
        `[agent-turn-worker] started workerId=${this.workerId}`,
        `pollMs=${this.config.turnQueuePollMs}`,
        `cancelPollMs=${this.config.turnQueueCancelPollMs}`,
        `max=${this.config.turnQueueMaxConcurrency}`,
        `perUser=${this.config.turnQueueMaxPerUser}`,
        `perThread=${this.config.turnQueueMaxPerThread}`,
        `openai=${this.config.turnQueueMaxOpenAi}`,
        `openrouter=${this.config.turnQueueMaxOpenRouter}`,
      ].join(' ')
    );
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.cancelTimer) clearInterval(this.cancelTimer);
    this.timer = null;
    this.cancelTimer = null;
    this.draining = true;
  }

  private async tick() {
    if (this.draining || this.ticking) return;
    this.ticking = true;
    try {
      await expireStaleAgentTurns(this.config, {
        staleHeartbeatMs: this.config.turnQueueStaleHeartbeatMs,
      }).catch((error) => {
        console.warn(`[agent-turn-worker] stale run expiry failed: ${error instanceof Error ? error.message : String(error)}`);
        return 0;
      });

      await processAgentBillingOutbox(this.config, {
        workerId: this.workerId,
        limit: 20,
      }).catch((error) => {
        console.warn(`[agent-turn-worker] billing reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
      });

      while (!this.draining && this.running.size < this.config.turnQueueMaxConcurrency) {
        const claimed = await claimNextQueuedAgentTurn(this.config, {
          workerId: this.workerId,
          timeoutMs: this.config.turnQueueRunTimeoutMs,
          limits: {
            maxConcurrency: this.config.turnQueueMaxConcurrency,
            maxPerUser: this.config.turnQueueMaxPerUser,
            maxPerThread: this.config.turnQueueMaxPerThread,
            maxOpenAi: this.config.turnQueueMaxOpenAi,
            maxOpenRouter: this.config.turnQueueMaxOpenRouter,
          },
        }).catch(async (error) => {
          console.warn(`[agent-turn-worker] claim failed: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        });

        if (!claimed) return;

        this.running.set(claimed.persisted.runId, {
          runId: claimed.persisted.runId,
          threadId: claimed.request.threadId || '',
          startedAt: nowIso(),
        });
        void this.executeClaimedTurn(claimed).finally(() => {
          this.running.delete(claimed.persisted.runId);
          clearRunCancellation(claimed.persisted.runId);
        });
      }
    } finally {
      this.ticking = false;
    }
  }

  private async pollCancellationRequests() {
    if (this.draining || this.pollingCancellations || this.running.size === 0) return;
    this.pollingCancellations = true;
    try {
      const requestedRunIds = await listRequestedAgentRunCancellations(
        this.config,
        Array.from(this.running.keys()),
      );
      for (const runId of requestedRunIds) {
        const result = cancelActiveRun(runId);
        if (result.cancelled) {
          console.log(`[agent-turn-worker] cancellation delivered run=${runId} workerId=${this.workerId}`);
        }
      }
    } catch (error) {
      console.warn(`[agent-turn-worker] cancellation poll failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.pollingCancellations = false;
    }
  }

  private async executeClaimedTurn(claimed: Awaited<ReturnType<typeof claimNextQueuedAgentTurn>>) {
    if (!claimed) return;
    const runId = claimed.persisted.runId;
    const timeoutMs = this.config.turnQueueRunTimeoutMs;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      cancelActiveRun(runId);
      void persistAgentRunEvent(this.config, {
        runId,
        event: queueEvent('agent_context.queue_timeout_requested', {
          runId,
          timeoutMs,
          workerId: this.workerId,
        }),
      }).catch(() => null);
    }, timeoutMs);

    try {
      await persistAgentRunEvent(this.config, {
        runId,
        index: 1,
        event: queueEvent('agent_context.queue_claimed', {
          runId,
          workerId: this.workerId,
          attemptCount: claimed.attemptCount,
          model: claimed.model || null,
          modelProvider: claimed.modelProvider || null,
        }),
      }).catch(() => null);

      await executePersistedTurn(
        this.agent,
        this.config,
        claimed.request,
        claimed.persisted,
        timedOut ? 3 : claimed.eventIndexStart
      );

      if (timedOut) {
        await persistAgentTurnTimeout(this.config, {
          runId,
          threadId: claimed.request.threadId,
          reason: `agent run exceeded ${timeoutMs}ms`,
        }).catch(() => null);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

function queueEvent(type: string, payload: Record<string, unknown>): AgentEvent {
  return {
    type,
    timestamp: nowIso(),
    payload,
  };
}
