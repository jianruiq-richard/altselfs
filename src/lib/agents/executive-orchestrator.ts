import { prisma } from '@/lib/prisma';
import { createChatCompletion, createJsonChatCompletion, getOpenRouterModel, type ChatMessage } from '@/lib/openrouter';
import { runWechatAgent } from '@/lib/agents/wechat-agent';
import { runWebSearchAgent } from '@/lib/agents/web-search-agent';
import type { AgentBriefingItem, AgentRunResult, AgentRuntoolCall, AgentTaskSpec } from '@/lib/agents/types';
import { buildExecutiveDailyBriefing, type ExecutiveDailyBriefing } from '@/lib/executive-office';
import { resolveHiredTeamKeys } from '@/lib/team-library';

export type ExecutivePlannerStepStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'ERROR' | 'SKIPPED';

export type ExecutivePlannerStepId = string;

export type ExecutiveSkillId =
  | 'web_search'
  | 'wechat_articles'
  | 'xiaohongshu_insights'
  | 'gmail_insights'
  | 'feishu_insights'
  | 'internal_briefing'
  | 'persist_briefing'
  | 'chat_reply';

export type ExecutivePlannerStepDefinition = {
  id: ExecutivePlannerStepId;
  title: string;
  description: string;
  agentType?: string;
  skillId?: ExecutiveSkillId;
};

export type ExecutivePlannerTraceItem = ExecutivePlannerStepDefinition & {
  status: ExecutivePlannerStepStatus;
  detail?: string;
  error?: string;
  timestamp: string;
  payload?: unknown;
};

export type ExecutivePlannerEvent =
  | {
      type: 'planner';
      steps: ExecutivePlannerStepDefinition[];
      plan?: ExecutiveTurnPlan;
    }
  | {
      type: 'step';
      step: ExecutivePlannerTraceItem;
    };

export type ExecutivePlannerEmit = (event: ExecutivePlannerEvent) => void | Promise<void>;

export type ExecutiveTurnPlan = {
  objective: string;
  updateBriefing: boolean;
  useWebSearch: boolean;
  skills: ExecutiveSkillId[];
  skillDecisions: ExecutiveSkillDecision[];
  steps: ExecutivePlannerStepDefinition[];
  wechatTaskSpec?: AgentTaskSpec;
  plannerSource: 'MODEL' | 'FALLBACK';
  plannerError?: string;
};

export type ExecutiveSkillDecision = {
  skillId: ExecutiveSkillId;
  name: string;
  available: boolean;
  selected: boolean;
  reason: string;
};

export type ExecutiveBriefingDocument = {
  dateKey: string;
  title: string;
  summary: string;
  sections: Array<{
    title: string;
    content: string;
    items?: AgentBriefingItem[];
  }>;
  sources: AgentBriefingItem[];
  calledAgents: Array<{
    agentType: string;
    status: 'SUCCESS' | 'ERROR' | 'SKIPPED';
    reason?: string;
  }>;
};

type StructuredBriefingItem = {
  title: string;
  summary: string;
  source: string;
  url?: string;
  publishedAt?: string;
  whyItMatters?: string;
};

type StructuredBriefingModule = {
  title: 'Information Digest' | 'Today To-Dos' | 'Twin Recommendations';
  content: string;
  items: StructuredBriefingItem[];
};

type StructuredBriefingModuleKey = 'informationSummary' | 'todayTodo' | 'twinRecommendation';

type StructuredBriefingModulePlan = {
  key: StructuredBriefingModuleKey;
  title: StructuredBriefingModule['title'];
};

type StructuredBriefingOutput = {
  title: string;
  summary: string;
  modules: StructuredBriefingModule[];
};

export type ExecutiveBriefingUpdateResult = {
  baseBriefing: ExecutiveDailyBriefing;
  briefing: ExecutiveDailyBriefing;
  document: ExecutiveBriefingDocument;
  subagentResults: AgentRunResult[];
  toolCalls: AgentRuntoolCall[];
};

type LoadedExecutiveContext = {
  baseBriefing: ExecutiveDailyBriefing;
  hiredTeamKeys: Set<string>;
  integrationProviders: Set<string>;
  hasWechatSources: boolean;
  internalFacts: string[];
};

const STRUCTURED_AGENT_ITEM_LIMIT = 50;
const INFORMATION_SUMMARY_ITEM_LIMIT = 200;
const STRUCTURED_MODULE_PLANS: StructuredBriefingModulePlan[] = [
  { key: 'informationSummary', title: 'Information Digest' },
  { key: 'todayTodo', title: 'Today To-Dos' },
  { key: 'twinRecommendation', title: 'Twin Recommendations' },
];

const WEB_SEARCH_ASSISTANT_ENABLED = false;

const EXECUTIVE_PLANNER_SKILL_IDS: ExecutiveSkillId[] = [
  'wechat_articles',
  'xiaohongshu_insights',
  'gmail_insights',
  'feishu_insights',
  'internal_briefing',
  'persist_briefing',
  'chat_reply',
];

export const EXECUTIVE_PLANNER_JSON_SCHEMA = {
  name: 'executive_turn_plan',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      objective: {
        type: 'string',
        description: 'Execution objective for this turn, in one concise English sentence.',
      },
      updateBriefing: {
        type: 'boolean',
        description: 'Whether this turn should update and persist today briefing.',
      },
      useWebSearch: {
        type: 'boolean',
        enum: [false],
        description: 'Whether this turn should call the web search assistant. Currently disabled by default and must be false.',
      },
      skills: {
        type: 'array',
        description: 'Skill IDs that should be executed this turn or explicitly marked unavailable.',
        items: {
          type: 'string',
          enum: EXECUTIVE_PLANNER_SKILL_IDS,
        },
      },
      skillDecisions: {
        type: 'array',
        description: 'Selection or skip decision for each candidate skill. Must cover every skillId in availableSkills.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            skillId: {
              type: 'string',
              enum: EXECUTIVE_PLANNER_SKILL_IDS,
            },
            available: {
              type: 'boolean',
              description: 'Whether this skill is available for the current account and implementation.',
            },
            selected: {
              type: 'boolean',
              description: 'Whether this skill is selected for this turn.',
            },
            reason: {
              type: 'string',
              description: 'Why this skill is or is not selected. If unavailable, explain whether it is not implemented, missing integration, or missing data source.',
            },
          },
          required: ['skillId', 'available', 'selected', 'reason'],
        },
      },
      wechatTaskSpec: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              objective: {
                type: 'string',
                description: 'Information objective for the WeChat Official Accounts assistant this turn.',
              },
              sourceSelectionCriteria: {
                type: 'array',
                items: { type: 'string' },
                description: 'Topics, domains, keywords, or exclusions used to select official account profiles.',
              },
              returnFormat: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  sections: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  instructions: {
                    type: 'string',
                    description: 'Format instructions the WeChat agent must follow when returning results to the briefing assistant.',
                  },
                },
                required: ['sections', 'instructions'],
              },
            },
            required: ['objective', 'sourceSelectionCriteria', 'returnFormat'],
          },
          { type: 'null' },
        ],
      },
      steps: {
        type: 'array',
        description: 'Planner steps for this turn in execution order. Only include steps that will actually run or must be explicitly skipped.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: {
              type: 'string',
              description: 'Short snake_case step id. Prefer existing system step ids.',
            },
            title: {
              type: 'string',
              description: 'English step title.',
            },
            description: {
              type: 'string',
              description: 'Why this step is needed this turn.',
            },
            skillId: {
              anyOf: [
                { type: 'string', enum: EXECUTIVE_PLANNER_SKILL_IDS },
                { type: 'null' },
              ],
            },
            agentType: {
              anyOf: [
                { type: 'string' },
                { type: 'null' },
              ],
            },
          },
          required: ['id', 'title', 'description', 'skillId', 'agentType'],
        },
      },
    },
    required: ['objective', 'updateBriefing', 'useWebSearch', 'skills', 'skillDecisions', 'wechatTaskSpec', 'steps'],
  },
};

const EXECUTIVE_SKILL_REGISTRY: Array<{
  skillId: ExecutiveSkillId;
  name: string;
  description: string;
  implemented: boolean;
  agentType?: string;
}> = [
  {
    skillId: 'web_search',
    name: 'Web Search',
    description: 'Call the Web Search Assistant to retrieve public pages with OpenRouter native web_search / web_fetch tools and organize sources.',
    implemented: true,
    agentType: 'WEB_SEARCH',
  },
  {
    skillId: 'wechat_articles',
    name: 'WeChat Official Accounts Assistant',
    description: 'Call the hired WeChat Official Accounts AI teammate to read tracked account articles, bodies, and metrics.',
    implemented: true,
    agentType: 'WECHAT',
  },
  {
    skillId: 'xiaohongshu_insights',
    name: 'Xiaohongshu Assistant',
    description: 'Call the Xiaohongshu AI teammate to analyze content trends, competitor share of voice, and market signals.',
    implemented: false,
    agentType: 'XIAOHONGSHU',
  },
  {
    skillId: 'gmail_insights',
    name: 'Email Assistant',
    description: 'Call the email AI teammate to extract external communication, action items, and risk signals.',
    implemented: false,
    agentType: 'GMAIL',
  },
  {
    skillId: 'feishu_insights',
    name: 'Lark Assistant',
    description: 'Call the Lark AI teammate to extract internal project, team progress, and action items.',
    implemented: false,
    agentType: 'FEISHU',
  },
  {
    skillId: 'internal_briefing',
    name: 'Internal Data Summary',
    description: 'Read existing integrations, digital twins, hired teams, and baseline briefing context for the account.',
    implemented: true,
  },
  {
    skillId: 'persist_briefing',
    name: 'Briefing Persistence',
    description: 'Save the updated briefing to executive_briefings.',
    implemented: true,
  },
  {
    skillId: 'chat_reply',
    name: 'Executive Assistant Reply',
    description: "Generate the final user-facing reply from this turn's results.",
    implemented: true,
  },
];

export function getExecutivePlannerDefinition() {
  return [];
}

function getActiveExecutiveSkillRegistry() {
  return WEB_SEARCH_ASSISTANT_ENABLED
    ? EXECUTIVE_SKILL_REGISTRY
    : EXECUTIVE_SKILL_REGISTRY.filter((skill) => skill.skillId !== 'web_search');
}

export function getExecutiveSkillRegistry() {
  return getActiveExecutiveSkillRegistry();
}

async function emitPlannerStep(
  emit: ExecutivePlannerEmit | undefined,
  id: ExecutivePlannerStepId,
  status: ExecutivePlannerStepStatus,
  options: {
    detail?: string;
    error?: string;
    payload?: unknown;
  } = {}
) {
  if (!emit) return;
  const definition = getExecutivePlannerStepDefinition(id);
  await emit({
    type: 'step',
    step: {
      ...definition,
      status,
      detail: options.detail,
      error: options.error,
      payload: options.payload,
      timestamp: new Date().toISOString(),
    },
  });
}

export function getExecutivePlannerStepDefinition(id: ExecutivePlannerStepId): ExecutivePlannerStepDefinition {
  const known: Record<string, ExecutivePlannerStepDefinition> = {
    load_context: {
      id: 'load_context',
      title: 'Load Account Context',
      description: 'Read connected data sources, hired AI teammates, digital twins, and the baseline briefing.',
      skillId: 'internal_briefing',
    },
    plan_subagents: {
      id: 'plan_subagents',
      title: 'Plan This Turn',
      description: 'Let the executive assistant decide which skills and child agents this turn should call.',
    },
    call_web_search: {
      id: 'call_web_search',
      title: 'Call Web Search Assistant',
      description: 'Call the standalone Web Search agent to search and read pages with OpenRouter web_search / web_fetch.',
      skillId: 'web_search',
    },
    call_wechat_agent: {
      id: 'call_wechat_agent',
      title: 'Call WeChat Official Accounts Assistant',
      description: 'Read articles, bodies, and metrics from tracked official accounts.',
      agentType: 'WECHAT',
      skillId: 'wechat_articles',
    },
    call_xiaohongshu_agent: {
      id: 'call_xiaohongshu_agent',
      title: 'Call Xiaohongshu Assistant',
      description: 'Read Xiaohongshu trend and competitor content signals.',
      agentType: 'XIAOHONGSHU',
      skillId: 'xiaohongshu_insights',
    },
    call_gmail_agent: {
      id: 'call_gmail_agent',
      title: 'Call Email Assistant',
      description: 'Read external communication, action items, and risk signals from email.',
      agentType: 'GMAIL',
      skillId: 'gmail_insights',
    },
    call_feishu_agent: {
      id: 'call_feishu_agent',
      title: 'Call Lark Assistant',
      description: 'Read internal project and team progress from Lark.',
      agentType: 'FEISHU',
      skillId: 'feishu_insights',
    },
    merge_results: {
      id: 'merge_results',
      title: 'Merge Sources',
      description: 'Merge information returned by skills and child agents into the briefing context.',
    },
    generate_briefing_summary: {
      id: 'generate_briefing_summary',
      title: 'Generate Briefing Summary',
      description: 'Generate the briefing from internal data, external information, and child agent results.',
    },
    structure_briefing_json: {
      id: 'structure_briefing_json',
      title: 'Structure Briefing JSON',
      description: 'Have the executive assistant organize collected information into Information Digest and extract Today To-Dos from all sources; Twin Recommendations is not enabled yet.',
    },
    structure_informationSummary: {
      id: 'structure_informationSummary',
      title: 'Structure Information Digest',
      description: 'The Information Digest structuring child agent organizes candidate material from all channels.',
    },
    structure_todayTodo: {
      id: 'structure_todayTodo',
      title: 'Structure Today To-Dos',
      description: 'The Today To-Dos structuring child agent extracts action items from all message channels.',
    },
    structure_twinRecommendation: {
      id: 'structure_twinRecommendation',
      title: 'Structure Twin Recommendations',
      description: 'Twin Recommendations is not enabled yet; currently outputs a placeholder only.',
    },
    aggregate_structured_briefing: {
      id: 'aggregate_structured_briefing',
      title: 'Aggregate Structured Briefing',
      description: 'The aggregation agent validates the three modules and generates the final title and summary.',
    },
    persist_briefing: {
      id: 'persist_briefing',
      title: 'Save Today Briefing',
      description: 'Write today briefing to executive_briefings.',
      skillId: 'persist_briefing',
    },
    generate_reply: {
      id: 'generate_reply',
      title: 'Generate Chat Reply',
      description: 'Executive Assistant Momo replies to the user based on the latest context.',
      skillId: 'chat_reply',
    },
  };

  return known[id] || {
    id,
    title: id,
    description: 'Step generated by the dynamic planner for this turn.',
  };
}

function dateKey(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function shouldUpdateBriefing(userQuery: string) {
  return /update.*briefing|refresh.*briefing|generate.*briefing|today briefing|today.*briefing|daily briefing/i.test(userQuery);
}

function shouldIncludeWechat(userQuery: string, context: LoadedExecutiveContext) {
  if (!context.hasWechatSources) return false;
  if (shouldUpdateBriefing(userQuery)) return true;
  return /official account|wechat|article|market|industry|trend|competitive|intelligence|news|ai\s*agent|agent|vibe\s*coding|vibe|coding/i.test(userQuery);
}

function shouldUseExternalWeb(userQuery: string) {
  return shouldUpdateBriefing(userQuery) || /market|industry|trend|competitive|intelligence|news|ai\s*agent|agent|vibe\s*coding|vibe|coding/i.test(userQuery);
}

function isMultiChannelOrchestrationQuery(userQuery: string) {
  return /child agent|subagent|WeChat Official Accounts|official account|xiaohongshu|email|Email|gmail|lark|feishu/i.test(userQuery);
}

function buildWebSearchChannelInstruction(userQuery: string) {
  if (!isMultiChannelOrchestrationQuery(userQuery)) return userQuery;
  return [
    'The user asked to update today briefing and consolidate multi-channel information.',
    'The web search assistant only handles public web search and supplements Information Digest material with verifiable URLs.',
    'WeChat Official Accounts, email, Lark, Xiaohongshu, and similar channels are handled by other child agents. Do not search for or simulate internal results from private or vertical channels.',
    'Today To-Dos are extracted by the top-level executive assistant across all sources; Twin Recommendations is not enabled yet.',
  ].join(' ');
}

function buildWebSearchIntent(userQuery: string, executiveSystemPrompt?: string) {
  const preference = executiveSystemPrompt?.trim()
    ? executiveSystemPrompt.trim().slice(0, 1600)
    : 'No additional preferences.';
  const channelInstruction = buildWebSearchChannelInstruction(userQuery);

  return [
    `Web search channel task: ${channelInstruction}`,
    `Executive assistant system prompt / user preferences: ${preference}`,
    'Web search requirements: search only public internet sources and produce only Information Digest material. Search scope, keywords, filtering, and retention strategy must come from the executive assistant system prompt / user preferences and the channel task above. Do not add hard-coded business topic preferences. Prioritize public information with clear sources, timestamps, and verifiable URLs.',
  ].join('\n');
}

function buildWechatTaskSpec(params: {
  userQuery: string;
  objective: string;
  executiveSystemPrompt?: string;
  raw?: unknown;
}): AgentTaskSpec {
  const raw = params.raw && typeof params.raw === 'object' ? (params.raw as Record<string, unknown>) : {};
  const rawCriteria = Array.isArray(raw.sourceSelectionCriteria)
    ? raw.sourceSelectionCriteria
    : Array.isArray(raw.criteria)
      ? raw.criteria
      : [];
  const prompt = params.executiveSystemPrompt?.trim();
  const orchestrationQuery = /child agent|subagent|xiaohongshu|email|Email|gmail|lark|feishu/i.test(params.userQuery);
  const scopedUserInstruction = orchestrationQuery
    ? 'The original user request is to update today briefing and consolidate multi-channel information. The WeChat Official Accounts Assistant only handles official account articles; email, Lark, Xiaohongshu, and other channels are handled by their own child agents.'
    : params.userQuery;
  const channelScope = 'WeChat channel scope: extract mergeable Information Digest material only from WeChat Official Accounts sources. Today To-Dos are extracted by the top-level executive assistant across all sources. Twin Recommendations is not enabled and should not be generated by the WeChat Official Accounts Assistant.';
  const sourceSelectionCriteria = Array.from(new Set([
    ...rawCriteria,
    scopedUserInstruction,
    params.objective,
    channelScope,
    prompt ? prompt.slice(0, 900) : '',
  ]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)))
    .slice(0, 20);

  const rawSections =
    raw.returnFormat && typeof raw.returnFormat === 'object' && Array.isArray((raw.returnFormat as Record<string, unknown>).sections)
      ? ((raw.returnFormat as Record<string, unknown>).sections as unknown[])
      : [];
  const sections = rawSections
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item === 'Information Digest')
    .slice(0, 1);
  const wechatReturnFormatGuard = [
    'The WeChat Official Accounts Assistant only provides candidate Information Digest material.',
    'Today To-Dos are extracted by the top-level executive assistant across all sources. The WeChat Official Accounts Assistant should not generate the to-do module.',
    'Twin Recommendations is not enabled. The WeChat Official Accounts Assistant should not generate the Twin Recommendations module.',
  ].join('\n');
  const instructions =
    raw.returnFormat &&
    typeof raw.returnFormat === 'object' &&
    typeof (raw.returnFormat as Record<string, unknown>).instructions === 'string'
      ? `${String((raw.returnFormat as Record<string, unknown>).instructions).trim().slice(0, 1200)}\n${wechatReturnFormatGuard}`
      : [
          'Return results in a format the briefing assistant can merge directly.',
          'Each item must include the source official account, article title, link, publication time, and why it matters.',
          wechatReturnFormatGuard,
          'Business preferences, filtering rules, and retention strategy must follow the briefing assistant system prompt.',
        ].join('\n');

  return {
    objective:
      typeof raw.objective === 'string' && raw.objective.trim()
        ? raw.objective.trim().slice(0, 500)
        : params.objective,
    sourceSelectionCriteria,
    timeWindow: {
      type: 'rolling_hours',
      hours: 24,
      endAt: new Date().toISOString(),
    },
    returnFormat: {
      sections: sections.length > 0 ? sections : ['Information Digest'],
      instructions,
    },
  };
}

function hasSkill(plan: ExecutiveTurnPlan, skillId: ExecutiveSkillId) {
  return plan.skills.includes(skillId);
}

function normalizeSkillId(value: unknown): ExecutiveSkillId | null {
  if (typeof value !== 'string') return null;
  const allowed = new Set<ExecutiveSkillId>(getActiveExecutiveSkillRegistry().map((skill) => skill.skillId));
  return allowed.has(value as ExecutiveSkillId) ? (value as ExecutiveSkillId) : null;
}

function isSkillAvailable(skillId: ExecutiveSkillId, context: LoadedExecutiveContext) {
  if (skillId === 'web_search') return WEB_SEARCH_ASSISTANT_ENABLED;
  if (skillId === 'wechat_articles') return context.hasWechatSources;
  if (skillId === 'xiaohongshu_insights') return context.integrationProviders.has('XIAOHONGSHU');
  if (skillId === 'gmail_insights') return context.integrationProviders.has('GMAIL');
  if (skillId === 'feishu_insights') return context.integrationProviders.has('FEISHU');
  return true;
}

function buildFallbackSkillReason(params: {
  skillId: ExecutiveSkillId;
  selected: boolean;
  available: boolean;
  updateBriefing: boolean;
  useWebSearch: boolean;
  userQuery: string;
}) {
  if (!params.available) return 'The current account is missing the data source or integration required by this skill.';
  if (params.selected) {
    if (params.skillId === 'web_search') return 'Planner decided this turn needs supplemental public web information.';
    if (params.skillId === 'wechat_articles') return 'Planner decided this turn needs tracked official account articles.';
    if (params.skillId === 'persist_briefing') return 'This turn updates today briefing, so the result must be saved.';
    if (params.skillId === 'internal_briefing') return 'Every turn needs to load account context.';
    if (params.skillId === 'chat_reply') return 'Every turn needs to generate a final reply.';
    return 'Planner selected this skill for this turn.';
  }
  if (params.skillId === 'web_search') {
    if (!params.useWebSearch) {
      return 'Planner did not decide that this turn needs public web retrieval. To force web access, explicitly ask to call the Web Search Assistant or add public web information.';
    }
    return "Planner did not include web_search in this turn's skill list.";
  }
  if (params.skillId === 'wechat_articles') return 'Planner did not decide that official account articles are needed this turn.';
  if (params.skillId === 'persist_briefing' && !params.updateBriefing) return 'This turn is not a briefing update, so today briefing does not need to be saved.';
  return `Planner did not select this skill; user instruction: ${params.userQuery.slice(0, 120)}`;
}

function normalizeSkillDecisions(params: {
  raw: unknown;
  skills: ExecutiveSkillId[];
  context: LoadedExecutiveContext;
  updateBriefing: boolean;
  useWebSearch: boolean;
  userQuery: string;
}): ExecutiveSkillDecision[] {
  const rawBySkill = new Map<ExecutiveSkillId, Record<string, unknown>>();
  if (Array.isArray(params.raw)) {
    for (const value of params.raw) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      const skillId = normalizeSkillId(item.skillId);
      if (skillId) rawBySkill.set(skillId, item);
    }
  }
  const selected = new Set(params.skills);
  return getActiveExecutiveSkillRegistry().map((skill) => {
    const raw = rawBySkill.get(skill.skillId);
    const available =
      typeof raw?.available === 'boolean'
        ? raw.available
        : isSkillAvailable(skill.skillId, params.context);
    const isSelected = selected.has(skill.skillId);
    const rawSelected = typeof raw?.selected === 'boolean' ? raw.selected : undefined;
    const fallbackReason = buildFallbackSkillReason({
      skillId: skill.skillId,
      selected: isSelected,
      available,
      updateBriefing: params.updateBriefing,
      useWebSearch: params.useWebSearch,
      userQuery: params.userQuery,
    });
    return {
      skillId: skill.skillId,
      name: skill.name,
      available,
      selected: isSelected,
      reason:
        (rawSelected === undefined || rawSelected === isSelected) && typeof raw?.reason === 'string' && raw.reason.trim()
          ? raw.reason.trim().slice(0, 500)
          : fallbackReason,
    };
  });
}

function normalizePlannerStep(value: unknown, index: number): ExecutivePlannerStepDefinition | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 80) : '';
  if (!title) return null;
  const skillId = normalizeSkillId(item.skillId);
  const fallbackId = skillId ? `skill_${skillId}` : `dynamic_step_${index + 1}`;
  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 80) : fallbackId,
    title,
    description:
      typeof item.description === 'string' && item.description.trim()
        ? item.description.trim().slice(0, 220)
        : 'Step generated by the dynamic planner for this turn.',
    agentType: typeof item.agentType === 'string' && item.agentType.trim() ? item.agentType.trim().slice(0, 40) : undefined,
    skillId: skillId || undefined,
  };
}

function ensurePlanStep(
  steps: ExecutivePlannerStepDefinition[],
  step: ExecutivePlannerStepDefinition,
  position: 'start' | 'end' = 'end'
) {
  if (steps.some((item) => item.id === step.id || (step.skillId && item.skillId === step.skillId))) return steps;
  return position === 'start' ? [step, ...steps] : [...steps, step];
}

function fallbackExecutivePlan(params: {
  userQuery: string;
  context: LoadedExecutiveContext;
  executiveSystemPrompt?: string;
  plannerError?: string;
}): ExecutiveTurnPlan {
  const updateBriefing = shouldUpdateBriefing(params.userQuery);
  const useWebSearch = WEB_SEARCH_ASSISTANT_ENABLED && shouldUseExternalWeb(params.userQuery);
  const includeWechat = shouldIncludeWechat(params.userQuery, params.context);
  const skills: ExecutiveSkillId[] = ['internal_briefing', 'chat_reply'];
  const steps: ExecutivePlannerStepDefinition[] = [
    getExecutivePlannerStepDefinition('load_context'),
    getExecutivePlannerStepDefinition('plan_subagents'),
  ];

  if (useWebSearch) {
    skills.push('web_search');
    steps.push(getExecutivePlannerStepDefinition('call_web_search'));
  }
  if (includeWechat) {
    skills.push('wechat_articles');
    steps.push(getExecutivePlannerStepDefinition('call_wechat_agent'));
  }
  if (params.context.integrationProviders.has('XIAOHONGSHU') && /xiaohongshu|social|content|competitor|trend/.test(params.userQuery)) {
    skills.push('xiaohongshu_insights');
    steps.push(getExecutivePlannerStepDefinition('call_xiaohongshu_agent'));
  }
  if (params.context.integrationProviders.has('GMAIL') && /email|Email|customer|investor|external communication|todo|to-do/.test(params.userQuery)) {
    skills.push('gmail_insights');
    steps.push(getExecutivePlannerStepDefinition('call_gmail_agent'));
  }
  if (params.context.integrationProviders.has('FEISHU') && /lark|internal|team|project|progress|todo|to-do/.test(params.userQuery)) {
    skills.push('feishu_insights');
    steps.push(getExecutivePlannerStepDefinition('call_feishu_agent'));
  }
  if (updateBriefing || includeWechat || useWebSearch) {
    steps.push(getExecutivePlannerStepDefinition('merge_results'));
    steps.push(getExecutivePlannerStepDefinition('generate_briefing_summary'));
    steps.push(getExecutivePlannerStepDefinition('structure_briefing_json'));
  }
  if (updateBriefing) {
    skills.push('persist_briefing');
    steps.push(getExecutivePlannerStepDefinition('persist_briefing'));
  }
  steps.push(getExecutivePlannerStepDefinition('generate_reply'));

  return {
    objective: updateBriefing ? 'update today briefing' : 'answer the user and call available skills as needed',
    updateBriefing,
    useWebSearch,
    skills: Array.from(new Set(skills)),
    skillDecisions: normalizeSkillDecisions({
      raw: undefined,
      skills: Array.from(new Set(skills)),
      context: params.context,
      updateBriefing,
      useWebSearch,
      userQuery: params.userQuery,
    }),
    steps,
    wechatTaskSpec: includeWechat
      ? buildWechatTaskSpec({
          userQuery: params.userQuery,
          objective: updateBriefing ? 'update today briefing' : params.userQuery,
          executiveSystemPrompt: params.executiveSystemPrompt,
        })
      : undefined,
    plannerSource: 'FALLBACK',
    plannerError: params.plannerError,
  };
}

function normalizeExecutivePlan(
  raw: string,
  context: LoadedExecutiveContext,
  userQuery: string,
  executiveSystemPrompt?: string
): ExecutiveTurnPlan {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const updateBriefing =
    typeof parsed.updateBriefing === 'boolean' ? parsed.updateBriefing : shouldUpdateBriefing(userQuery);
  const parsedUseWebSearch =
    typeof parsed.useWebSearch === 'boolean' ? parsed.useWebSearch : shouldUseExternalWeb(userQuery);
  const useWebSearch = WEB_SEARCH_ASSISTANT_ENABLED && parsedUseWebSearch;
  const skills = Array.isArray(parsed.skills)
    ? parsed.skills.map(normalizeSkillId).filter((skill): skill is ExecutiveSkillId => Boolean(skill))
    : [];
  const normalizedSkills = Array.from(new Set<ExecutiveSkillId>([
    'internal_briefing',
    ...skills,
    ...(useWebSearch ? (['web_search'] as ExecutiveSkillId[]) : []),
    ...(updateBriefing && context.hasWechatSources ? (['wechat_articles'] as ExecutiveSkillId[]) : []),
    ...(updateBriefing ? (['persist_briefing'] as ExecutiveSkillId[]) : []),
    'chat_reply',
  ]));
  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
  let steps = rawSteps.map(normalizePlannerStep).filter(Boolean) as ExecutivePlannerStepDefinition[];

  steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('load_context'), 'start');
  steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('plan_subagents'), 'start');
  if (normalizedSkills.includes('web_search')) steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('call_web_search'));
  if (normalizedSkills.includes('wechat_articles') && context.hasWechatSources) {
    steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('call_wechat_agent'));
  }
  if (normalizedSkills.includes('xiaohongshu_insights')) steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('call_xiaohongshu_agent'));
  if (normalizedSkills.includes('gmail_insights')) steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('call_gmail_agent'));
  if (normalizedSkills.includes('feishu_insights')) steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('call_feishu_agent'));
  if (updateBriefing || normalizedSkills.some((skill) => skill !== 'internal_briefing' && skill !== 'chat_reply')) {
    steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('merge_results'));
    steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('generate_briefing_summary'));
    steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('structure_briefing_json'));
  }
  if (updateBriefing) steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('persist_briefing'));
  steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('generate_reply'));

  const objective =
    typeof parsed.objective === 'string' && parsed.objective.trim()
      ? parsed.objective.trim().slice(0, 160)
      : fallbackExecutivePlan({ userQuery, context, executiveSystemPrompt }).objective;
  const includeWechat = normalizedSkills.includes('wechat_articles') && context.hasWechatSources;

  return {
    objective,
    updateBriefing,
    useWebSearch,
    skills: normalizedSkills,
    skillDecisions: normalizeSkillDecisions({
      raw: parsed.skillDecisions,
      skills: normalizedSkills,
      context,
      updateBriefing,
      useWebSearch,
      userQuery,
    }),
    steps: steps.slice(0, 12),
    wechatTaskSpec: includeWechat
      ? buildWechatTaskSpec({
          userQuery,
          objective,
          executiveSystemPrompt,
          raw: parsed.wechatTaskSpec,
        })
      : undefined,
    plannerSource: 'MODEL',
  };
}

async function planExecutiveTurn(params: {
  userQuery: string;
  context: LoadedExecutiveContext;
  executiveSystemPrompt?: string;
}): Promise<ExecutiveTurnPlan> {
  const availableSkills = getActiveExecutiveSkillRegistry().map((skill) => ({
    skillId: skill.skillId,
    name: skill.name,
    description: skill.description,
    implemented: skill.implemented,
    available: isSkillAvailable(skill.skillId, params.context),
  }));

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        "You are Executive Assistant Momo's dynamic planner.",
        'For each turn, generate an execution plan based on the user instruction, hired AI teammates, available skills, and permissions.',
        'Do not output a fixed full capability list; output only steps that really need to run this turn or need to be marked unavailable.',
        'Output only one JSON object matching the response_format JSON Schema. Do not output markdown, explanations, or extra fields.',
        'skills may only include skillIds that will actually run this turn or need to be marked unavailable; unavailable skills must not be selected=true.',
        'skillDecisions must cover all availableSkills and explain why each skill is selected or skipped.',
        'If wechat_articles is not selected, wechatTaskSpec must be null. If selected, provide an executable objective/sourceSelectionCriteria/returnFormat.',
        "steps should describe only this turn's execution plan. Do not invent runners that do not exist in code; use null when skillId/agentType is absent.",
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        userQuery: params.userQuery,
        executiveSystemPrompt: params.executiveSystemPrompt || '',
        availableSkills,
        accountContext: {
          hasWechatSources: params.context.hasWechatSources,
          integrations: Array.from(params.context.integrationProviders),
          hiredTeams: Array.from(params.context.hiredTeamKeys),
          internalFacts: params.context.internalFacts,
        },
        requiredOutputContract:
          "Output must match this request's response_format JSON Schema: objective/updateBriefing/useWebSearch/skills/skillDecisions/wechatTaskSpec/steps. Do not add fields.",
        stepIdHints: [
          'load_context',
          'plan_subagents',
          'call_wechat_agent',
          'call_xiaohongshu_agent',
          'call_gmail_agent',
          'call_feishu_agent',
          'merge_results',
          'generate_briefing_summary',
          'structure_briefing_json',
          'persist_briefing',
          'generate_reply',
        ],
      }),
    },
  ];

  try {
    const raw = await createJsonChatCompletion(
      messages,
      getOpenRouterModel('EXECUTIVE_PLANNER'),
      { maxTokens: 12000, jsonSchema: EXECUTIVE_PLANNER_JSON_SCHEMA }
    );
    return normalizeExecutivePlan(raw, params.context, params.userQuery, params.executiveSystemPrompt);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'planner generation failed';
    return fallbackExecutivePlan({
      userQuery: params.userQuery,
      context: params.context,
      executiveSystemPrompt: params.executiveSystemPrompt,
      plannerError: detail,
    });
  }
}

async function loadExecutiveContext(investorId: string): Promise<LoadedExecutiveContext | null> {
  const investor = await prisma.user.findUnique({
    where: { id: investorId },
    select: { id: true },
  });

  if (!investor) return null;

  let integrationRows: Array<{ id: string; provider: string; status: string }> = [];
  let latestSnapshots: Array<{ integrationId: string; summary: string; createdAt: Date }> = [];
  try {
    integrationRows = await prisma.investorIntegration.findMany({
      where: { investorId },
      select: {
        id: true,
        provider: true,
        status: true,
      },
    });
    latestSnapshots = integrationRows.length
      ? await prisma.integrationSnapshot.findMany({
          where: { integrationId: { in: integrationRows.map((item) => item.id) } },
          orderBy: { createdAt: 'desc' },
          select: {
            integrationId: true,
            summary: true,
            createdAt: true,
          },
        })
      : [];
  } catch (error) {
    console.error('[executive-orchestrator] failed to load integration context:', error);
  }
  const snapshotByIntegration = new Map<string, Array<{ summary: string; createdAt: Date }>>();
  for (const snapshot of latestSnapshots) {
    if (snapshotByIntegration.has(snapshot.integrationId)) continue;
    snapshotByIntegration.set(snapshot.integrationId, [{ summary: snapshot.summary, createdAt: snapshot.createdAt }]);
  }
  const integrations = integrationRows.map((item) => ({
    provider: item.provider,
    status: item.status,
    snapshots: snapshotByIntegration.get(item.id) || [],
  }));
  const wechatSources = await prisma.investorWechatSource.findMany({
    where: { investorId },
    orderBy: { updatedAt: 'desc' },
  });
  const avatars = await prisma.avatar.findMany({
    where: { investorId },
    include: {
      chats: {
        select: {
          needsInvestorReview: true,
          qualificationStatus: true,
        },
      },
    },
  });
  const teamHires = await prisma.investorTeamHire.findMany({
    where: { investorId },
    select: {
      teamKey: true,
      status: true,
    },
  });
  const agentThreads = await prisma.agentThread.findMany({
    where: { investorId },
    select: { agentType: true },
  });

  const hiredTeamKeys = resolveHiredTeamKeys({
    teamHires,
    fallback: {
      integrationCount: integrations.length,
      wechatSourceCount: wechatSources.length,
      avatarCount: avatars.length,
      agentTypes: agentThreads.map((thread) => thread.agentType),
    },
  });

  const baseBriefing = buildExecutiveDailyBriefing({
    integrations,
    wechatSources,
    avatars,
    hiredTeamKeys: Array.from(hiredTeamKeys),
  });

  const integrationProviders = new Set(integrations.map((item) => item.provider));
  const integrationSnapshotFacts = integrations.flatMap((item) =>
    item.snapshots.slice(0, 1).map((snapshot) => {
      const createdAt = snapshot.createdAt.toISOString();
      return `${item.provider} latest message summary (${createdAt}): ${snapshot.summary}`;
    })
  );
  const internalFacts = [
    `Connected integrations: ${integrations.map((item) => item.provider).join(', ') || 'none'}`,
    `Tracked official accounts: ${wechatSources.map((item) => item.displayName).join(', ') || 'none'}`,
    `Digital twin count: ${avatars.length}`,
    `Hired teams: ${Array.from(hiredTeamKeys).join(', ') || 'none'}`,
    ...integrationSnapshotFacts,
  ];

  return {
    baseBriefing,
    hiredTeamKeys,
    integrationProviders,
    hasWechatSources: wechatSources.length > 0,
    internalFacts,
  };
}

function mergeBriefingWithItems(
  briefing: ExecutiveDailyBriefing,
  items: AgentBriefingItem[],
  suffix?: string
): ExecutiveDailyBriefing {
  if (items.length === 0) return briefing;
  const content = items
    .slice(0, 100)
    .map((item, index) => {
      const source = item.url ? `${item.source} ${item.url}` : item.source;
      return `${index + 1}. ${item.title}: ${item.summary} (${source})`;
    })
    .join('\n');

  return {
    ...briefing,
    headline: suffix ? `${briefing.headline} ${suffix}` : briefing.headline,
    externalInsights: [
      {
        category: 'Child Agent Updates',
        content,
        source: 'Executive Assistant Orchestrator',
      },
      ...briefing.externalInsights,
    ],
  };
}

async function buildBriefingSummary(input: {
  userQuery: string;
  executiveSystemPrompt: string;
  briefing: ExecutiveDailyBriefing;
  subagentResults: AgentRunResult[];
  internalFacts: string[];
  useWeb: boolean;
}) {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        "You are Executive Assistant Momo's briefing generator.",
        'The executive assistant system prompt / user preferences below are the only source of business preferences and user tendencies.',
        'Filtering, retention volume, topic importance, and ordering must come from the executive assistant system prompt and the current user command. Do not add hard-coded business topic preferences.',
        'Generate today founder-facing briefing from internal data, child agent results, and explicit web search results.',
        'If child agent results include WEB_SEARCH, use only those recorded search results and do not start any implicit search.',
        'If the executive assistant system prompt says not to filter again or to retain child agent results, comply; otherwise process only according to the system prompt and user command.',
        'Clearly state sources and uncertainty.',
        'Write in clear professional English. Information Digest should cover important signals from all called sources; Today To-Dos should extract action items from all information and internal context; Twin Recommendations is not enabled, so do not force recommendations.',
        'Today To-Dos must extract actionable items from all called message channels and internal context, ordered by Red P0, Yellow P1, Green P2.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Executive assistant system prompt / user preferences: \n${input.executiveSystemPrompt}`,
        `User command: ${input.userQuery}`,
        `Needs external web search: ${input.useWeb ? 'yes' : 'no'}`,
        `Web search intent: \n${buildWebSearchIntent(input.userQuery, input.executiveSystemPrompt)}`,
        `Baseline briefing: ${JSON.stringify(input.briefing)}`,
        `Internal data: \n${input.internalFacts.join('\n')}`,
        `Child agent results: ${JSON.stringify(
          input.subagentResults.map((item) => ({
            agentType: item.agentType,
            answer: item.answer,
            briefingItems: item.briefingItems,
            debug: item.debug,
          }))
        )}`,
      ].join('\n\n'),
    },
  ];

  return createChatCompletion(messages, getOpenRouterModel('EXECUTIVE'), { enableWebtools: false });
}

function fallbackSummary(briefing: ExecutiveDailyBriefing, subagentResults: AgentRunResult[]) {
  const lines = [
    briefing.headline,
    ...briefing.externalInsights.map((item) => `${item.category}: ${item.content}`),
    ...subagentResults.map((item) => `${item.agentType}: ${item.answer}`),
  ];
  return lines.join('\n\n');
}

function asString(value: unknown, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim();
}

function normalizeStructuredItem(raw: unknown): StructuredBriefingItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const title = asString(item.title).slice(0, 160);
  const summary = asString(item.summary).slice(0, 500);
  const source = asString(item.source, 'Executive Assistant Momo').slice(0, 160);
  if (!title || !summary) return null;
  return {
    title,
    summary,
    source,
    url: asString(item.url) || undefined,
    publishedAt: asString(item.publishedAt) || undefined,
    whyItMatters: asString(item.whyItMatters).slice(0, 400) || undefined,
  };
}

function normalizeStructuredModule(raw: unknown, title: StructuredBriefingModule['title']): StructuredBriefingModule {
  const fallback = {
    title,
    content: `No clear ${title} yet. The executive assistant will continue filling this in during the next briefing update.`,
    items: [],
  };
  if (!raw || typeof raw !== 'object') return fallback;
  const rawModule = raw as Record<string, unknown>;
  const items = Array.isArray(rawModule.items)
    ? rawModule.items.map(normalizeStructuredItem).filter((item): item is StructuredBriefingItem => Boolean(item))
    : [];
  return {
    title,
    content: asString(rawModule.content, fallback.content).slice(0, 2200),
    items,
  };
}

function normalizeStructuredBriefing(raw: string): StructuredBriefingOutput {
  const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
  const modules = parsed.modules && typeof parsed.modules === 'object' ? (parsed.modules as Record<string, unknown>) : {};
  return {
    title: asString(parsed.title, `Executive Assistant Momo Briefing ${dateKey()}`).slice(0, 160),
    summary: asString(parsed.summary, 'Today briefing has been updated.').slice(0, 2400),
    modules: [
      normalizeStructuredModule(modules.informationSummary, 'Information Digest'),
      normalizeStructuredModule(modules.todayTodo, 'Today To-Dos'),
      normalizeStructuredModule(modules.twinRecommendation, 'Twin Recommendations'),
    ],
  };
}

function compactBriefingSource(item: AgentBriefingItem) {
  return {
    category: item.category.slice(0, 80),
    title: item.title.slice(0, 160),
    summary: item.summary.slice(0, 360),
    source: item.source.slice(0, 120),
    url: item.url,
    publishedAt: item.publishedAt,
  };
}

function compactBriefingSourceWithIndex(item: AgentBriefingItem, index: number) {
  return {
    sourceIndex: index,
    ...compactBriefingSource(item),
  };
}

function getModuleAgentStepId(module: StructuredBriefingModulePlan) {
  return `structure_${module.key}`;
}

function normalizeModuleAgentOutput(raw: string, module: StructuredBriefingModulePlan): StructuredBriefingModule {
  const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
  const itemLimit = module.key === 'informationSummary' ? INFORMATION_SUMMARY_ITEM_LIMIT : STRUCTURED_AGENT_ITEM_LIMIT;
  const items = Array.isArray(parsed.items)
    ? parsed.items
        .map(normalizeStructuredItem)
        .filter((item): item is StructuredBriefingItem => Boolean(item))
        .slice(0, itemLimit)
    : [];
  return {
    title: module.title,
    content: asString(parsed.content, items.map((item) => item.summary).join('\n')).slice(0, 2200),
    items,
  };
}

function normalizeAggregatorOutput(raw: string) {
  const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
  return {
    title: asString(parsed.title, `Executive Assistant Momo Briefing ${dateKey()}`).slice(0, 160),
    summary: asString(parsed.summary, 'Today briefing has been updated.').slice(0, 2400),
  };
}

function buildModuleItemSchema() {
  return {
    title: 'string',
    summary: 'string',
    source: 'string',
    url: 'string optional',
    publishedAt: 'string optional',
    whyItMatters: 'string optional',
  };
}

async function runStructuredModuleAgent(input: {
  module: StructuredBriefingModulePlan;
  userQuery: string;
  executiveSystemPrompt: string;
  summary: string;
  sources: AgentBriefingItem[];
  calledAgents: ExecutiveBriefingDocument['calledAgents'];
  useWeb: boolean;
  onPlannerEvent?: ExecutivePlannerEmit;
}) {
  const stepId = getModuleAgentStepId(input.module);
  await emitPlannerStep(input.onPlannerEvent, stepId, 'RUNNING', {
    detail: `${input.module.title} structuring child agent is organizing candidate material.`,
    payload: { sourceCount: input.sources.length },
  });

  if (input.module.key === 'twinRecommendation') {
    const structuredModule: StructuredBriefingModule = {
      title: 'Twin Recommendations',
      content: 'Twin Recommendations is not enabled yet; this turn will not generate recommendations from Information Digest material.',
      items: [],
    };
    await emitPlannerStep(input.onPlannerEvent, stepId, 'SUCCESS', {
      detail: 'Twin Recommendations is not enabled, so material-based recommendation generation was skipped.',
      payload: { itemCount: 0, unavailable: true },
    });
    return structuredModule;
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        `You are Executive Assistant Momo's briefing structuring child agent, responsible only for "${input.module.title}" module.`,
        'Business preferences, filtering, retention, and ordering rules must come from the briefing assistant system prompt and the current user command. Do not add hard-coded business topic preferences.',
        'If the briefing assistant system prompt says not to filter again or to retain child agent results, comply.',
        `Output only the "${input.module.title}" module; do not output other modules.`,
        input.module.key === 'todayTodo'
          ? 'This module extracts actionable to-dos from all Information Digest material at the top level and should not output pure news. Each title must start with "Red P0 ", "Yellow P1 ", or "Green P2 "; the summary should explain why it matters, which channel or source it relates to, and when to handle it.'
          : '',
        input.module.key === 'informationSummary'
          ? 'This module consolidates candidate material from all called channels. Filtering must strictly follow the briefing assistant system prompt and current user command: if instructed not to filter again, retain as much as possible, or show every source, keep all non-duplicate sources; filter only when explicitly asked to filter, condense, or keep highlights only.'
          : '',
        'Do not fabricate or introduce information outside the candidate material; preserve sources and URLs.',
        'Output strict JSON only. Do not output markdown or explanations.',
        'Strictly follow the outputSchema in the user message. Do not add, delete, or rename fields.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        executiveSystemPrompt: input.executiveSystemPrompt,
        userQuery: input.userQuery,
        useWeb: input.useWeb,
        module: input.module,
        generatedSummary: input.summary.slice(0, 6000),
        calledAgents: input.calledAgents,
        sources: input.sources.slice(0, 200).map(compactBriefingSourceWithIndex),
        constraints: [
          `Output only ${input.module.title} module`,
          `items max: ${STRUCTURED_AGENT_ITEM_LIMIT} items`,
          'Each summary must be 160 English words or fewer',
          'content should use one to three concise English paragraphs',
          'Do not copy long source passages',
          input.module.key === 'todayTodo'
            ? 'To-dos must be derived from specific information in sources, be concrete and actionable, and avoid vague phrasing such as "monitor this" or "keep watching"'
            : input.module.key === 'informationSummary'
              ? 'If not filtering, item count should be close to the deduplicated source count; if filtering, content must explain the selection criteria and cover different channels where possible'
            : 'If the same information fits multiple modules, keep it here only when it has clear business value for this module',
        ],
        outputSchema: {
          moduleKey: input.module.key,
          title: input.module.title,
          content: 'string',
          items: [buildModuleItemSchema()],
        },
      }),
    },
  ];

  try {
    const raw = await createJsonChatCompletion(
      messages,
      getOpenRouterModel('EXECUTIVE_STRUCTURER'),
      { maxTokens: 7000 }
    );
    const structuredModule = normalizeModuleAgentOutput(raw, input.module);
    await emitPlannerStep(input.onPlannerEvent, stepId, 'SUCCESS', {
      detail: `${input.module.title} structuring completed, returned ${structuredModule.items.length} items.`,
      payload: { itemCount: structuredModule.items.length },
    });
    return structuredModule;
  } catch (error) {
    const detail = error instanceof Error ? error.message : `${input.module.title} module structure failed`;
    await emitPlannerStep(input.onPlannerEvent, stepId, 'ERROR', { error: detail });
    throw new Error(`${input.module.title} structuring failed: ${detail}`);
  }
}

async function runStructuredBriefingAggregator(input: {
  userQuery: string;
  executiveSystemPrompt: string;
  summary: string;
  modules: StructuredBriefingModule[];
  sources: AgentBriefingItem[];
  calledAgents: ExecutiveBriefingDocument['calledAgents'];
  onPlannerEvent?: ExecutivePlannerEmit;
}) {
  await emitPlannerStep(input.onPlannerEvent, 'aggregate_structured_briefing', 'RUNNING', {
    detail: 'The briefing aggregation agent is validating the three modules and generating the title and summary.',
    payload: {
      moduleItemCounts: input.modules.map((module) => ({ title: module.title, itemCount: module.items.length })),
    },
  });

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        "You are Executive Assistant Momo's briefing aggregation agent.",
        'You will receive results from three module structuring child agents. Only check overall consistency and generate the final briefing title and summary.',
        'Do not rewrite items, delete items, add facts, or filter again.',
        'If module content has minor wording issues, address them only in the summary; items are assembled exactly from child agent results.',
        'Output strict JSON only. Do not output markdown or explanations.',
        'Strictly follow the outputSchema in the user message. Do not add, delete, or rename fields.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        executiveSystemPrompt: input.executiveSystemPrompt,
        userQuery: input.userQuery,
        generatedSummary: input.summary.slice(0, 6000),
        calledAgents: input.calledAgents,
        sourceCount: input.sources.length,
        modules: input.modules.map((module) => ({
          title: module.title,
          content: module.content,
          itemCount: module.items.length,
          itemTitles: module.items.map((item) => item.title).slice(0, STRUCTURED_AGENT_ITEM_LIMIT),
        })),
        outputSchema: {
          title: 'string',
          summary: 'string',
        },
      }),
    },
  ];

  try {
    const raw = await createJsonChatCompletion(
      messages,
      getOpenRouterModel('EXECUTIVE_STRUCTURER'),
      { maxTokens: 2500 }
    );
    const result = normalizeAggregatorOutput(raw);
    await emitPlannerStep(input.onPlannerEvent, 'aggregate_structured_briefing', 'SUCCESS', {
      detail: 'The briefing aggregation agent generated the title and summary.',
      payload: { title: result.title },
    });
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'structured briefing aggregation failed';
    await emitPlannerStep(input.onPlannerEvent, 'aggregate_structured_briefing', 'ERROR', { error: detail });
    throw new Error(`Structured briefing aggregation failed: ${detail}`);
  }
}

async function buildStructuredBriefing(input: {
  userQuery: string;
  executiveSystemPrompt: string;
  summary: string;
  briefing: ExecutiveDailyBriefing;
  subagentResults: AgentRunResult[];
  sources: AgentBriefingItem[];
  calledAgents: ExecutiveBriefingDocument['calledAgents'];
  useWeb: boolean;
  onPlannerEvent?: ExecutivePlannerEmit;
}) {
  try {
    await emitPlannerStep(input.onPlannerEvent, 'structure_briefing_json', 'RUNNING', {
      detail: 'The executive assistant is calling three structuring child agents in parallel and validating output through the aggregation agent.',
      payload: {
        sourceCount: input.sources.length,
        modules: STRUCTURED_MODULE_PLANS.map((module) => module.title),
      },
    });
    const modules = await Promise.all(
      STRUCTURED_MODULE_PLANS.map((module) =>
        runStructuredModuleAgent({
          module,
          userQuery: input.userQuery,
          executiveSystemPrompt: input.executiveSystemPrompt,
          summary: input.summary,
          sources: input.sources,
          calledAgents: input.calledAgents,
          useWeb: input.useWeb,
          onPlannerEvent: input.onPlannerEvent,
        })
      )
    );
    const aggregate = await runStructuredBriefingAggregator({
      userQuery: input.userQuery,
      executiveSystemPrompt: input.executiveSystemPrompt,
      summary: input.summary,
      modules,
      sources: input.sources,
      calledAgents: input.calledAgents,
      onPlannerEvent: input.onPlannerEvent,
    });
    const structured: StructuredBriefingOutput = {
      title: aggregate.title,
      summary: aggregate.summary,
      modules,
    };
    await emitPlannerStep(input.onPlannerEvent, 'structure_briefing_json', 'SUCCESS', {
      detail: 'The three structuring child agents and aggregation agent completed; the final briefing JSON passed validation.',
      payload: {
        moduleCount: structured.modules.length,
        itemCount: structured.modules.reduce((sum, item) => sum + item.items.length, 0),
        moduleItemCounts: structured.modules.map((module) => ({ title: module.title, itemCount: module.items.length })),
      },
    });
    return structured;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'structured briefing generation failed';
    await emitPlannerStep(input.onPlannerEvent, 'structure_briefing_json', 'ERROR', {
      error: detail,
    });
    throw new Error(`Structured briefing JSON generation failed: ${detail}`);
  }
}

async function buildDocument(input: {
  userQuery: string;
  executiveSystemPrompt: string;
  query: string;
  briefing: ExecutiveDailyBriefing;
  summary: string;
  subagentResults: AgentRunResult[];
  calledAgents: ExecutiveBriefingDocument['calledAgents'];
  useWeb: boolean;
  onPlannerEvent?: ExecutivePlannerEmit;
}): Promise<ExecutiveBriefingDocument> {
  const sources = input.subagentResults.flatMap((item) => item.briefingItems);
  const structured = await buildStructuredBriefing({
    userQuery: input.userQuery,
    executiveSystemPrompt: input.executiveSystemPrompt,
    summary: input.summary,
    briefing: input.briefing,
    subagentResults: input.subagentResults,
    sources,
    calledAgents: input.calledAgents,
    useWeb: input.useWeb,
    onPlannerEvent: input.onPlannerEvent,
  });
  return {
    dateKey: dateKey(),
    title: structured.title,
    summary: structured.summary,
    sections: [
      {
        title: 'Overview',
        content: input.briefing.headline,
      },
      ...structured.modules.map((section) => ({
        title: section.title,
        content: section.content,
        items: section.items.map((item) => ({
          category: section.title,
          title: item.title,
          summary: item.whyItMatters ? `${item.summary}\nWhy it matters: ${item.whyItMatters}` : item.summary,
          source: item.source,
          url: item.url,
          publishedAt: item.publishedAt,
        })),
      })),
    ],
    sources,
    calledAgents: input.calledAgents,
  };
}

export async function getTodayExecutiveBriefing(investorId: string) {
  return prisma.executiveBriefing.findUnique({
    where: {
      investorId_dateKey: {
        investorId,
        dateKey: dateKey(),
      },
    },
  });
}

export async function updateTodayExecutiveBriefing(params: {
  investorId: string;
  userQuery: string;
  executiveSystemPrompt?: string;
  onPlannerEvent?: ExecutivePlannerEmit;
}): Promise<ExecutiveBriefingUpdateResult | null> {
  await emitPlannerStep(params.onPlannerEvent, 'load_context', 'RUNNING', {
    detail: 'Reading account data and hired AI teammates.',
  });
  const context = await loadExecutiveContext(params.investorId);
  if (!context) {
    await emitPlannerStep(params.onPlannerEvent, 'load_context', 'ERROR', {
      error: 'Investor not found',
    });
    return null;
  }
  await emitPlannerStep(params.onPlannerEvent, 'load_context', 'SUCCESS', {
    detail: 'Account context loaded.',
    payload: {
      hasWechatSources: context.hasWechatSources,
      integrations: Array.from(context.integrationProviders),
      hiredTeams: Array.from(context.hiredTeamKeys),
    },
  });

  await emitPlannerStep(params.onPlannerEvent, 'plan_subagents', 'RUNNING', {
    detail: 'The executive assistant is dynamically planning which skills and child agents to call this turn.',
  });
  const plan = await planExecutiveTurn({
    userQuery: params.userQuery,
    context,
    executiveSystemPrompt: params.executiveSystemPrompt || '',
  });
  await params.onPlannerEvent?.({
    type: 'planner',
    steps: plan.steps,
    plan,
  });
  await emitPlannerStep(params.onPlannerEvent, 'plan_subagents', 'SUCCESS', {
    detail: [
      `Turn objective: ${plan.objective}`,
      `PlannerSource: ${plan.plannerSource}`,
      plan.plannerError ? `Planner fallback reason: ${plan.plannerError}` : '',
    ]
      .filter(Boolean)
      .join(' '),
    payload: {
      skills: plan.skills,
      skillDecisions: plan.skillDecisions,
      updateBriefing: plan.updateBriefing,
      useWebSearch: plan.useWebSearch,
    },
  });

  const calledAgents: ExecutiveBriefingDocument['calledAgents'] = [];
  const subagentTasks: Array<Promise<AgentRunResult>> = [];
  const includeWechat = hasSkill(plan, 'wechat_articles') && context.hasWechatSources;
  const useWeb = WEB_SEARCH_ASSISTANT_ENABLED && (plan.useWebSearch || hasSkill(plan, 'web_search'));
  const webSearchChannelInstruction = buildWebSearchChannelInstruction(params.userQuery);
  const webSearchIntent = buildWebSearchIntent(params.userQuery, params.executiveSystemPrompt);
  const webSearchDecision = plan.skillDecisions.find((item) => item.skillId === 'web_search');

  if (!useWeb && WEB_SEARCH_ASSISTANT_ENABLED) {
    await emitPlannerStep(params.onPlannerEvent, 'call_web_search', 'SKIPPED', {
      detail: webSearchDecision?.reason || 'Planner did not select the Web Search Assistant.',
      payload: { selected: false, decision: webSearchDecision },
    });
  }

  if (includeWechat) {
    await emitPlannerStep(params.onPlannerEvent, 'call_wechat_agent', 'RUNNING', {
      detail: 'Calling the WeChat Official Accounts Assistant to retrieve articles, bodies, and metrics.',
    });
    subagentTasks.push(
      runWechatAgent({
        investorId: params.investorId,
        userQuery: params.userQuery,
        mode: 'briefing',
        context: {
          taskSpec:
            plan.wechatTaskSpec ||
            buildWechatTaskSpec({
              userQuery: params.userQuery,
              objective: plan.objective,
              executiveSystemPrompt: params.executiveSystemPrompt,
            }),
        },
      })
        .then(async (result) => {
          calledAgents.push({
            agentType: 'WECHAT',
            status: 'SUCCESS',
            reason: `returned ${result.briefingItems.length} briefing items`,
          });
          await emitPlannerStep(params.onPlannerEvent, 'call_wechat_agent', 'SUCCESS', {
            detail: `WeChat Official Accounts Assistant completed and returned ${result.briefingItems.length} mergeable items.`,
            payload: result.debug,
          });
          return result;
        })
        .catch(async (error: unknown) => {
          const detail = error instanceof Error ? error.message : 'subagent failed';
          calledAgents.push({
            agentType: 'WECHAT',
            status: 'ERROR',
            reason: detail,
          });
          await emitPlannerStep(params.onPlannerEvent, 'call_wechat_agent', 'ERROR', {
            error: detail,
          });
          throw error;
        })
    );
  } else {
    if (hasSkill(plan, 'wechat_articles')) {
      await emitPlannerStep(params.onPlannerEvent, 'call_wechat_agent', 'SKIPPED', {
        detail: 'Planner selected the WeChat Official Accounts Assistant, but the current account has no usable official account sources.',
      });
    }
  }

  if (hasSkill(plan, 'xiaohongshu_insights')) {
    calledAgents.push({ agentType: 'XIAOHONGSHU', status: 'SKIPPED', reason: 'subagent runner not migrated yet' });
    await emitPlannerStep(params.onPlannerEvent, 'call_xiaohongshu_agent', 'SKIPPED', {
      detail: context.integrationProviders.has('XIAOHONGSHU')
        ? 'Planner selected the Xiaohongshu Assistant, but the child agent runner has not been migrated yet.'
        : 'Planner selected the Xiaohongshu Assistant, but the current account has no Xiaohongshu integration.',
    });
  }
  if (hasSkill(plan, 'gmail_insights')) {
    calledAgents.push({ agentType: 'GMAIL', status: 'SKIPPED', reason: 'subagent runner not migrated yet' });
    await emitPlannerStep(params.onPlannerEvent, 'call_gmail_agent', 'SKIPPED', {
      detail: context.integrationProviders.has('GMAIL')
        ? 'Planner selected the Email Assistant, but the child agent runner has not been migrated yet.'
        : 'Planner selected the Email Assistant, but the current account has no Gmail integration.',
    });
  }
  if (hasSkill(plan, 'feishu_insights')) {
    calledAgents.push({ agentType: 'FEISHU', status: 'SKIPPED', reason: 'subagent runner not migrated yet' });
    await emitPlannerStep(params.onPlannerEvent, 'call_feishu_agent', 'SKIPPED', {
      detail: context.integrationProviders.has('FEISHU')
        ? 'Planner selected the Lark Assistant, but the child agent runner has not been migrated yet.'
        : 'Planner selected the Lark Assistant, but the current account has no Lark integration.',
    });
  }

  if (useWeb) {
    await emitPlannerStep(params.onPlannerEvent, 'call_web_search', 'RUNNING', {
      detail: 'Calling the Web Search Assistant in parallel to retrieve and organize public web information through OpenRouter native web tools.',
      payload: { webSearchIntent },
    });
    subagentTasks.push(
      runWebSearchAgent({
        investorId: params.investorId,
        userQuery: webSearchChannelInstruction,
        mode: 'briefing',
        context: {
          webSearchIntent,
          subagentResults: [],
          taskSpec: {
            objective: `Run web search according to the executive assistant requirements and supplement the briefing with external public information: ${plan.objective}`,
            sourceSelectionCriteria: [
              webSearchChannelInstruction,
              params.executiveSystemPrompt || '',
            ].filter(Boolean),
            timeWindow: {
              type: 'rolling_hours',
              hours: 24,
              endAt: new Date().toISOString(),
            },
            returnFormat: {
              sections: ['Information Digest'],
              instructions:
                'Return only Information Digest material. Every item must include a source, and a URL whenever available. This task runs in parallel with other source assistants and does not wait for the WeChat Official Accounts Assistant. Today To-Dos are extracted by the top-level executive assistant across all sources; Twin Recommendations is not enabled yet. Business preferences, search scope, filtering, and retention strategy must follow the briefing assistant system prompt.',
            },
          },
        },
      })
        .then(async (webResult) => {
          calledAgents.push({
            agentType: 'WEB_SEARCH',
            status: 'SUCCESS',
            reason: `returned ${webResult.briefingItems.length} search results`,
          });
          await emitPlannerStep(params.onPlannerEvent, 'call_web_search', 'SUCCESS', {
            detail: `Web Search Assistant completed and returned ${webResult.briefingItems.length} mergeable items.`,
            payload: webResult.debug,
          });
          return webResult;
        })
        .catch(async (error: unknown) => {
          const detail = error instanceof Error ? error.message : 'web search agent failed';
          calledAgents.push({ agentType: 'WEB_SEARCH', status: 'ERROR', reason: detail });
          await emitPlannerStep(params.onPlannerEvent, 'call_web_search', 'ERROR', {
            error: detail,
            payload: { webSearchIntent },
          });
          throw new Error(`Web Search Assistant failed: ${detail}`);
        })
    );
  }

  const settled = await Promise.allSettled(subagentTasks);
  const subagentResults: AgentRunResult[] = [];
  const subagentErrors: string[] = [];
  for (const item of settled) {
    if (item.status === 'fulfilled') {
      subagentResults.push(item.value);
    } else {
      const reason = item.reason instanceof Error ? item.reason.message : 'subagent failed';
      subagentErrors.push(reason);
    }
  }
  if (subagentErrors.length > 0) {
    throw new Error(`Child agent execution failed: ${subagentErrors.join('; ')}`);
  }

  await emitPlannerStep(params.onPlannerEvent, 'merge_results', 'RUNNING', {
    detail: 'Merging child agent results into the briefing context.',
  });
  const briefingItems = subagentResults.flatMap((item) => item.briefingItems);
  const mergedBriefing = mergeBriefingWithItems(
    context.baseBriefing,
    briefingItems,
    briefingItems.length > 0 ? `This briefing merged ${briefingItems.length} child agent items.` : undefined
  );
  await emitPlannerStep(params.onPlannerEvent, 'merge_results', 'SUCCESS', {
    detail: `Merged ${briefingItems.length} child agent items.`,
  });

  let summary = fallbackSummary(mergedBriefing, subagentResults);
  if (plan.updateBriefing || subagentResults.length > 0 || useWeb) {
    try {
      await emitPlannerStep(params.onPlannerEvent, 'generate_briefing_summary', 'RUNNING', {
        detail: useWeb
          ? 'Generating the summary from recorded Web Search Assistant results.'
          : 'Generating the summary from the current context.',
        payload: useWeb ? { webSearchIntent } : undefined,
      });
      summary = await buildBriefingSummary({
        userQuery: params.userQuery,
        executiveSystemPrompt: params.executiveSystemPrompt || '',
        briefing: mergedBriefing,
        subagentResults,
        internalFacts: context.internalFacts,
        useWeb,
      });
      await emitPlannerStep(params.onPlannerEvent, 'generate_briefing_summary', 'SUCCESS', {
        detail: plan.updateBriefing ? 'Briefing summary generated.' : "This turn's information summary has been generated.",
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'summary generation failed';
      await emitPlannerStep(params.onPlannerEvent, 'generate_briefing_summary', 'ERROR', {
        error: detail,
      });
      throw new Error(`Briefing summary generation failed: ${detail}`);
    }
  }

  const document = await buildDocument({
    userQuery: params.userQuery,
    executiveSystemPrompt: params.executiveSystemPrompt || '',
    query: params.userQuery,
    briefing: mergedBriefing,
    summary,
    subagentResults,
    calledAgents,
    useWeb,
    onPlannerEvent: params.onPlannerEvent,
  });

  if (plan.updateBriefing) {
    await emitPlannerStep(params.onPlannerEvent, 'persist_briefing', 'RUNNING', {
      detail: 'Saving today briefing.',
    });
    await prisma.executiveBriefing.upsert({
      where: {
        investorId_dateKey: {
          investorId: params.investorId,
          dateKey: document.dateKey,
        },
      },
      update: {
        title: document.title,
        summary: document.summary,
        sections: document.sections,
        sources: document.sources,
      },
      create: {
        investorId: params.investorId,
        dateKey: document.dateKey,
        title: document.title,
        summary: document.summary,
        sections: document.sections,
        sources: document.sources,
      },
    });
    await emitPlannerStep(params.onPlannerEvent, 'persist_briefing', 'SUCCESS', {
      detail: `Today briefing saved: ${document.dateKey}.`,
    });
  }

  return {
    baseBriefing: context.baseBriefing,
    briefing: mergedBriefing,
    document,
    subagentResults,
    toolCalls: subagentResults.flatMap((item) => item.toolCalls),
  };
}

export function isExecutiveBriefingUpdateCommand(userQuery: string) {
  return shouldUpdateBriefing(userQuery);
}
