import { claimNextQueuedAgentTurn, expireStaleAgentTurns, persistAgentRunEvent, persistAgentTurnTimeout, } from './agent-context-store.js';
import { cancelActiveRun } from './run-control.js';
import { executePersistedTurn } from './turn-executor.js';
import { id, nowIso } from './util.js';
export class AgentTurnQueueWorker {
    agent;
    config;
    workerId = `${process.env.HOSTNAME || 'worker'}-${process.pid}-${id('tw')}`;
    timer = null;
    running = new Map();
    draining = false;
    constructor(agent, config) {
        this.agent = agent;
        this.config = config;
    }
    start() {
        if (!this.config.contextDatabaseUrl) {
            console.warn('[agent-turn-worker] disabled: AGENT_CONTEXT_DATABASE_URL is not configured');
            return;
        }
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            void this.tick();
        }, this.config.turnQueuePollMs);
        void this.tick();
        console.log([
            `[agent-turn-worker] started workerId=${this.workerId}`,
            `pollMs=${this.config.turnQueuePollMs}`,
            `max=${this.config.turnQueueMaxConcurrency}`,
            `perUser=${this.config.turnQueueMaxPerUser}`,
            `perThread=${this.config.turnQueueMaxPerThread}`,
            `openai=${this.config.turnQueueMaxOpenAi}`,
            `openrouter=${this.config.turnQueueMaxOpenRouter}`,
        ].join(' '));
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        this.draining = true;
    }
    async tick() {
        if (this.draining)
            return;
        await expireStaleAgentTurns(this.config, {
            staleHeartbeatMs: this.config.turnQueueStaleHeartbeatMs,
        }).catch((error) => {
            console.warn(`[agent-turn-worker] stale run expiry failed: ${error instanceof Error ? error.message : String(error)}`);
            return 0;
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
            if (!claimed)
                return;
            this.running.set(claimed.persisted.runId, {
                runId: claimed.persisted.runId,
                threadId: claimed.request.threadId || '',
                startedAt: nowIso(),
            });
            void this.executeClaimedTurn(claimed).finally(() => {
                this.running.delete(claimed.persisted.runId);
            });
        }
    }
    async executeClaimedTurn(claimed) {
        if (!claimed)
            return;
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
            await executePersistedTurn(this.agent, this.config, claimed.request, claimed.persisted, timedOut ? 3 : claimed.eventIndexStart);
            if (timedOut) {
                await persistAgentTurnTimeout(this.config, {
                    runId,
                    threadId: claimed.request.threadId,
                    reason: `agent run exceeded ${timeoutMs}ms`,
                }).catch(() => null);
            }
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
function queueEvent(type, payload) {
    return {
        type,
        timestamp: nowIso(),
        payload,
    };
}
