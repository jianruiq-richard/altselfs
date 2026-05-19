import { prisma } from '@/lib/prisma';
import { createChatCompletion, createJsonChatCompletion, getOpenRouterModel, type ChatMessage } from '@/lib/openrouter';
import { runWechatAgent } from '@/lib/agents/wechat-agent';
import { runWebSearchAgent } from '@/lib/agents/web-search-agent';
import type { AgentBriefingItem, AgentRunResult, AgentRunToolCall, AgentTaskSpec } from '@/lib/agents/types';
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
  title: '行业动态' | '技术趋势' | '竞品监控';
  content: string;
  items: StructuredBriefingItem[];
};

type StructuredBriefingModuleKey = 'industryDynamics' | 'technologyTrends' | 'competitorMonitoring';

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
  toolCalls: AgentRunToolCall[];
};

type LoadedExecutiveContext = {
  baseBriefing: ExecutiveDailyBriefing;
  hiredTeamKeys: Set<string>;
  integrationProviders: Set<string>;
  hasWechatSources: boolean;
  internalFacts: string[];
};

const STRUCTURED_AGENT_ITEM_LIMIT = 50;
const STRUCTURED_MODULE_PLANS: StructuredBriefingModulePlan[] = [
  { key: 'industryDynamics', title: '行业动态' },
  { key: 'technologyTrends', title: '技术趋势' },
  { key: 'competitorMonitoring', title: '竞品监控' },
];

const EXECUTIVE_SKILL_REGISTRY: Array<{
  skillId: ExecutiveSkillId;
  name: string;
  description: string;
  implemented: boolean;
  agentType?: string;
}> = [
  {
    skillId: 'web_search',
    name: '联网搜索',
    description: '调用联网搜索助手，使用 OpenRouter 原生 web_search / web_fetch 工具检索公开网页并整理来源。',
    implemented: true,
    agentType: 'WEB_SEARCH',
  },
  {
    skillId: 'wechat_articles',
    name: '微信公众号助手',
    description: '调用已雇佣的微信公众号 AI 员工，读取已追踪公众号的文章、正文和指标。',
    implemented: true,
    agentType: 'WECHAT',
  },
  {
    skillId: 'xiaohongshu_insights',
    name: '小红书助手',
    description: '调用小红书 AI 员工分析内容趋势、竞品声量和外部市场信号。',
    implemented: false,
    agentType: 'XIAOHONGSHU',
  },
  {
    skillId: 'gmail_insights',
    name: '邮件助手',
    description: '调用邮件 AI 员工提取外部沟通、待办和风险信号。',
    implemented: false,
    agentType: 'GMAIL',
  },
  {
    skillId: 'feishu_insights',
    name: '飞书助手',
    description: '调用飞书 AI 员工提取内部项目、团队进展和待办。',
    implemented: false,
    agentType: 'FEISHU',
  },
  {
    skillId: 'internal_briefing',
    name: '内部数据汇总',
    description: '读取账户已有集成、数字分身、团队雇佣状态和基础晨报上下文。',
    implemented: true,
  },
  {
    skillId: 'persist_briefing',
    name: '晨报持久化',
    description: '把更新后的今日晨报保存到 executive_briefings。',
    implemented: true,
  },
  {
    skillId: 'chat_reply',
    name: '总裁秘书回复',
    description: '基于本轮结果生成面向用户的最终回复。',
    implemented: true,
  },
];

export function getExecutivePlannerDefinition() {
  return [];
}

export function getExecutiveSkillRegistry() {
  return EXECUTIVE_SKILL_REGISTRY;
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
      title: '读取账户上下文',
      description: '读取已接入数据源、已雇佣 AI 员工、数字分身和基础晨报。',
      skillId: 'internal_briefing',
    },
    plan_subagents: {
      id: 'plan_subagents',
      title: '动态规划本轮任务',
      description: '由总裁秘书根据用户指令决定本轮要调用哪些 skill 和子 agent。',
    },
    call_web_search: {
      id: 'call_web_search',
      title: '调用联网搜索助手',
      description: '调用独立 Web Search agent，使用 OpenRouter web_search / web_fetch 搜索和读取网页。',
      skillId: 'web_search',
    },
    call_wechat_agent: {
      id: 'call_wechat_agent',
      title: '调用微信公众号助手',
      description: '读取已追踪公众号的文章、正文和指标。',
      agentType: 'WECHAT',
      skillId: 'wechat_articles',
    },
    call_xiaohongshu_agent: {
      id: 'call_xiaohongshu_agent',
      title: '调用小红书助手',
      description: '读取小红书趋势和竞品内容信号。',
      agentType: 'XIAOHONGSHU',
      skillId: 'xiaohongshu_insights',
    },
    call_gmail_agent: {
      id: 'call_gmail_agent',
      title: '调用邮件助手',
      description: '读取邮件中的外部沟通、待办和风险信号。',
      agentType: 'GMAIL',
      skillId: 'gmail_insights',
    },
    call_feishu_agent: {
      id: 'call_feishu_agent',
      title: '调用飞书助手',
      description: '读取飞书中的内部项目和团队进展。',
      agentType: 'FEISHU',
      skillId: 'feishu_insights',
    },
    merge_results: {
      id: 'merge_results',
      title: '合并信息源',
      description: '把各 skill 和子 agent 返回的信息合并到晨报上下文。',
    },
    generate_briefing_summary: {
      id: 'generate_briefing_summary',
      title: '生成晨报摘要',
      description: '基于内部数据、外部信息和子 agent 结果生成晨报。',
    },
    structure_briefing_json: {
      id: 'structure_briefing_json',
      title: '结构化晨报JSON',
      description: '由总裁秘书把已获得的信息归类为行业动态、技术趋势、竞品监控三个模块。',
    },
    structure_industryDynamics: {
      id: 'structure_industryDynamics',
      title: '结构化行业动态',
      description: '行业动态结构化子 agent 整理候选素材。',
    },
    structure_technologyTrends: {
      id: 'structure_technologyTrends',
      title: '结构化技术趋势',
      description: '技术趋势结构化子 agent 整理候选素材。',
    },
    structure_competitorMonitoring: {
      id: 'structure_competitorMonitoring',
      title: '结构化竞品监控',
      description: '竞品监控结构化子 agent 整理候选素材。',
    },
    aggregate_structured_briefing: {
      id: 'aggregate_structured_briefing',
      title: '聚合结构化晨报',
      description: '聚合 agent 校验三个模块并生成最终标题与总述。',
    },
    persist_briefing: {
      id: 'persist_briefing',
      title: '保存今日晨报',
      description: '把今日晨报写入 executive_briefings。',
      skillId: 'persist_briefing',
    },
    generate_reply: {
      id: 'generate_reply',
      title: '生成对话回复',
      description: '总裁秘书 Momo 基于最新上下文回复用户。',
      skillId: 'chat_reply',
    },
  };

  return known[id] || {
    id,
    title: id,
    description: '本轮动态 planner 生成的步骤。',
  };
}

function dateKey(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function shouldUpdateBriefing(userQuery: string) {
  return /更新.*晨报|刷新.*晨报|生成.*晨报|今日晨报|今天.*晨报|daily briefing/i.test(userQuery);
}

function shouldIncludeWechat(userQuery: string, context: LoadedExecutiveContext) {
  if (!context.hasWechatSources) return false;
  if (shouldUpdateBriefing(userQuery)) return true;
  return /公众号|微信|文章|外界|行业|动态|趋势|竞品|情报|新闻|ai\s*agent|agent|vibe\s*coding|vibe|coding/i.test(userQuery);
}

function shouldUseExternalWeb(userQuery: string) {
  return shouldUpdateBriefing(userQuery) || /外界|行业|动态|趋势|竞品|情报|新闻|ai\s*agent|agent|vibe\s*coding|vibe|coding/i.test(userQuery);
}

function buildWebSearchIntent(userQuery: string, executiveSystemPrompt?: string) {
  const preference = executiveSystemPrompt?.trim()
    ? executiveSystemPrompt.trim().slice(0, 1600)
    : '无额外偏好。';

  return [
    `用户当前指令：${userQuery}`,
    `总裁秘书system prompt / 用户偏好：${preference}`,
    '联网搜索要求：搜索范围、关键词、是否过滤、信息保留策略都必须从上述总裁秘书system prompt和用户当前指令中读取，不要添加代码预设的业务主题偏好。优先查找有明确来源、发布时间和可验证URL的公开信息。',
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
  const sourceSelectionCriteria = rawCriteria
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 20);

  const prompt = params.executiveSystemPrompt?.trim();
  const fallbackCriteria = [
    params.userQuery,
    params.objective,
    prompt ? prompt.slice(0, 600) : '',
  ].filter(Boolean);

  const rawSections =
    raw.returnFormat && typeof raw.returnFormat === 'object' && Array.isArray((raw.returnFormat as Record<string, unknown>).sections)
      ? ((raw.returnFormat as Record<string, unknown>).sections as unknown[])
      : [];
  const sections = rawSections
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 8);
  const instructions =
    raw.returnFormat &&
    typeof raw.returnFormat === 'object' &&
    typeof (raw.returnFormat as Record<string, unknown>).instructions === 'string'
      ? String((raw.returnFormat as Record<string, unknown>).instructions).trim().slice(0, 1200)
      : [
          '按晨报秘书可直接合并的格式返回。',
          '每条信息必须包含来源公众号、文章标题、链接、发布时间、为什么重要。',
          '业务偏好、筛选规则和保留策略必须以晨报秘书system prompt为准。',
        ].join('\n');

  return {
    objective:
      typeof raw.objective === 'string' && raw.objective.trim()
        ? raw.objective.trim().slice(0, 500)
        : params.objective,
    sourceSelectionCriteria: sourceSelectionCriteria.length > 0 ? sourceSelectionCriteria : fallbackCriteria,
    timeWindow: {
      type: 'rolling_hours',
      hours: 24,
      endAt: new Date().toISOString(),
    },
    returnFormat: {
      sections: sections.length > 0 ? sections : ['核心结论', '证据文章', '机会/风险', '建议动作'],
      instructions,
    },
  };
}

function hasSkill(plan: ExecutiveTurnPlan, skillId: ExecutiveSkillId) {
  return plan.skills.includes(skillId);
}

function normalizeSkillId(value: unknown): ExecutiveSkillId | null {
  if (typeof value !== 'string') return null;
  const allowed = new Set<ExecutiveSkillId>(EXECUTIVE_SKILL_REGISTRY.map((skill) => skill.skillId));
  return allowed.has(value as ExecutiveSkillId) ? (value as ExecutiveSkillId) : null;
}

function isSkillAvailable(skillId: ExecutiveSkillId, context: LoadedExecutiveContext) {
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
  if (!params.available) return '当前账户缺少这个 skill 所需的数据源或集成。';
  if (params.selected) {
    if (params.skillId === 'web_search') return 'Planner 判断本轮需要公开网络信息补充。';
    if (params.skillId === 'wechat_articles') return 'Planner 判断本轮需要读取已追踪公众号文章。';
    if (params.skillId === 'persist_briefing') return '本轮会更新今日晨报，需要保存结果。';
    if (params.skillId === 'internal_briefing') return '每轮都需要读取账户上下文。';
    if (params.skillId === 'chat_reply') return '每轮都需要生成最终回复。';
    return 'Planner 选择在本轮调用这个 skill。';
  }
  if (params.skillId === 'web_search') {
    if (!params.useWebSearch) {
      return 'Planner 没有把本轮判断为需要公开网络检索；如果需要强制联网，请在指令中明确要求调用联网搜索助手或补充公开网页信息。';
    }
    return 'Planner 没有把 web_search 放入本轮执行技能列表。';
  }
  if (params.skillId === 'wechat_articles') return 'Planner 没有判断本轮需要公众号文章。';
  if (params.skillId === 'persist_briefing' && !params.updateBriefing) return '本轮不是晨报更新任务，不需要保存今日晨报。';
  return `Planner 未选择该 skill；用户指令：${params.userQuery.slice(0, 120)}`;
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
  return EXECUTIVE_SKILL_REGISTRY.map((skill) => {
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
        : '本轮动态 planner 生成的步骤。',
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
  plannerError?: string;
}): ExecutiveTurnPlan {
  const updateBriefing = shouldUpdateBriefing(params.userQuery);
  const useWebSearch = shouldUseExternalWeb(params.userQuery);
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
  if (params.context.integrationProviders.has('XIAOHONGSHU') && /小红书|社媒|内容|竞品|趋势/.test(params.userQuery)) {
    skills.push('xiaohongshu_insights');
    steps.push(getExecutivePlannerStepDefinition('call_xiaohongshu_agent'));
  }
  if (params.context.integrationProviders.has('GMAIL') && /邮件|邮箱|客户|投资人|外部沟通|待办/.test(params.userQuery)) {
    skills.push('gmail_insights');
    steps.push(getExecutivePlannerStepDefinition('call_gmail_agent'));
  }
  if (params.context.integrationProviders.has('FEISHU') && /飞书|内部|团队|项目|进展|待办/.test(params.userQuery)) {
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
    objective: updateBriefing ? '更新今日晨报' : '回答用户问题并按需调用可用 skill',
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
          objective: updateBriefing ? '更新今日晨报' : params.userQuery,
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
  const useWebSearch =
    typeof parsed.useWebSearch === 'boolean' ? parsed.useWebSearch : shouldUseExternalWeb(userQuery);
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
      : fallbackExecutivePlan({ userQuery, context }).objective;
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
  const availableSkills = EXECUTIVE_SKILL_REGISTRY.map((skill) => ({
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
        '你是总裁秘书Momo的动态planner。',
        '每轮都要根据用户指令、已雇佣AI员工、可用skill和权限生成本轮执行计划。',
        '不要输出固定全量能力清单；只输出本轮真正需要执行或需要说明不可用的步骤。',
        '如果选择 web_search，必须根据总裁秘书system prompt / 用户偏好规划有目的的搜索范围，不要泛搜。',
        '只输出JSON，不要输出markdown。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        userQuery: params.userQuery,
        executiveSystemPrompt: params.executiveSystemPrompt || '',
        webSearchPolicy: buildWebSearchIntent(params.userQuery, params.executiveSystemPrompt),
        availableSkills,
        accountContext: {
          hasWechatSources: params.context.hasWechatSources,
          integrations: Array.from(params.context.integrationProviders),
          hiredTeams: Array.from(params.context.hiredTeamKeys),
          internalFacts: params.context.internalFacts,
        },
        outputSchema: {
          objective: 'string',
          updateBriefing: 'boolean',
          useWebSearch: 'boolean',
          skills: ['web_search|wechat_articles|xiaohongshu_insights|gmail_insights|feishu_insights|internal_briefing|persist_briefing|chat_reply'],
          skillDecisions: [
            {
              skillId: 'web_search|wechat_articles|xiaohongshu_insights|gmail_insights|feishu_insights|internal_briefing|persist_briefing|chat_reply',
              available: 'boolean',
              selected: 'boolean',
              reason: '为什么本轮选择或不选择这个 skill，尤其要说明 web_search 未选择的原因',
            },
          ],
          wechatTaskSpec: {
            objective: '微信agent需要搜集整理的信息目标',
            sourceSelectionCriteria: ['用于筛选公众号画像的主题/领域/关键词/排除偏好'],
            returnFormat: {
              sections: ['核心结论', '证据文章', '机会/风险', '建议动作'],
              instructions: '微信agent必须按此格式返回给晨报秘书，方便秘书合并其他渠道',
            },
          },
          steps: [
            {
              id: 'short_snake_case',
              title: '中文步骤标题',
              description: '为什么本轮需要这个步骤',
              skillId: 'optional skill id',
              agentType: 'optional subagent type',
            },
          ],
        },
      }),
    },
  ];

  try {
    const raw = await createJsonChatCompletion(
      messages,
      getOpenRouterModel('EXECUTIVE_PLANNER'),
      { maxTokens: 12000 }
    );
    return normalizeExecutivePlan(raw, params.context, params.userQuery, params.executiveSystemPrompt);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'planner generation failed';
    return fallbackExecutivePlan({
      userQuery: params.userQuery,
      context: params.context,
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
  const internalFacts = [
    `已接入集成：${integrations.map((item) => item.provider).join('、') || '无'}`,
    `已录入公众号：${wechatSources.map((item) => item.displayName).join('、') || '无'}`,
    `数字分身数量：${avatars.length}`,
    `已雇佣团队：${Array.from(hiredTeamKeys).join('、') || '无'}`,
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
      return `${index + 1}. ${item.title}：${item.summary}（${source}）`;
    })
    .join('\n');

  return {
    ...briefing,
    headline: suffix ? `${briefing.headline} ${suffix}` : briefing.headline,
    externalInsights: [
      {
        category: '子Agent更新',
        content,
        source: '总裁秘书Orchestrator',
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
        '你是总裁秘书Momo的晨报生成器。',
        '下面的“总裁秘书system prompt / 用户偏好”是业务偏好和用户倾向的唯一来源。',
        '是否过滤、保留多少、哪些主题重要、如何排序，都必须从总裁秘书system prompt和用户当前命令中读取；不要添加代码预设的业务主题偏好。',
        '根据内部数据、子agent结果和显式联网搜索结果，生成一份面向创始人的今日晨报。',
        '如果子agent结果中包含 WEB_SEARCH，请只使用这些已记录的搜索结果，不要自行发起隐式搜索。',
        '如果总裁秘书system prompt要求不要二次过滤或要求保留子agent结果，你必须遵守；否则只按system prompt和用户命令指定的规则处理。',
        '必须把来源和不确定性说明清楚。',
        '输出中文，结构清晰，必须围绕行业动态、技术趋势、竞品监控三个模块给出重点、证据来源和建议行动。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `总裁秘书system prompt / 用户偏好：\n${input.executiveSystemPrompt}`,
        `用户命令：${input.userQuery}`,
        `是否需要外部互联网搜索：${input.useWeb ? '是' : '否'}`,
        `联网搜索意图：\n${buildWebSearchIntent(input.userQuery, input.executiveSystemPrompt)}`,
        `基础晨报：${JSON.stringify(input.briefing)}`,
        `内部数据：\n${input.internalFacts.join('\n')}`,
        `子agent结果：${JSON.stringify(
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

  return createChatCompletion(messages, getOpenRouterModel('EXECUTIVE'), { enableWebTools: false });
}

function fallbackSummary(briefing: ExecutiveDailyBriefing, subagentResults: AgentRunResult[]) {
  const lines = [
    briefing.headline,
    ...briefing.externalInsights.map((item) => `${item.category}：${item.content}`),
    ...subagentResults.map((item) => `${item.agentType}：${item.answer}`),
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
  const source = asString(item.source, '总裁秘书Momo').slice(0, 160);
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
    content: `暂无明确${title}，总裁秘书会在下一次更新晨报时继续补充。`,
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
    title: asString(parsed.title, `总裁秘书Momo晨报 ${dateKey()}`).slice(0, 160),
    summary: asString(parsed.summary, '今日晨报已更新。').slice(0, 2400),
    modules: [
      normalizeStructuredModule(modules.industryDynamics, '行业动态'),
      normalizeStructuredModule(modules.technologyTrends, '技术趋势'),
      normalizeStructuredModule(modules.competitorMonitoring, '竞品监控'),
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
  const items = Array.isArray(parsed.items)
    ? parsed.items
        .map(normalizeStructuredItem)
        .filter((item): item is StructuredBriefingItem => Boolean(item))
        .slice(0, STRUCTURED_AGENT_ITEM_LIMIT)
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
    title: asString(parsed.title, `总裁秘书Momo晨报 ${dateKey()}`).slice(0, 160),
    summary: asString(parsed.summary, '今日晨报已更新。').slice(0, 2400),
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
    detail: `${input.module.title}结构化子 agent 正在整理候选素材。`,
    payload: { sourceCount: input.sources.length },
  });

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        `你是总裁秘书Momo的晨报结构化子agent，只负责“${input.module.title}”模块。`,
        '业务偏好、是否过滤、是否保留所有信息、排序规则，都必须从晨报秘书system prompt和用户当前命令中读取；不要添加代码预设的业务主题偏好。',
        '如果晨报秘书system prompt要求不要二次过滤或要求保留子agent结果，你必须遵守。',
        `你只能输出“${input.module.title}”模块，不要输出其他模块。`,
        '不要编造，不要引入候选素材之外的信息；必须保留来源和URL。',
        '只输出严格JSON，不要输出markdown或解释。',
        '必须严格遵守 user message 中的 outputSchema，不得新增、删除、改名字段。',
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
          `只输出${input.module.title}模块`,
          `items最多${STRUCTURED_AGENT_ITEM_LIMIT}条`,
          '每个summary不超过160字',
          'content使用一到三段中文，不要过长',
          '不要复制大段原文',
          '如果同一信息同时适合多个模块，请只在本模块确有商业意义时保留',
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
      detail: `${input.module.title}结构化完成，返回 ${structuredModule.items.length} 条。`,
      payload: { itemCount: structuredModule.items.length },
    });
    return structuredModule;
  } catch (error) {
    const detail = error instanceof Error ? error.message : `${input.module.title} module structure failed`;
    await emitPlannerStep(input.onPlannerEvent, stepId, 'ERROR', { error: detail });
    throw new Error(`${input.module.title}结构化失败：${detail}`);
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
    detail: '晨报聚合 agent 正在校验三个模块并生成标题与总述。',
    payload: {
      moduleItemCounts: input.modules.map((module) => ({ title: module.title, itemCount: module.items.length })),
    },
  });

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是总裁秘书Momo的晨报聚合agent。',
        '你会收到三个模块结构化子agent的结果。你只负责校验整体一致性，并生成最终晨报title和summary。',
        '不要重写items，不要删除items，不要新增事实，不要二次过滤。',
        '如果发现模块内容有轻微表达问题，只在summary中概括修正；items由系统按子agent结果原样装配。',
        '只输出严格JSON，不要输出markdown或解释。',
        '必须严格遵守 user message 中的 outputSchema，不得新增、删除、改名字段。',
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
      detail: '晨报聚合 agent 已生成标题与总述。',
      payload: { title: result.title },
    });
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'structured briefing aggregation failed';
    await emitPlannerStep(input.onPlannerEvent, 'aggregate_structured_briefing', 'ERROR', { error: detail });
    throw new Error(`结构化晨报聚合失败：${detail}`);
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
      detail: '总裁秘书正在并行调用三个结构化子 agent，并由聚合 agent 校验输出。',
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
      detail: '三个结构化子 agent 与聚合 agent 已完成，最终晨报 JSON 已通过校验。',
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
    throw new Error(`结构化晨报 JSON 生成失败：${detail}`);
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
        title: '总览',
        content: input.briefing.headline,
      },
      ...structured.modules.map((section) => ({
        title: section.title,
        content: section.content,
        items: section.items.map((item) => ({
          category: section.title,
          title: item.title,
          summary: item.whyItMatters ? `${item.summary}\n为什么重要：${item.whyItMatters}` : item.summary,
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
    detail: '正在读取账户数据和已雇佣的 AI 员工。',
  });
  const context = await loadExecutiveContext(params.investorId);
  if (!context) {
    await emitPlannerStep(params.onPlannerEvent, 'load_context', 'ERROR', {
      error: 'Investor not found',
    });
    return null;
  }
  await emitPlannerStep(params.onPlannerEvent, 'load_context', 'SUCCESS', {
    detail: '账户上下文已加载。',
    payload: {
      hasWechatSources: context.hasWechatSources,
      integrations: Array.from(context.integrationProviders),
      hiredTeams: Array.from(context.hiredTeamKeys),
    },
  });

  await emitPlannerStep(params.onPlannerEvent, 'plan_subagents', 'RUNNING', {
    detail: '正在由总裁秘书动态规划本轮要调用的 skill 和子 agent。',
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
      `本轮目标：${plan.objective}`,
      `Planner来源：${plan.plannerSource}`,
      plan.plannerError ? `Planner降级原因：${plan.plannerError}` : '',
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
  const useWeb = plan.useWebSearch || hasSkill(plan, 'web_search');
  const webSearchIntent = buildWebSearchIntent(params.userQuery, params.executiveSystemPrompt);
  const webSearchDecision = plan.skillDecisions.find((item) => item.skillId === 'web_search');

  if (!useWeb) {
    await emitPlannerStep(params.onPlannerEvent, 'call_web_search', 'SKIPPED', {
      detail: webSearchDecision?.reason || 'Planner 未选择联网搜索助手。',
      payload: { selected: false, decision: webSearchDecision },
    });
  }

  if (includeWechat) {
    await emitPlannerStep(params.onPlannerEvent, 'call_wechat_agent', 'RUNNING', {
      detail: '正在调用微信公众号助手抓取文章、正文和指标。',
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
            detail: `微信公众号助手完成，返回 ${result.briefingItems.length} 条可合并信息。`,
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
        detail: 'Planner 选择了微信公众号助手，但当前账户没有可用公众号源。',
      });
    }
  }

  if (hasSkill(plan, 'xiaohongshu_insights')) {
    calledAgents.push({ agentType: 'XIAOHONGSHU', status: 'SKIPPED', reason: 'subagent runner not migrated yet' });
    await emitPlannerStep(params.onPlannerEvent, 'call_xiaohongshu_agent', 'SKIPPED', {
      detail: context.integrationProviders.has('XIAOHONGSHU')
        ? 'Planner 选择了小红书助手，但子 agent runner 尚未迁移。'
        : 'Planner 选择了小红书助手，但当前账户没有小红书集成。',
    });
  }
  if (hasSkill(plan, 'gmail_insights')) {
    calledAgents.push({ agentType: 'GMAIL', status: 'SKIPPED', reason: 'subagent runner not migrated yet' });
    await emitPlannerStep(params.onPlannerEvent, 'call_gmail_agent', 'SKIPPED', {
      detail: context.integrationProviders.has('GMAIL')
        ? 'Planner 选择了邮件助手，但子 agent runner 尚未迁移。'
        : 'Planner 选择了邮件助手，但当前账户没有 Gmail 集成。',
    });
  }
  if (hasSkill(plan, 'feishu_insights')) {
    calledAgents.push({ agentType: 'FEISHU', status: 'SKIPPED', reason: 'subagent runner not migrated yet' });
    await emitPlannerStep(params.onPlannerEvent, 'call_feishu_agent', 'SKIPPED', {
      detail: context.integrationProviders.has('FEISHU')
        ? 'Planner 选择了飞书助手，但子 agent runner 尚未迁移。'
        : 'Planner 选择了飞书助手，但当前账户没有飞书集成。',
    });
  }

  if (useWeb) {
    await emitPlannerStep(params.onPlannerEvent, 'call_web_search', 'RUNNING', {
      detail: '正在并行调用联网搜索助手，通过 OpenRouter 原生 web tool 检索和整理公开网页信息。',
      payload: { webSearchIntent },
    });
    subagentTasks.push(
      runWebSearchAgent({
        investorId: params.investorId,
        userQuery: params.userQuery,
        mode: 'briefing',
        context: {
          webSearchIntent,
          subagentResults: [],
          taskSpec: {
            objective: `根据总裁秘书要求进行联网搜索，补充晨报所需外部公开信息：${plan.objective}`,
            sourceSelectionCriteria: [
              params.userQuery,
              params.executiveSystemPrompt || '',
            ].filter(Boolean),
            timeWindow: {
              type: 'rolling_hours',
              hours: 24,
              endAt: new Date().toISOString(),
            },
            returnFormat: {
              sections: ['行业动态', '技术趋势', '竞品监控'],
              instructions:
                '按三个模块返回结构化结果；每条信息必须有来源，能拿到URL时必须提供URL。本任务与其他信息源助手并行执行，不等待微信公众号助手结果。业务偏好、搜索范围和筛选/保留策略必须以晨报秘书system prompt为准。',
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
            detail: `联网搜索助手完成，返回 ${webResult.briefingItems.length} 条可合并信息。`,
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
          throw new Error(`联网搜索助手失败：${detail}`);
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
    throw new Error(`子 agent 执行失败：${subagentErrors.join('；')}`);
  }

  await emitPlannerStep(params.onPlannerEvent, 'merge_results', 'RUNNING', {
    detail: '正在把子 agent 结果合并进晨报上下文。',
  });
  const briefingItems = subagentResults.flatMap((item) => item.briefingItems);
  const mergedBriefing = mergeBriefingWithItems(
    context.baseBriefing,
    briefingItems,
    briefingItems.length > 0 ? `本次晨报已合并 ${briefingItems.length} 条子Agent信息。` : undefined
  );
  await emitPlannerStep(params.onPlannerEvent, 'merge_results', 'SUCCESS', {
    detail: `已合并 ${briefingItems.length} 条子 agent 信息。`,
  });

  let summary = fallbackSummary(mergedBriefing, subagentResults);
  if (plan.updateBriefing || subagentResults.length > 0 || useWeb) {
    try {
      await emitPlannerStep(params.onPlannerEvent, 'generate_briefing_summary', 'RUNNING', {
        detail: useWeb
          ? '正在基于已记录的联网搜索助手结果生成摘要。'
          : '正在基于现有上下文生成摘要。',
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
        detail: plan.updateBriefing ? '晨报摘要已生成。' : '本轮信息摘要已生成。',
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'summary generation failed';
      await emitPlannerStep(params.onPlannerEvent, 'generate_briefing_summary', 'ERROR', {
        error: detail,
      });
      throw new Error(`晨报摘要生成失败：${detail}`);
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
      detail: '正在保存今日晨报。',
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
      detail: `今日晨报已保存：${document.dateKey}。`,
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
