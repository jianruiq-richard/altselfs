import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { createChatCompletion, type ChatMessage } from '@/lib/openrouter';
import {
  appendToolCall,
  appendThreadMessage,
  ensureThread,
  getLatestThreadWithMessages,
  toClientMessages,
} from '@/lib/agent-session';
import { buildExecutiveDailyBriefing, type ExecutiveDailyBriefing } from '@/lib/executive-office';
import {
  getExecutivePlannerDefinition,
  getExecutivePlannerStepDefinition,
  getTodayExecutiveBriefing,
  type ExecutivePlannerEvent,
  type ExecutivePlannerStepDefinition,
  type ExecutivePlannerTraceItem,
  updateTodayExecutiveBriefing,
} from '@/lib/agents/executive-orchestrator';
import { resolveHiredTeamKeys } from '@/lib/team-library';
import { EXECUTIVE_MOMO_SYSTEM_PROMPT } from '@/lib/prompts/executive-momo';

const EXECUTIVE_AGENT_TYPE = 'EXECUTIVE';
const MAX_SYSTEM_PROMPT_LENGTH = 30000;

type ClientMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ExecutiveTurnResult = {
  status: number;
  body: Record<string, unknown>;
};

type ExecutiveExecutionSnapshot = {
  planner: ExecutivePlannerStepDefinition[];
  plannerTrace: ExecutivePlannerTraceItem[];
  document?: unknown;
  subagents?: unknown;
  toolCalls?: unknown;
  recentToolCalls?: unknown;
};

function buildBriefingContext(briefing: {
  date: string;
  generatedTime: string;
  headline: string;
  departmentOverview: Array<{ department: string; status: string; summary: string; progress: number }>;
  externalInsights: Array<{ category: string; content: string; source: string }>;
  priorityTasks: Array<{ priority: 'high' | 'medium' | 'low'; task: string; deadline: string; assignedBy: string }>;
}) {
  const departmentLines = briefing.departmentOverview
    .map((item, index) => `${index + 1}. ${item.department} | ${item.status} | 进度${item.progress}% | ${item.summary}`)
    .join('\n');
  const insightLines = briefing.externalInsights
    .map((item, index) => `${index + 1}. ${item.category} | ${item.source} | ${item.content}`)
    .join('\n');
  const taskLines = briefing.priorityTasks
    .map((item, index) => `${index + 1}. ${item.priority.toUpperCase()} | ${item.task} | 截止${item.deadline} | 指派${item.assignedBy}`)
    .join('\n');

  return [
    `晨报日期：${briefing.date}`,
    `晨报更新时间：${briefing.generatedTime}`,
    `晨报headline：${briefing.headline}`,
    '部门概览：',
    departmentLines || '无',
    '外界信息精选：',
    insightLines || '无',
    '重点事项：',
    taskLines || '无',
  ].join('\n');
}

function compactForModel(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => compactForModel(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
      out[key] = compactForModel(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

function buildExecutionContext(snapshot?: ExecutiveExecutionSnapshot | null) {
  if (!snapshot) return '暂无执行记录。';
  return JSON.stringify(compactForModel(snapshot), null, 2);
}

async function loadRecentExecutionRecords(threadId: string) {
  const toolCalls = await prisma.agentToolCall.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: {
      toolName: true,
      status: true,
      toolArgs: true,
      toolResult: true,
      createdAt: true,
    },
  });

  return toolCalls.map((item) => ({
    toolName: item.toolName,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
    toolArgs: compactForModel(item.toolArgs),
    toolResult: compactForModel(item.toolResult),
  }));
}

async function generateExecutiveReply(
  messages: ClientMessage[],
  briefing: ExecutiveDailyBriefing,
  systemPrompt: string,
  executionSnapshot?: ExecutiveExecutionSnapshot | null
) {
  const contextPrompt = [
    '下面是当前可用的业务上下文。只在用户明确需要时才引用，不要机械反复提及。',
    buildBriefingContext(briefing),
    '下面是本轮和最近几轮真实执行记录。它是你回答“刚才调用了什么、执行了什么、哪里报错、拿到了什么结果”的唯一依据。',
    buildExecutionContext(executionSnapshot),
    '输出约束补充：',
    '1) 回复使用中文口语化表达。',
    '2) 不要使用 markdown 格式符号。',
    '3) 一次最多提出一个问题；不要连续三轮都用问句。',
    '4) 默认优先共情、复述、安抚。',
    '5) 如果用户要求复盘执行过程，必须区分：计划了什么、实际执行了什么、跳过了什么、哪里报错、拿到哪些中间结果；不要编造未发生的调用。',
  ].join('\n\n');

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: contextPrompt },
    ...messages.map((item) => ({ role: item.role, content: item.content })),
  ];

  const model = process.env.OPENROUTER_MODEL_EXECUTIVE || 'openai/gpt-5.4';
  const reply = await createChatCompletion(chatMessages, model);
  return reply.trim();
}

function normalizeSystemPrompt(input: unknown) {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, MAX_SYSTEM_PROMPT_LENGTH);
}

async function getExecutiveAgentConfig(investorId: string) {
  const config = await prisma.investorAgentConfig.findUnique({
    where: {
      investorId_agentType: {
        investorId,
        agentType: EXECUTIVE_AGENT_TYPE,
      },
    },
  });

  const customPrompt = config?.systemPrompt?.trim() || '';
  return {
    customPrompt,
    systemPrompt: customPrompt || EXECUTIVE_MOMO_SYSTEM_PROMPT,
    defaultSystemPrompt: EXECUTIVE_MOMO_SYSTEM_PROMPT,
  };
}

function normalizeMessages(raw: unknown): ClientMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const role = (item as { role?: string })?.role;
      const content = (item as { content?: string })?.content;
      if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()) {
        return { role, content: content.trim() } as ClientMessage;
      }
      return null;
    })
    .filter(Boolean) as ClientMessage[];
}

async function loadBriefing(investorId: string) {
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

  return buildExecutiveDailyBriefing({
    integrations: investor.integrations,
    wechatSources: investor.wechatSources,
    avatars: investor.avatars,
    hiredTeamKeys: Array.from(hiredTeamKeys),
  });
}

async function runExecutiveAssistantTurn(params: {
  investorId: string;
  threadId?: string | null;
  messages: ClientMessage[];
  onPlannerEvent?: (event: ExecutivePlannerEvent) => void | Promise<void>;
}): Promise<ExecutiveTurnResult> {
  const plannerTrace: ExecutivePlannerTraceItem[] = [];
  let currentPlanner: ExecutivePlannerStepDefinition[] = getExecutivePlannerDefinition();
  const emitPlannerEvent = async (event: ExecutivePlannerEvent) => {
    if (event.type === 'planner' && event.steps.length > 0) {
      currentPlanner = event.steps;
    }
    if (event.type === 'step') {
      plannerTrace.push(event.step);
    }
    await params.onPlannerEvent?.(event);
  };

  await emitPlannerEvent({
    type: 'planner',
    steps: getExecutivePlannerDefinition(),
  });

  const latest = params.messages[params.messages.length - 1];
  const [loadedBriefing, promptConfig] = await Promise.all([
    loadBriefing(params.investorId),
    getExecutiveAgentConfig(params.investorId),
  ]);
  if (!loadedBriefing) return { status: 404, body: { error: 'Investor not found', plannerTrace } };
  let briefing = loadedBriefing;

  const thread = await ensureThread({
    investorId: params.investorId,
    agentType: EXECUTIVE_AGENT_TYPE,
    threadId: params.threadId || null,
  });

  await appendThreadMessage({
    threadId: thread.id,
    role: 'USER',
    content: latest.content,
  });

  let persistedBriefing: Awaited<ReturnType<typeof getTodayExecutiveBriefing>> | null = null;
  let executionSnapshot: ExecutiveExecutionSnapshot = {
    planner: currentPlanner,
    plannerTrace,
  };

  try {
    const updateResult = await updateTodayExecutiveBriefing({
      investorId: params.investorId,
      userQuery: latest.content,
      onPlannerEvent: emitPlannerEvent,
    });
    if (updateResult) {
      briefing = updateResult.briefing;
      persistedBriefing = await getTodayExecutiveBriefing(params.investorId);
      const subagents = updateResult.subagentResults.map((item) => ({
        agentType: item.agentType,
        answer: item.answer,
        briefingItems: item.briefingItems,
        debug: item.debug,
      }));
      executionSnapshot = {
        planner: currentPlanner,
        plannerTrace,
        document: updateResult.document,
        subagents,
        toolCalls: updateResult.toolCalls,
      };
      await appendToolCall({
        threadId: thread.id,
        toolName: 'executive_dynamic_planner',
        status: 'SUCCESS',
        toolArgs: { userQuery: latest.content },
        toolResult: {
          document: updateResult.document,
          plannerTrace,
          subagents,
          toolCalls: updateResult.toolCalls,
        },
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    await appendToolCall({
      threadId: thread.id,
      toolName: 'executive_dynamic_planner',
      status: 'ERROR',
      toolArgs: { userQuery: latest.content },
      toolResult: { error: detail, plannerTrace },
    });
    briefing = {
      ...briefing,
      externalInsights: [
        {
          category: '总裁秘书规划',
          content: `本轮动态规划执行失败：${detail}`,
          source: '总裁秘书Orchestrator',
        },
        ...briefing.externalInsights,
      ],
    };
  }

  executionSnapshot = {
    ...executionSnapshot,
    planner: currentPlanner,
    plannerTrace,
    recentToolCalls: await loadRecentExecutionRecords(thread.id),
  };

  await emitPlannerEvent({
    type: 'step',
    step: {
      ...getExecutivePlannerStepDefinition('generate_reply'),
      status: 'RUNNING',
      detail: '正在生成总裁秘书回复。',
      timestamp: new Date().toISOString(),
    },
  });

  let reply = '';
  try {
    reply = await generateExecutiveReply(params.messages, briefing, promptConfig.systemPrompt, executionSnapshot);
    await emitPlannerEvent({
      type: 'step',
      step: {
        ...getExecutivePlannerStepDefinition('generate_reply'),
        status: 'SUCCESS',
        detail: '总裁秘书回复已生成。',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[executive-assistant] model generation failed:', error);
    const detail = error instanceof Error ? error.message : 'unknown error';
    await emitPlannerEvent({
      type: 'step',
      step: {
        ...getExecutivePlannerStepDefinition('generate_reply'),
        status: 'ERROR',
        error: detail,
        timestamp: new Date().toISOString(),
      },
    });
    return {
      status: 502,
      body: {
        error: `总裁秘书暂时不可用：${detail}`,
        threadId: thread.id,
        briefing,
        planner: currentPlanner,
        plannerTrace,
        agentConfig: {
          systemPrompt: promptConfig.systemPrompt,
          defaultSystemPrompt: promptConfig.defaultSystemPrompt,
          hasCustomPrompt: Boolean(promptConfig.customPrompt),
        },
      },
    };
  }

  await appendThreadMessage({
    threadId: thread.id,
    role: 'ASSISTANT',
    content: reply,
    meta: {
      executionSnapshot: compactForModel(executionSnapshot),
    },
  });

  return {
    status: 200,
    body: {
      threadId: thread.id,
      reply,
      messages: [...params.messages, { role: 'assistant', content: reply }],
      briefing,
      persistedBriefing,
      planner: currentPlanner,
      plannerTrace,
      agentConfig: {
        systemPrompt: promptConfig.systemPrompt,
        defaultSystemPrompt: promptConfig.defaultSystemPrompt,
        hasCustomPrompt: Boolean(promptConfig.customPrompt),
      },
    },
  };
}

function streamExecutiveAssistantTurn(params: {
  investorId: string;
  threadId?: string | null;
  messages: ClientMessage[];
}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const write = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      void (async () => {
        try {
          const result = await runExecutiveAssistantTurn({
            ...params,
            onPlannerEvent: write,
          });
          write({
            type: 'final',
            status: result.status,
            data: result.body,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'unknown error';
          write({
            type: 'final',
            status: 500,
            data: { error: `AI代理执行失败：${detail}` },
          });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export async function GET() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [briefing, promptConfig, persistedBriefing] = await Promise.all([
    loadBriefing(investor.id),
    getExecutiveAgentConfig(investor.id),
    getTodayExecutiveBriefing(investor.id),
  ]);
  if (!briefing) return NextResponse.json({ error: 'Investor not found' }, { status: 404 });

  let thread = await getLatestThreadWithMessages(investor.id, EXECUTIVE_AGENT_TYPE);
  if (!thread) {
    const created = await ensureThread({
      investorId: investor.id,
      agentType: EXECUTIVE_AGENT_TYPE,
    });
    await appendThreadMessage({
      threadId: created.id,
      role: 'ASSISTANT',
      content: `早上好！我是总裁秘书Momo。\n\n${briefing.headline}\n\n你可以问我：\n1) 各部门工作情况\n2) 今日重点事项\n3) 外界信息变化`,
    });
    thread = await getLatestThreadWithMessages(investor.id, EXECUTIVE_AGENT_TYPE);
  }

  return NextResponse.json({
    threadId: thread?.id || null,
    messages: thread ? toClientMessages(thread.messages) : [],
    briefing,
    persistedBriefing,
    planner: getExecutivePlannerDefinition(),
    agentConfig: {
      systemPrompt: promptConfig.systemPrompt,
      defaultSystemPrompt: promptConfig.defaultSystemPrompt,
      hasCustomPrompt: Boolean(promptConfig.customPrompt),
    },
  });
}

export async function PUT(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { systemPrompt?: unknown; resetToDefault?: boolean } | null;
  const resetToDefault = Boolean(body?.resetToDefault);
  const systemPrompt = resetToDefault ? '' : normalizeSystemPrompt(body?.systemPrompt);

  if (!resetToDefault && !systemPrompt) {
    return NextResponse.json({ error: 'system prompt 不能为空' }, { status: 400 });
  }

  const saved = await prisma.investorAgentConfig.upsert({
    where: {
      investorId_agentType: {
        investorId: investor.id,
        agentType: EXECUTIVE_AGENT_TYPE,
      },
    },
    update: {
      systemPrompt: resetToDefault ? null : systemPrompt,
    },
    create: {
      investorId: investor.id,
      agentType: EXECUTIVE_AGENT_TYPE,
      systemPrompt: resetToDefault ? null : systemPrompt,
    },
  });

  const customPrompt = saved.systemPrompt?.trim() || '';
  return NextResponse.json({
    ok: true,
    agentConfig: {
      systemPrompt: customPrompt || EXECUTIVE_MOMO_SYSTEM_PROMPT,
      defaultSystemPrompt: EXECUTIVE_MOMO_SYSTEM_PROMPT,
      hasCustomPrompt: Boolean(customPrompt),
    },
  });
}

export async function POST(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { messages?: unknown; threadId?: string | null } | null;
  const messages = normalizeMessages(body?.messages);
  const latest = messages[messages.length - 1];
  if (!latest || latest.role !== 'user') {
    return NextResponse.json({ error: '最后一条消息必须是用户消息' }, { status: 400 });
  }

  const turnParams = {
    investorId: investor.id,
    threadId: body?.threadId || null,
    messages,
  };

  if (req.nextUrl.searchParams.get('stream') === '1') {
    return streamExecutiveAssistantTurn(turnParams);
  }

  const result = await runExecutiveAssistantTurn(turnParams);
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { threadId?: string | null } | null;
  const threadId = typeof body?.threadId === 'string' ? body.threadId : '';
  if (!threadId) return NextResponse.json({ ok: true });

  await prisma.agentThread.deleteMany({
    where: {
      id: threadId,
      investorId: investor.id,
      agentType: EXECUTIVE_AGENT_TYPE,
    },
  });

  return NextResponse.json({ ok: true });
}
