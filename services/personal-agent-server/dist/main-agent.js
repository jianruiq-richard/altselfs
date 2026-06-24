import { buildMemoryContext, inferExplicitMemoryWrite } from './memory-store.js';
import { id, nowIso } from './util.js';
export class PersonalMainAgent {
    registry;
    memoryStore;
    router;
    sourceRuntime;
    constructor(registry, memoryStore, router, sourceRuntime) {
        this.registry = registry;
        this.memoryStore = memoryStore;
        this.router = router;
        this.sourceRuntime = sourceRuntime;
    }
    async startTurn(request) {
        validateTurnRequest(request);
        const threadId = request.threadId || id('thr');
        if (this.sourceRuntime) {
            const result = await this.sourceRuntime.run({ ...request, threadId });
            return {
                threadId,
                route: result.route,
                reply: result.reply,
                events: result.events,
                raw: result.raw,
            };
        }
        const memorySnapshot = await this.memoryStore.getSnapshot(request.userId);
        const events = [];
        const emit = async (event) => {
            events.push(event);
            await request.onEvent?.(event);
        };
        const currentUserMessage = readCurrentUserMessage(request);
        const explicitMemory = inferExplicitMemoryWrite(currentUserMessage);
        const memoryWrites = [];
        if (explicitMemory) {
            const entry = await this.memoryStore.suggestWrite(request.userId, explicitMemory);
            memoryWrites.push(explicitMemory);
            await emit({
                type: 'memory.suggested',
                timestamp: nowIso(),
                payload: { entry },
            });
        }
        const availableProfiles = this.registry.listAvailableProfiles(expandAllowedProfiles(request.allowedAgents));
        await emit({
            type: 'main.agent_profiles.loaded',
            timestamp: nowIso(),
            payload: {
                profiles: availableProfiles.map((profile) => ({
                    id: profile.id,
                    runtimeId: profile.runtimeId,
                    name: profile.name,
                    capabilities: profile.capabilities,
                    riskLevel: profile.riskLevel,
                    requiresWorkspace: profile.requiresWorkspace,
                })),
            },
        });
        const routerDecision = await this.router.decide({
            userId: request.userId,
            threadId,
            message: currentUserMessage,
            memorySnapshot,
            availableProfiles,
        });
        const effectiveDecision = enforceHermesBoundary(routerDecision, currentUserMessage, availableProfiles);
        await emitRouterDecision(effectiveDecision, emit);
        const route = this.selectRoute(effectiveDecision);
        await emit({
            type: 'main.route.selected',
            timestamp: nowIso(),
            payload: {
                route,
                agentProfileId: effectiveDecision.agentProfileId,
                runtimeId: effectiveDecision.runtimeId,
                reason: effectiveDecision.reason,
                confidence: effectiveDecision.confidence,
                availableAgents: this.registry.list(),
            },
        });
        if (route === 'codex') {
            const codex = this.registry.get('codex');
            if (!codex) {
                return {
                    threadId,
                    route: 'unsupported',
                    reply: 'Codex 子 Agent 尚未注册。',
                    events,
                    memoryWrites,
                };
            }
            const childInput = {
                userId: request.userId,
                threadId,
                message: request.message,
                profileId: effectiveDecision.agentProfileId,
                memorySnapshot,
                metadata: request.metadata,
                onEvent: emit,
            };
            const result = await codex.run(childInput);
            return {
                threadId,
                route: result.route,
                reply: result.reply,
                events,
                raw: result.raw,
                memoryWrites,
            };
        }
        const reply = buildMainAgentReply({
            message: currentUserMessage,
            memorySnapshotText: buildMemoryContext(memorySnapshot),
            memoryWrites,
            decision: effectiveDecision,
        });
        return {
            threadId,
            route: 'main',
            reply,
            events,
            memoryWrites,
        };
    }
    selectRoute(decision) {
        if (decision.route !== 'agent' || !decision.agentProfileId)
            return 'main';
        const profile = this.registry.getProfile(decision.agentProfileId);
        if (!profile)
            return 'main';
        return this.registry.get(profile.runtimeId) ? profile.runtimeId : 'main';
    }
}
function readCurrentUserMessage(request) {
    const value = request.metadata?.currentUserMessage;
    return typeof value === 'string' && value.trim() ? value.trim() : request.message;
}
function enforceHermesBoundary(decision, message, availableProfiles) {
    if (decision.route === 'agent')
        return decision;
    if (isHermesMainOnlyMessage(message))
        return decision;
    const codexGeneral = availableProfiles.find((profile) => profile.id === 'codex-general');
    if (!codexGeneral)
        return decision;
    return {
        route: 'agent',
        agentProfileId: 'codex-general',
        runtimeId: codexGeneral.runtimeId,
        reason: `Hermes boundary override: non-memory/non-profile work is delegated to codex-general. Original router reason: ${decision.reason}`,
        confidence: Math.max(decision.confidence, 0.75),
    };
}
function isHermesMainOnlyMessage(message) {
    if (inferExplicitMemoryWrite(message))
        return true;
    if (/^(你好|hi|hello|嗨|在吗|谢谢|多谢|好的|ok|收到)[。！？!,.，\s]*$/i.test(message.trim()))
        return true;
    if (/偏好|画像|用户画像|记忆|记住|以后记得|请记住|称呼我/.test(message))
        return true;
    return false;
}
function buildMainAgentReply(params) {
    if (params.decision.needsClarification && params.decision.clarificationQuestion) {
        return params.decision.clarificationQuestion;
    }
    if (params.memoryWrites.length > 0) {
        return '我记住了。后续对话里我会把这条信息作为你的长期偏好或用户画像上下文来使用。';
    }
    if (/记忆|偏好|画像|用户画像/.test(params.message)) {
        return [
            '这是我当前能读取到的长期记忆和用户画像：',
            '',
            params.memorySnapshotText,
        ].join('\n');
    }
    return '我在。你可以直接告诉我你的问题、想法或要我记住的偏好；需要搜索、分析、计划或调用工具时，我会交给 codex-general 处理。';
}
function validateTurnRequest(request) {
    if (!request || typeof request !== 'object')
        throw new Error('request body must be an object');
    if (typeof request.userId !== 'string' || !request.userId.trim())
        throw new Error('userId is required');
    if (typeof request.message !== 'string' || !request.message.trim())
        throw new Error('message is required');
}
async function emitRouterDecision(decision, emit) {
    await emit({
        type: 'main.router.decision',
        timestamp: nowIso(),
        payload: {
            route: decision.route,
            agentProfileId: decision.agentProfileId,
            runtimeId: decision.runtimeId,
            reason: decision.reason,
            confidence: decision.confidence,
            needsClarification: decision.needsClarification || false,
            clarificationQuestion: decision.clarificationQuestion,
        },
    });
    if (decision.raw && typeof decision.raw === 'object') {
        await emit({
            type: 'main.router.raw',
            timestamp: nowIso(),
            payload: decision.raw,
        });
    }
}
function expandAllowedProfiles(allowedAgents) {
    if (!allowedAgents?.length)
        return undefined;
    const expanded = new Set();
    for (const id of allowedAgents) {
        expanded.add(id);
        if (id === 'codex') {
            expanded.add('codex-general');
            expanded.add('codex-engineering');
        }
    }
    return Array.from(expanded);
}
