import { AgentRegistry } from './agent-registry.js';
import { buildMemoryContext, inferExplicitMemoryWrite, type MemoryStore } from './memory-store.js';
import { id, nowIso } from './util.js';
import type { AgentRoute, TurnStartRequest, TurnStartResponse, AgentEvent, ChildAgentRunInput, RouterDecision, SourceAgentRuntime } from './types.js';
import type { HermesRouter } from './hermes-router.js';

export class PersonalMainAgent {
  constructor(
    private registry: AgentRegistry,
    private memoryStore: MemoryStore,
    private router: HermesRouter,
    private sourceRuntime?: SourceAgentRuntime
  ) {}

  async startTurn(request: TurnStartRequest): Promise<TurnStartResponse> {
    validateTurnRequest(request);
    const threadId = request.threadId || id('thr');

    const memorySnapshot = await this.memoryStore.getSnapshot(request.userId);
    const events: AgentEvent[] = [];
    const emit = async (event: AgentEvent) => {
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

    if (this.sourceRuntime) {
      const selectedProfile = effectiveDecision.agentProfileId
        ? availableProfiles.find((profile) => profile.id === effectiveDecision.agentProfileId)
        : undefined;
      await emit({
        type: 'main.route.selected',
        timestamp: nowIso(),
        payload: {
          route: selectedProfile?.runtimeId || 'main',
          agentProfileId: effectiveDecision.agentProfileId,
          runtimeId: effectiveDecision.runtimeId,
          reason: effectiveDecision.reason,
          confidence: effectiveDecision.confidence,
          sourceRuntime: true,
          availableAgents: this.registry.list(),
        },
      });
      const result = await this.sourceRuntime.run({
        ...request,
        threadId,
        metadata: {
          ...(request.metadata || {}),
          selectedAgentProfileId: effectiveDecision.agentProfileId || null,
          selectedAgentRuntimeId: effectiveDecision.runtimeId || null,
          selectedAgentProfile: selectedProfile || null,
          routerDecision: effectiveDecision,
        },
        onEvent: emit,
      });
      return {
        threadId,
        route: result.route,
        reply: result.reply,
        events,
        raw: result.raw,
        memoryWrites,
      };
    }

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
      const childInput: ChildAgentRunInput = {
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

  private selectRoute(decision: RouterDecision): AgentRoute {
    if (decision.route !== 'agent' || !decision.agentProfileId) return 'main';
    const profile = this.registry.getProfile(decision.agentProfileId);
    if (!profile) return 'main';
    return this.registry.get(profile.runtimeId) ? (profile.runtimeId as AgentRoute) : 'main';
  }
}

function readCurrentUserMessage(request: TurnStartRequest) {
  const value = request.metadata?.currentUserMessage;
  return typeof value === 'string' && value.trim() ? value.trim() : request.message;
}

function enforceHermesBoundary(
  decision: RouterDecision,
  message: string,
  availableProfiles: ReturnType<AgentRegistry['listAvailableProfiles']>
): RouterDecision {
  if (decision.route === 'agent') return decision;
  if (isHermesMainOnlyMessage(message)) return decision;
  const defaultProfile = selectBoundaryOverrideProfile(message, availableProfiles);
  if (!defaultProfile) return decision;
  return {
    route: 'agent',
    agentProfileId: defaultProfile.id,
    runtimeId: defaultProfile.runtimeId,
    reason: `Hermes boundary override: non-memory/non-profile work is delegated to ${defaultProfile.id}. Original router reason: ${decision.reason}`,
    confidence: Math.max(decision.confidence, 0.75),
  };
}

function selectBoundaryOverrideProfile(
  message: string,
  availableProfiles: ReturnType<AgentRegistry['listAvailableProfiles']>
) {
  if (isCompetitiveIntelligenceMessage(message)) {
    const competitive = availableProfiles.find((profile) => profile.id === 'codex-competitive-intelligence');
    if (competitive) return competitive;
  }
  return availableProfiles.find((profile) => profile.id === 'codex-general');
}

function isHermesMainOnlyMessage(message: string) {
  if (inferExplicitMemoryWrite(message)) return true;
  if (/^(你好|hi|hello|嗨|在吗|谢谢|多谢|好的|ok|收到)[。！？!,.，\s]*$/i.test(message.trim())) return true;
  if (/偏好|画像|用户画像|记忆|记住|以后记得|请记住|称呼我/.test(message)) return true;
  return false;
}

function isCompetitiveIntelligenceMessage(message: string) {
  return /竞品|竞争对手|竞争格局|增长|获客|用户量|访问量|营收|ARR|收入|增速|市场份额|SEO|PPC|关键词|外链|backlink|流量|渠道|投放|广告|semrush|similarweb|competitor|competitive|acquisition|growth|revenue|traffic/i.test(message);
}

function buildMainAgentReply(params: {
  message: string;
  memorySnapshotText: string;
  memoryWrites: unknown[];
  decision: RouterDecision;
}) {
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

function validateTurnRequest(request: TurnStartRequest) {
  if (!request || typeof request !== 'object') throw new Error('request body must be an object');
  if (typeof request.userId !== 'string' || !request.userId.trim()) throw new Error('userId is required');
  if (typeof request.message !== 'string' || !request.message.trim()) throw new Error('message is required');
}

async function emitRouterDecision(
  decision: RouterDecision,
  emit: (event: AgentEvent) => Promise<void>
) {
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
      payload: decision.raw as Record<string, unknown>,
    });
  }
}

function expandAllowedProfiles(allowedAgents?: string[]) {
  if (!allowedAgents?.length) return undefined;
  const expanded = new Set<string>();
  for (const id of allowedAgents) {
    expanded.add(id);
    if (id === 'codex') {
      expanded.add('codex-general');
      expanded.add('codex-competitive-intelligence');
      expanded.add('codex-engineering');
    }
  }
  return Array.from(expanded);
}
