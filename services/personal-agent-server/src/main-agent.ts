import { AgentRegistry } from './agent-registry.js';
import { buildMemoryContext, type MemoryStore } from './memory-store.js';
import { id, nowIso } from './util.js';
import type { AgentRoute, TurnStartRequest, TurnStartResponse, AgentEvent, ChildAgentRunInput, RouterDecision, SourceAgentRuntime, MemoryWriteSuggestion } from './types.js';
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
    const memoryWrites: MemoryWriteSuggestion[] = [];

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
    const effectiveDecision = this.sourceRuntime
      ? routerDecision
      : enforceHermesBoundary(routerDecision, currentUserMessage, availableProfiles);
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
          reply: 'Codex Agent is not configured. Please sign in or contact your workspace administrator.',
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
  if (/^(instruction|hi|hello|instruction|instruction|instruction|instruction|instruction|ok|instruction)[.!?!,., \s]*$/i.test(message.trim())) return true;
  if (/instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction/.test(message)) return true;
  return false;
}

function isCompetitiveIntelligenceMessage(message: string) {
  return /instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|ARR|instruction|instruction|instruction|SEO|PPC|instruction|instruction|backlink|instruction|instruction|instruction|instruction|semrush|similarweb|competitor|competitive|acquisition|growth|revenue|traffic/i.test(message);
}

function buildMainAgentReply(params: {
  message: string;
  memorySnapshotText: string;
  memoryWrites: MemoryWriteSuggestion[];
  decision: RouterDecision;
}) {
  if (params.decision.needsClarification && params.decision.clarificationQuestion) {
    return params.decision.clarificationQuestion;
  }

  if (params.memoryWrites.length > 0) {
    return 'Got it. I will use this as long-term preference or profile context in future conversations.';
  }

  if (/instruction|instruction|instruction|instruction/.test(params.message)) {
    return [
      'Here is the long-term memory and user profile context I can currently access:',
      '',
      params.memorySnapshotText,
    ].join('\n');
  }

  return 'I am here. Tell me your question, idea, or preference to remember; when search, analysis, planning, or tool use is needed, I will delegate it to codex-general.';
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
