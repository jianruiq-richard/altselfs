import { persistAgentRunEvent, persistAgentTurnCancelled, persistAgentTurnError, persistAgentTurnSuccess, touchAgentRunHeartbeat, } from './agent-context-store.js';
import { isAgentRunCancelledError } from './run-control.js';
export async function executePersistedTurn(agent, config, turnRequest, persisted, eventIndexStart = 0) {
    let runHeartbeat = null;
    let eventIndex = eventIndexStart;
    try {
        runHeartbeat = setInterval(() => {
            void touchAgentRunHeartbeat(config, {
                threadId: turnRequest.threadId || '',
                runId: persisted.runId,
            }).catch(() => null);
        }, 15_000);
        const result = await agent.startTurn({
            ...turnRequest,
            metadata: { ...(turnRequest.metadata || {}), runId: persisted.runId },
            onEvent: async (event) => {
                const index = eventIndex;
                eventIndex += 1;
                await persistAgentRunEvent(config, { runId: persisted.runId, event, index }).catch(() => null);
            },
        });
        await persistAgentTurnSuccess(config, persisted, {
            threadId: result.threadId,
            route: result.route,
            reply: result.reply,
            events: result.events,
            raw: 'raw' in result ? result.raw : undefined,
        });
    }
    catch (error) {
        if (isAgentRunCancelledError(error)) {
            await persistAgentTurnCancelled(config, {
                runId: persisted.runId,
                threadId: turnRequest.threadId,
                investorId: persisted.investorId,
                userId: turnRequest.userId,
                reason: 'cancelled by user',
            }).catch(() => null);
            return;
        }
        const detail = error instanceof Error ? error.message : String(error);
        await persistAgentTurnError(config, persisted, {
            threadId: turnRequest.threadId,
            error: detail,
        }).catch(() => null);
        console.warn(`[personal-agent-server] async turn failed run=${persisted.runId}: ${detail}`);
    }
    finally {
        if (runHeartbeat)
            clearInterval(runHeartbeat);
    }
}
