import { prisma } from '@/lib/prisma';
import { createChatCompletion, createJsonChatCompletion, type ChatMessage } from '@/lib/openrouter';
import { runWechatAgent } from '@/lib/agents/wechat-agent';
import type { AgentBriefingItem, AgentRunResult, AgentRunToolCall } from '@/lib/agents/types';
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
  steps: ExecutivePlannerStepDefinition[];
  plannerSource: 'MODEL' | 'FALLBACK';
  plannerError?: string;
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
    description: '通过 OpenRouter 模型的 web_search/web_fetch 能力检索和打开网页，补充最新外部信息。',
    implemented: true,
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
      title: '使用联网搜索能力',
      description: '在生成摘要时允许模型搜索和打开网页以获取最新外部信息。',
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

function hasSkill(plan: ExecutiveTurnPlan, skillId: ExecutiveSkillId) {
  return plan.skills.includes(skillId);
}

function normalizeSkillId(value: unknown): ExecutiveSkillId | null {
  if (typeof value !== 'string') return null;
  const allowed = new Set<ExecutiveSkillId>(EXECUTIVE_SKILL_REGISTRY.map((skill) => skill.skillId));
  return allowed.has(value as ExecutiveSkillId) ? (value as ExecutiveSkillId) : null;
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
    steps,
    plannerSource: 'FALLBACK',
    plannerError: params.plannerError,
  };
}

function normalizeExecutivePlan(raw: string, context: LoadedExecutiveContext, userQuery: string): ExecutiveTurnPlan {
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
  }
  if (updateBriefing) steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('persist_briefing'));
  steps = ensurePlanStep(steps, getExecutivePlannerStepDefinition('generate_reply'));

  return {
    objective:
      typeof parsed.objective === 'string' && parsed.objective.trim()
        ? parsed.objective.trim().slice(0, 160)
        : fallbackExecutivePlan({ userQuery, context }).objective,
    updateBriefing,
    useWebSearch,
    skills: normalizedSkills,
    steps: steps.slice(0, 12),
    plannerSource: 'MODEL',
  };
}

async function planExecutiveTurn(params: {
  userQuery: string;
  context: LoadedExecutiveContext;
}): Promise<ExecutiveTurnPlan> {
  const availableSkills = EXECUTIVE_SKILL_REGISTRY.map((skill) => ({
    skillId: skill.skillId,
    name: skill.name,
    description: skill.description,
    implemented: skill.implemented,
    available:
      skill.skillId === 'wechat_articles'
        ? params.context.hasWechatSources
        : skill.skillId === 'xiaohongshu_insights'
          ? params.context.integrationProviders.has('XIAOHONGSHU')
          : skill.skillId === 'gmail_insights'
            ? params.context.integrationProviders.has('GMAIL')
            : skill.skillId === 'feishu_insights'
              ? params.context.integrationProviders.has('FEISHU')
              : true,
  }));

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是总裁秘书Momo的动态planner。',
        '每轮都要根据用户指令、已雇佣AI员工、可用skill和权限生成本轮执行计划。',
        '不要输出固定全量能力清单；只输出本轮真正需要执行或需要说明不可用的步骤。',
        '只输出JSON，不要输出markdown。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        userQuery: params.userQuery,
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
      process.env.OPENROUTER_MODEL_EXECUTIVE_PLANNER || process.env.OPENROUTER_MODEL_EXECUTIVE || 'openai/gpt-5.4'
    );
    return normalizeExecutivePlan(raw, params.context, params.userQuery);
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
    include: {
      integrations: {
        include: {
          snapshots: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
      wechatSources: {
        orderBy: { updatedAt: 'desc' },
      },
      avatars: {
        include: {
          chats: {
            select: {
              needsInvestorReview: true,
              qualificationStatus: true,
            },
          },
        },
      },
      teamHires: {
        select: {
          teamKey: true,
          status: true,
        },
      },
      agentThreads: {
        select: { agentType: true },
      },
    },
  });

  if (!investor) return null;

  const hiredTeamKeys = resolveHiredTeamKeys({
    teamHires: investor.teamHires,
    fallback: {
      integrationCount: investor.integrations.length,
      wechatSourceCount: investor.wechatSources.length,
      avatarCount: investor.avatars.length,
      agentTypes: investor.agentThreads.map((thread) => thread.agentType),
    },
  });

  const baseBriefing = buildExecutiveDailyBriefing({
    integrations: investor.integrations,
    wechatSources: investor.wechatSources,
    avatars: investor.avatars,
    hiredTeamKeys: Array.from(hiredTeamKeys),
  });

  const integrationProviders = new Set(investor.integrations.map((item) => item.provider));
  const internalFacts = [
    `已接入集成：${investor.integrations.map((item) => item.provider).join('、') || '无'}`,
    `已录入公众号：${investor.wechatSources.map((item) => item.displayName).join('、') || '无'}`,
    `数字分身数量：${investor.avatars.length}`,
    `已雇佣团队：${Array.from(hiredTeamKeys).join('、') || '无'}`,
  ];

  return {
    baseBriefing,
    hiredTeamKeys,
    integrationProviders,
    hasWechatSources: investor.wechatSources.length > 0,
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
    .slice(0, 10)
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
        '根据内部数据、子agent结果和必要的外部互联网搜索，生成一份面向创始人的今日晨报。',
        '如果启用了联网工具，你可以搜索最新行业动态，但必须把不确定性说明清楚。',
        '输出中文，结构清晰，必须围绕行业动态、技术趋势、竞品监控三个模块给出重点、证据来源和建议行动。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `用户命令：${input.userQuery}`,
        `是否需要外部互联网搜索：${input.useWeb ? '是' : '否'}`,
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

  return createChatCompletion(messages, process.env.OPENROUTER_MODEL_EXECUTIVE || 'openai/gpt-5.4');
}

function fallbackSummary(briefing: ExecutiveDailyBriefing, subagentResults: AgentRunResult[]) {
  const lines = [
    briefing.headline,
    ...briefing.externalInsights.map((item) => `${item.category}：${item.content}`),
    ...subagentResults.map((item) => `${item.agentType}：${item.answer}`),
  ];
  return lines.join('\n\n');
}

function itemText(item: AgentBriefingItem) {
  return `${item.title} ${item.summary} ${item.source}`.toLowerCase();
}

function classifyBriefingItem(item: AgentBriefingItem) {
  const text = itemText(item);
  if (
    /技术|大模型|模型|agent|coding|代码|开发|编程|api|开源|框架|架构|推理|算力|工具|研发|engineering|developer|model/.test(
      text
    )
  ) {
    return '技术趋势';
  }
  if (
    /竞品|竞争|产品|发布|上线|融资|收购|估值|openai|anthropic|google|meta|cursor|devin|manus|字节|腾讯|阿里|百度|公司|创业/.test(
      text
    )
  ) {
    return '竞品监控';
  }
  return '行业动态';
}

function renderModuleContent(items: AgentBriefingItem[], fallback: string) {
  if (items.length === 0) return fallback;
  return items
    .slice(0, 6)
    .map((item, index) => {
      const source = item.url ? `${item.source} ${item.url}` : item.source;
      return `${index + 1}. ${item.title}：${item.summary}（${source}）`;
    })
    .join('\n');
}

function buildBriefingModules(input: {
  summary: string;
  briefing: ExecutiveDailyBriefing;
  sources: AgentBriefingItem[];
}) {
  const grouped: Record<'行业动态' | '技术趋势' | '竞品监控', AgentBriefingItem[]> = {
    行业动态: [],
    技术趋势: [],
    竞品监控: [],
  };

  for (const item of input.sources) {
    grouped[classifyBriefingItem(item)].push(item);
  }

  return [
    {
      title: '行业动态',
      content: renderModuleContent(
        grouped.行业动态,
        input.briefing.externalInsights.map((item) => `${item.category}：${item.content}`).join('\n\n') ||
          '暂无新的行业动态，点击“更新晨报”后总裁秘书会重新汇总。'
      ),
      items: grouped.行业动态,
    },
    {
      title: '技术趋势',
      content: renderModuleContent(
        grouped.技术趋势,
        input.summary || '暂无明确技术趋势，点击“更新晨报”后会重新检索并整理 AI agent、开发工具和技术路线信息。'
      ),
      items: grouped.技术趋势,
    },
    {
      title: '竞品监控',
      content: renderModuleContent(
        grouped.竞品监控,
        '暂无明确竞品信号，点击“更新晨报”后会重新检查产品发布、融资、公司动态和竞争格局。'
      ),
      items: grouped.竞品监控,
    },
  ];
}

function buildDocument(input: {
  query: string;
  briefing: ExecutiveDailyBriefing;
  summary: string;
  subagentResults: AgentRunResult[];
  calledAgents: ExecutiveBriefingDocument['calledAgents'];
}): ExecutiveBriefingDocument {
  const sources = input.subagentResults.flatMap((item) => item.briefingItems);
  const modules = buildBriefingModules({
    summary: input.summary,
    briefing: input.briefing,
    sources,
  });
  return {
    dateKey: dateKey(),
    title: `总裁秘书Momo晨报 ${dateKey()}`,
    summary: input.summary,
    sections: [
      {
        title: '总览',
        content: input.briefing.headline,
      },
      ...modules,
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
      updateBriefing: plan.updateBriefing,
      useWebSearch: plan.useWebSearch,
    },
  });

  const calledAgents: ExecutiveBriefingDocument['calledAgents'] = [];
  const subagentTasks: Array<Promise<AgentRunResult>> = [];
  const includeWechat = hasSkill(plan, 'wechat_articles') && context.hasWechatSources;
  const useWeb = plan.useWebSearch || hasSkill(plan, 'web_search');

  if (useWeb) {
    await emitPlannerStep(params.onPlannerEvent, 'call_web_search', 'SUCCESS', {
      detail: '本轮已启用模型联网搜索/网页读取能力，实际搜索会在摘要或回复生成时由模型执行。',
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

  const settled = await Promise.allSettled(subagentTasks);
  const subagentResults: AgentRunResult[] = [];
  for (const item of settled) {
    if (item.status === 'fulfilled') {
      subagentResults.push(item.value);
    } else {
      calledAgents.push({
        agentType: 'UNKNOWN',
        status: 'ERROR',
        reason: item.reason instanceof Error ? item.reason.message : 'subagent failed',
      });
    }
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
        detail: useWeb ? '正在生成摘要，并允许模型使用联网能力。' : '正在基于现有上下文生成摘要。',
      });
      summary = await buildBriefingSummary({
        userQuery: params.userQuery,
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
        error: `${detail}。已降级使用确定性摘要。`,
      });
      summary = fallbackSummary(mergedBriefing, subagentResults);
    }
  }

  const document = buildDocument({
    query: params.userQuery,
    briefing: mergedBriefing,
    summary,
    subagentResults,
    calledAgents,
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
