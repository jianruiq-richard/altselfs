import { buildMemoryContext } from './memory-store.js';
import { isRecord, truncate } from './util.js';
import type { ServerConfig } from './config.js';
import type { AgentProfile, MemorySnapshot, RouterDecision } from './types.js';

type RouterInput = {
  userId: string;
  threadId: string;
  message: string;
  memorySnapshot: MemorySnapshot;
  availableProfiles: AgentProfile[];
};

export class HermesRouter {
  constructor(private config: ServerConfig) {}

  async decide(input: RouterInput): Promise<RouterDecision> {
    if (!this.config.hermesRouterEnabled) return fallbackRouterDecision(input, 'router disabled');
    const apiKey = process.env[this.config.hermesOpenRouterApiKeyEnv]?.trim();
    if (!apiKey) return fallbackRouterDecision(input, `${this.config.hermesOpenRouterApiKeyEnv} is missing`);

    const routerPayload = buildRouterPayload(input);
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content: [
          'You are the Hermes main-agent router for Altselfs.',
          'Your job is only to choose whether the main agent should answer directly or delegate this turn to one registered agent profile.',
          'Use the agent profiles exactly as provided. Do not invent agent ids.',
          'Return only valid JSON with this shape:',
          '{"route":"main"|"agent","agentProfileId":string|null,"reason":string,"confidence":number,"needsClarification":boolean,"clarificationQuestion":string|null}',
          'confidence must be a number from 0 to 1. Never return a negative confidence.',
          'Hermes main is intentionally small. Choose main only for lightweight conversation continuity, explicit memory writes, user preference updates, user profile maintenance, or brief clarification.',
          'Delegate to the most specific available Codex profile for research, web/current information, planning, analysis, recommendations, summarization, tool use, sub-agent orchestration, and non-trivial answers.',
          'Choose codex-competitive-intelligence when the user asks about competitors, competitive landscape, user/traffic/revenue estimates, growth rate, acquisition channels, SEO, PPC, keywords, backlinks, Semrush, Similarweb, market share, or growth intelligence.',
          'Choose codex-general for general research, discussion, planning, synthesis, current information, and tool use when no more specific available profile fits.',
          'Hermes main must not directly use search, channel agents, business tools, or execution tools. Those capabilities live under Codex child profiles.',
          'When delegating, choose exactly one id from availableAgentProfiles.',
          'If a capability is not represented by an available profile, choose main and explain the limitation.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify(routerPayload),
      },
    ];

    const raw = await this.callOpenRouter(messages, apiKey);
    const parsed = parseRouterJson(raw.content);
    if (!parsed) {
      return {
        ...fallbackRouterDecision(input, 'router returned non-JSON or invalid schema'),
        raw: {
          request: routerPayload,
          response: raw,
        },
      };
    }

    const normalized = normalizeRouterDecision(parsed, input.availableProfiles);
    return {
      ...normalized,
      raw: {
        request: routerPayload,
        response: raw,
      },
    };
  }

  private async callOpenRouter(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    apiKey: string
  ): Promise<{ content: string; rawCompletion: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(`${this.config.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'x-openrouter-title': this.config.openRouterAppTitle,
        },
        body: JSON.stringify({
          model: this.config.hermesModel,
          messages,
          temperature: 0,
          max_tokens: 800,
        }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`OpenRouter router failed ${response.status}: ${truncate(text, 2000)}`);
      const rawCompletion = JSON.parse(text) as unknown;
      const content = extractContent(rawCompletion);
      return { content, rawCompletion };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildRouterPayload(input: RouterInput) {
  return {
    userId: input.userId,
    threadId: input.threadId,
    userMessage: input.message,
    memoryContext: buildMemoryContext(input.memorySnapshot),
    availableAgentProfiles: input.availableProfiles.map((profile) => ({
      id: profile.id,
      runtimeId: profile.runtimeId,
      name: profile.name,
      description: profile.description,
      capabilities: profile.capabilities,
      whenToUse: profile.whenToUse,
      whenNotToUse: profile.whenNotToUse,
      tools: profile.tools,
      riskLevel: profile.riskLevel,
      requiresWorkspace: profile.requiresWorkspace,
      requiresApprovalFor: profile.requiresApprovalFor,
    })),
  };
}

function normalizeRouterDecision(value: Record<string, unknown>, profiles: AgentProfile[]): RouterDecision {
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const route = value.route === 'agent' ? 'agent' : 'main';
  const agentProfileId = typeof value.agentProfileId === 'string' ? value.agentProfileId : undefined;
  if (route === 'agent' && agentProfileId && profileIds.has(agentProfileId)) {
    const profile = profiles.find((item) => item.id === agentProfileId);
    return {
      route: 'agent',
      agentProfileId,
      runtimeId: profile?.runtimeId,
      reason: readString(value.reason, 'Router selected a child agent.'),
      confidence: readConfidence(value.confidence),
      needsClarification: value.needsClarification === true,
      clarificationQuestion: typeof value.clarificationQuestion === 'string' ? value.clarificationQuestion : undefined,
    };
  }
  return {
    route: 'main',
    reason: readString(value.reason, 'Router selected main agent.'),
    confidence: readConfidence(value.confidence),
    needsClarification: value.needsClarification === true,
    clarificationQuestion: typeof value.clarificationQuestion === 'string' ? value.clarificationQuestion : undefined,
  };
}

function fallbackRouterDecision(input: RouterInput, reason: string): RouterDecision {
  const message = input.message;
  const engineering = /instruction|instruction|instruction|instruction|git|instruction|instruction|instruction|shell|build|lint|instruction|canvas|API|instruction|Prisma|Next/i.test(message);
  if (engineering && input.availableProfiles.some((profile) => profile.id === 'codex-engineering')) {
    return {
      route: 'agent',
      agentProfileId: 'codex-engineering',
      runtimeId: 'codex',
      reason: `Fallback selected codex-engineering: ${reason}`,
      confidence: 0.55,
    };
  }
  const competitive = /instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|ARR|instruction|instruction|instruction|SEO|PPC|instruction|instruction|backlink|instruction|instruction|instruction|instruction|semrush|similarweb|competitor|competitive|acquisition|growth|revenue|traffic/i.test(message);
  if (competitive && input.availableProfiles.some((profile) => profile.id === 'codex-competitive-intelligence')) {
    return {
      route: 'agent',
      agentProfileId: 'codex-competitive-intelligence',
      runtimeId: 'codex',
      reason: `Fallback selected codex-competitive-intelligence: ${reason}`,
      confidence: 0.58,
    };
  }
  const general = /instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|instruction|Today|instruction|instruction|instruction|instruction/i.test(message);
  if (general && input.availableProfiles.some((profile) => profile.id === 'codex-general')) {
    return {
      route: 'agent',
      agentProfileId: 'codex-general',
      runtimeId: 'codex',
      reason: `Fallback selected codex-general: ${reason}`,
      confidence: 0.5,
    };
  }
  return {
    route: 'main',
    reason: `Fallback selected main: ${reason}`,
    confidence: 0.45,
  };
}

function parseRouterJson(content: string) {
  const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function extractContent(rawCompletion: unknown) {
  if (!isRecord(rawCompletion)) return '';
  const choices = rawCompletion.choices;
  if (!Array.isArray(choices)) return '';
  const first = choices[0];
  if (!isRecord(first)) return '';
  const message = first.message;
  if (!isRecord(message)) return '';
  return typeof message.content === 'string' ? message.content : '';
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readConfidence(value: unknown) {
  let number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return 0.5;
  if (number < 0 && number >= -1) number = Math.abs(number);
  return Math.max(0, Math.min(1, number));
}
