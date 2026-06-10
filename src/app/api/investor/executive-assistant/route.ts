import { after, NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { createChatCompletion, getOpenRouterModel, type ChatMessage } from '@/lib/openrouter';
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
const STREAM_HEARTBEAT_INTERVAL_MS = 10000;
const ASYNC_POLL_INTERVAL_MS = 3000;
const ASYNC_RUN_STALE_AFTER_MS = 30 * 60 * 1000;
const ACTIVE_RUN_STATUSES = ['QUEUED', 'RUNNING'] as const;

export const maxDuration = 800;

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

type StoredExecutiveRunRequest = {
  threadId?: string | null;
  messages?: ClientMessage[];
};

const USER_CANCELLED_RUN_ERROR = '用户已强制停止本次执行';
const STALE_RUN_ERROR = '任务已超过 30 分钟未更新，系统已自动终止旧的执行状态。';

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

  const reply = await createChatCompletion(chatMessages, getOpenRouterModel('EXECUTIVE'));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value === undefined ? null : value)) as Prisma.InputJsonValue;
}

function formatRouteError(error: unknown) {
  if (error instanceof Error && error.message) return error.message.slice(0, 500);
  return String(error || 'unknown error').slice(0, 500);
}

function routeErrorResponse(operation: string, error: unknown) {
  const detail = formatRouteError(error);
  console.error(`[executive-assistant] ${operation} failed:`, error);
  return NextResponse.json(
    {
      error: `${operation}失败：${detail}`,
      code: 'EXECUTIVE_ASSISTANT_ROUTE_ERROR',
    },
    { status: 500 }
  );
}

function normalizeStoredPlannerTrace(value: Prisma.JsonValue | null): ExecutivePlannerTraceItem[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[])
    .map((item) => {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') return null;
      const status = typeof item.status === 'string' ? item.status : 'PENDING';
      if (!['PENDING', 'RUNNING', 'SUCCESS', 'ERROR', 'SKIPPED'].includes(status)) return null;
      return {
        id: item.id,
        title: item.title,
        description: typeof item.description === 'string' ? item.description : '',
        agentType: typeof item.agentType === 'string' ? item.agentType : undefined,
        skillId: typeof item.skillId === 'string' ? (item.skillId as ExecutivePlannerTraceItem['skillId']) : undefined,
        status: status as ExecutivePlannerTraceItem['status'],
        detail: typeof item.detail === 'string' ? item.detail : undefined,
        error: typeof item.error === 'string' ? item.error : undefined,
        timestamp: typeof item.timestamp === 'string' ? item.timestamp : '',
        payload: item.payload,
      };
    })
    .filter(Boolean) as ExecutivePlannerTraceItem[];
}

function buildCancelledPlannerTrace(value: Prisma.JsonValue | null) {
  const trace = normalizeStoredPlannerTrace(value);
  const last = trace[trace.length - 1];
  const stopStepId = last?.id || 'generate_reply';
  return [
    ...trace,
    {
      ...getExecutivePlannerStepDefinition(stopStepId),
      status: 'ERROR',
      detail: USER_CANCELLED_RUN_ERROR,
      error: USER_CANCELLED_RUN_ERROR,
      timestamp: new Date().toISOString(),
      payload: {
        cancelledByUser: true,
      },
    },
  ] satisfies ExecutivePlannerTraceItem[];
}

function normalizeStoredRunRequest(value: unknown): StoredExecutiveRunRequest | null {
  if (!isRecord(value)) return null;
  const messages = normalizeMessages(value.messages);
  if (messages.length === 0) return null;
  return {
    threadId: typeof value.threadId === 'string' ? value.threadId : null,
    messages,
  };
}

async function loadBriefing(investorId: string) {
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
    console.error('[executive-assistant] failed to load integration context:', error);
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

  return buildExecutiveDailyBriefing({
    integrations,
    wechatSources,
    avatars,
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
      executiveSystemPrompt: promptConfig.systemPrompt,
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
    return {
      status: 500,
      body: {
        error: `晨报更新失败：${detail}`,
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
      let closed = false;
      const write = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => {
        write({ type: 'heartbeat', timestamp: new Date().toISOString() });
      }, STREAM_HEARTBEAT_INTERVAL_MS);

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
          clearInterval(heartbeat);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // The client may have disconnected after receiving the final event.
            }
          }
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

async function executeExecutiveAssistantRun(runId: string, investorId: string) {
  const claimed = await prisma.executiveAssistantRun.updateMany({
    where: {
      id: runId,
      investorId,
      status: 'QUEUED',
    },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
      error: null,
      planner: toPrismaJson(getExecutivePlannerDefinition()),
      plannerTrace: toPrismaJson([]),
    },
  });
  if (claimed.count === 0) return;

  const run = await prisma.executiveAssistantRun.findUnique({
    where: { id: runId },
    select: { request: true },
  });
  const request = normalizeStoredRunRequest(run?.request);
  if (!request) {
    await prisma.executiveAssistantRun.updateMany({
      where: { id: runId, status: 'RUNNING' },
      data: {
        status: 'ERROR',
        error: '异步任务参数无效',
        completedAt: new Date(),
      },
    });
    return;
  }

  let planner: ExecutivePlannerStepDefinition[] = getExecutivePlannerDefinition();
  const plannerTrace: ExecutivePlannerTraceItem[] = [];
  const persistPlannerEvent = async (event: ExecutivePlannerEvent) => {
    if (event.type === 'planner' && event.steps.length > 0) {
      planner = event.steps;
    }
    if (event.type === 'step') {
      plannerTrace.push(event.step);
    }
    await prisma.executiveAssistantRun.updateMany({
      where: { id: runId, status: 'RUNNING' },
      data: {
        planner: toPrismaJson(planner),
        plannerTrace: toPrismaJson(plannerTrace),
      },
    });
  };

  try {
    const result = await runExecutiveAssistantTurn({
      investorId,
      threadId: request.threadId || null,
      messages: request.messages || [],
      onPlannerEvent: persistPlannerEvent,
    });
    const error = typeof result.body.error === 'string' ? result.body.error : null;
    await prisma.executiveAssistantRun.updateMany({
      where: { id: runId, status: 'RUNNING' },
      data: {
        status: result.status >= 400 ? 'ERROR' : 'SUCCESS',
        result: toPrismaJson(result.body),
        error,
        planner: toPrismaJson(planner),
        plannerTrace: toPrismaJson(plannerTrace),
        completedAt: new Date(),
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    await prisma.executiveAssistantRun.updateMany({
      where: { id: runId, status: 'RUNNING' },
      data: {
        status: 'ERROR',
        error: `AI代理执行失败：${detail}`,
        result: toPrismaJson({ error: `AI代理执行失败：${detail}` }),
        planner: toPrismaJson(planner),
        plannerTrace: toPrismaJson(plannerTrace),
        completedAt: new Date(),
      },
    });
  }
}

async function cancelExecutiveAssistantRun(runId: string, investorId: string) {
  const run = await prisma.executiveAssistantRun.findFirst({
    where: {
      id: runId,
      investorId,
    },
    select: {
      id: true,
      status: true,
      result: true,
      error: true,
      planner: true,
      plannerTrace: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      completedAt: true,
    },
  });

  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  if (!ACTIVE_RUN_STATUSES.includes(run.status as (typeof ACTIVE_RUN_STATUSES)[number])) {
    return NextResponse.json(serializeExecutiveAssistantRun(run));
  }

  const plannerTrace = buildCancelledPlannerTrace(run.plannerTrace);
  const result = {
    error: USER_CANCELLED_RUN_ERROR,
    plannerTrace,
  };

  await prisma.executiveAssistantRun.updateMany({
    where: {
      id: run.id,
      investorId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
    },
    data: {
      status: 'ERROR',
      error: USER_CANCELLED_RUN_ERROR,
      result: toPrismaJson(result),
      plannerTrace: toPrismaJson(plannerTrace),
      completedAt: new Date(),
    },
  });

  const cancelledRun = await prisma.executiveAssistantRun.findUnique({
    where: { id: run.id },
  });

  return NextResponse.json(cancelledRun ? serializeExecutiveAssistantRun(cancelledRun) : { ok: true });
}

function scheduleExecutiveAssistantRun(runId: string, investorId: string) {
  after(async () => {
    try {
      await executeExecutiveAssistantRun(runId, investorId);
    } catch (error) {
      console.error('[executive-assistant] async run failed:', error);
    }
  });
}

function serializeExecutiveAssistantRun(run: {
  id: string;
  status: string;
  result: Prisma.JsonValue | null;
  error: string | null;
  planner: Prisma.JsonValue | null;
  plannerTrace: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}) {
  return {
    runId: run.id,
    status: run.status,
    result: run.result || null,
    error: run.error || null,
    planner: run.planner || getExecutivePlannerDefinition(),
    plannerTrace: run.plannerTrace || [],
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() || null,
    completedAt: run.completedAt?.toISOString() || null,
    pollIntervalMs: ASYNC_POLL_INTERVAL_MS,
  };
}

function isStaleExecutiveAssistantRun(run: { status: string; updatedAt: Date }) {
  if (!ACTIVE_RUN_STATUSES.includes(run.status as (typeof ACTIVE_RUN_STATUSES)[number])) return false;
  return Date.now() - run.updatedAt.getTime() > ASYNC_RUN_STALE_AFTER_MS;
}

async function expireStaleExecutiveAssistantRun(run: {
  id: string;
  investorId: string;
  plannerTrace: Prisma.JsonValue | null;
}) {
  const plannerTrace = [
    ...normalizeStoredPlannerTrace(run.plannerTrace),
    {
      ...getExecutivePlannerStepDefinition('generate_reply'),
      status: 'ERROR',
      detail: STALE_RUN_ERROR,
      error: STALE_RUN_ERROR,
      timestamp: new Date().toISOString(),
      payload: {
        staleRunExpired: true,
      },
    },
  ] satisfies ExecutivePlannerTraceItem[];

  await prisma.executiveAssistantRun.updateMany({
    where: {
      id: run.id,
      investorId: run.investorId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
    },
    data: {
      status: 'ERROR',
      error: STALE_RUN_ERROR,
      result: toPrismaJson({
        error: STALE_RUN_ERROR,
        plannerTrace,
      }),
      plannerTrace: toPrismaJson(plannerTrace),
      completedAt: new Date(),
    },
  });

  return prisma.executiveAssistantRun.findUnique({
    where: { id: run.id },
  });
}

async function createExecutiveAssistantRun(params: {
  investorId: string;
  threadId?: string | null;
  messages: ClientMessage[];
}) {
  const run = await prisma.executiveAssistantRun.create({
    data: {
      investorId: params.investorId,
      status: 'QUEUED',
      request: toPrismaJson({
        threadId: params.threadId || null,
        messages: params.messages,
      }),
      planner: toPrismaJson(getExecutivePlannerDefinition()),
      plannerTrace: toPrismaJson([]),
    },
  });
  scheduleExecutiveAssistantRun(run.id, params.investorId);
  return run;
}

async function getExecutiveAssistantRunResponse(req: NextRequest, investorId: string) {
  const runId = req.nextUrl.searchParams.get('runId')?.trim();
  if (!runId) return null;

  const run = await prisma.executiveAssistantRun.findFirst({
    where: {
      id: runId,
      investorId,
    },
  });
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  if (isStaleExecutiveAssistantRun(run)) {
    const expiredRun = await expireStaleExecutiveAssistantRun(run);
    return NextResponse.json(serializeExecutiveAssistantRun(expiredRun || run));
  }

  if (run.status === 'QUEUED') {
    scheduleExecutiveAssistantRun(run.id, investorId);
  }

  return NextResponse.json(serializeExecutiveAssistantRun(run));
}

async function getLatestActiveExecutiveAssistantRun(investorId: string) {
  const runs = await prisma.executiveAssistantRun.findMany({
    where: {
      investorId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  for (const run of runs) {
    if (isStaleExecutiveAssistantRun(run)) {
      await expireStaleExecutiveAssistantRun(run);
      continue;
    }
    if (run.status === 'QUEUED') {
      scheduleExecutiveAssistantRun(run.id, investorId);
    }
    return serializeExecutiveAssistantRun(run);
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const investor = await getInvestorOrNull();
    if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const runResponse = await getExecutiveAssistantRunResponse(req, investor.id);
    if (runResponse) return runResponse;

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

    const activeRun = await getLatestActiveExecutiveAssistantRun(investor.id);

    return NextResponse.json({
      threadId: thread?.id || null,
      messages: thread ? toClientMessages(thread.messages) : [],
      briefing,
      persistedBriefing,
      planner: getExecutivePlannerDefinition(),
      activeRun,
      agentConfig: {
        systemPrompt: promptConfig.systemPrompt,
        defaultSystemPrompt: promptConfig.defaultSystemPrompt,
        hasCustomPrompt: Boolean(promptConfig.customPrompt),
      },
    });
  } catch (error) {
    return routeErrorResponse('查询任务状态', error);
  }
}

export async function PUT(req: NextRequest) {
  try {
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
  } catch (error) {
    return routeErrorResponse('保存 system prompt', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const investor = await getInvestorOrNull();
    if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.log('[executive-assistant] POST start', {
      investorId: investor.id,
      stream: req.nextUrl.searchParams.get('stream') === '1',
    });

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

    if (req.nextUrl.searchParams.get('async') === '1') {
      const activeRun = await getLatestActiveExecutiveAssistantRun(investor.id);
      if (activeRun) {
        return NextResponse.json(activeRun, { status: 202 });
      }

      const run = await createExecutiveAssistantRun(turnParams);
      return NextResponse.json(
        {
          runId: run.id,
          status: run.status,
          planner: run.planner || getExecutivePlannerDefinition(),
          plannerTrace: run.plannerTrace || [],
          pollIntervalMs: ASYNC_POLL_INTERVAL_MS,
        },
        { status: 202 }
      );
    }

    if (req.nextUrl.searchParams.get('stream') === '1') {
      return streamExecutiveAssistantTurn(turnParams);
    }

    const result = await runExecutiveAssistantTurn(turnParams);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return routeErrorResponse('启动秘书任务', error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const investor = await getInvestorOrNull();
    if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { threadId?: string | null; runId?: string | null } | null;
    const runId = typeof body?.runId === 'string' ? body.runId.trim() : '';
    if (runId) return cancelExecutiveAssistantRun(runId, investor.id);

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
  } catch (error) {
    return routeErrorResponse('停止或删除秘书任务', error);
  }
}
