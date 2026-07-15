import { after, NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { getOpenRouterModel } from '@/lib/openrouter';
import { runCodexAgentLoop, type CodexAgentLoopEvent, type CodexAgenttool } from '@/lib/codex-agent-runtime';
import {
  appendtoolCall,
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
  recenttoolCalls?: unknown;
};

type StoredExecutiveRunRequest = {
  threadId?: string | null;
  messages?: ClientMessage[];
};

const USER_CANCELLED_RUN_ERROR = 'Run stopped by user.';
const STALE_RUN_ERROR = 'This run has been active for more than 30 minutes and was marked stale.';

function buildBriefingContext(briefing: {
  date: string;
  generatedTime: string;
  headline: string;
  departmentOverview: Array<{ department: string; status: string; summary: string; progress: number }>;
  externalInsights: Array<{ category: string; content: string; source: string }>;
  priorityTasks: Array<{ priority: 'high' | 'medium' | 'low'; task: string; deadline: string; assignedBy: string }>;
}) {
  const departmentLines = briefing.departmentOverview
    .map((item, index) => `${index + 1}. ${item.department} | ${item.status} | progress ${item.progress}% | ${item.summary}`)
    .join('\n');
  const insightLines = briefing.externalInsights
    .map((item, index) => `${index + 1}. ${item.category} | ${item.source} | ${item.content}`)
    .join('\n');
  const taskLines = briefing.priorityTasks
    .map((item, index) => `${index + 1}. ${item.priority.toUpperCase()} | ${item.task} | due ${item.deadline} | assigned by ${item.assignedBy}`)
    .join('\n');

  return [
    `Date: ${briefing.date}`,
    `Generated at: ${briefing.generatedTime}`,
    `Headline: ${briefing.headline}`,
    'Department overview:',
    departmentLines || 'No department updates.',
    'External insights:',
    insightLines || 'No external insights.',
    'Priority tasks:',
    taskLines || 'No priority tasks.',
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
  if (!snapshot) return 'No execution context has been recorded yet.';
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
  params: {
    investorId: string;
    threadId: string;
    messages: ClientMessage[];
    briefing: ExecutiveDailyBriefing;
    getBriefing: () => ExecutiveDailyBriefing;
    systemPrompt: string;
    getPersistedBriefing: () => Promise<Awaited<ReturnType<typeof getTodayExecutiveBriefing>> | null>;
    setBriefing: (briefing: ExecutiveDailyBriefing) => void;
    setExecutionSnapshot: (snapshot: ExecutiveExecutionSnapshot) => void;
    getExecutionSnapshot: () => ExecutiveExecutionSnapshot | null;
    onPlannerEvent?: (event: ExecutivePlannerEvent) => void | Promise<void>;
  }
) {
  const latest = params.messages[params.messages.length - 1];
  const contextPrompt = [
    'You are Hermes Agent, the executive assistant. Use the current briefing, execution history, and tools before giving operational guidance.',
    buildBriefingContext(params.briefing),
    'Recent execution context:',
    buildExecutionContext(params.getExecutionSnapshot()),
    'Codex agent loop rules:',
    '1) Think step by step, but only show concise conclusions and actions to the user.',
    '2) Call tools when they can provide current data or execution history.',
    '3) If the user asks to update the briefing, use update_today_briefing with evidence and source links.',
    '4) Use get_current_briefing, get_recent_execution_trace, and list_connected_information_channels when the answer depends on current context.',
    '5) Use get_current_time before resolving relative date phrases such as today, tomorrow, or the last 24 hours.',
    'Response rules:',
    '1) Be direct and practical.',
    '2) Use clean Markdown when structure helps.',
    '3) Do not expose raw tool JSON unless the user asks.',
    '4) When data is unavailable, say what is missing and what the user can provide.',
    '5) For skipped or failed steps, explain the reason plainly and keep moving.',
  ].join('\n\n');

  const tools: CodexAgenttool[] = [
    {
      name: 'get_current_time',
      description: 'Return the server current date and time for resolving relative date phrases.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const date = new Date();
        return {
          iso: date.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          locale: date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour12: false }),
          dateKeyShanghai: date.toLocaleDateString('en-US', { timeZone: 'Asia/Shanghai' }),
        };
      },
    },
    {
      name: 'get_current_briefing',
      description: 'Read the current in-memory briefing and the latest persisted briefing for this executive assistant.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => ({
        currentBriefing: params.getBriefing(),
        persistedBriefing: await params.getPersistedBriefing(),
      }),
    },
    {
      name: 'list_connected_information_channels',
      description: 'List currently connected information channels and available source counts.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const [integrations, wechatSourceCount, agentThreads] = await Promise.all([
          prisma.investorIntegration.findMany({
            where: { investorId: params.investorId },
            select: { provider: true, status: true, accountEmail: true, accountName: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
          }),
          prisma.investorWechatSource.count({ where: { investorId: params.investorId } }),
          prisma.agentThread.findMany({
            where: { investorId: params.investorId },
            select: { agentType: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
          }),
        ]);
        return {
          integrations,
          wechatSourceCount,
          knownAgentThreads: agentThreads,
        };
      },
    },
    {
      name: 'get_recent_execution_trace',
      description: 'Read recent persisted tool execution records for explaining what actually ran.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => ({
        executionSnapshot: params.getExecutionSnapshot(),
        recenttoolCalls: await loadRecentExecutionRecords(params.threadId),
      }),
    },
    {
      name: 'update_today_briefing',
      description: 'Run the executive briefing update workflow. Use this when the user asks to update information, update the morning briefing, or re-aggregate channel signals.',
      parameters: {
        type: 'object',
        properties: {
          userQuery: {
            type: 'string',
            description: 'The concrete user instruction to pass to the executive briefing workflow.',
          },
          reason: {
            type: 'string',
            description: 'Why this tool call is needed in the current turn.',
          },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        const updateResult = await updateTodayExecutiveBriefing({
          investorId: params.investorId,
          userQuery: typeof args.userQuery === 'string' && args.userQuery.trim() ? args.userQuery : latest?.content || '',
          executiveSystemPrompt: params.systemPrompt,
          onPlannerEvent: params.onPlannerEvent,
        });
        if (!updateResult) {
          return {
            skipped: true,
            reason: 'updateTodayExecutiveBriefing returned null, so no briefing update was performed.',
            currentBriefing: params.getBriefing(),
          };
        }

        params.setBriefing(updateResult.briefing);
        const subagents = updateResult.subagentResults.map((item) => ({
          agentType: item.agentType,
          answer: item.answer,
          briefingItemCount: item.briefingItems.length,
          briefingItems: item.briefingItems,
          debug: item.debug,
        }));
        const snapshot: ExecutiveExecutionSnapshot = {
          planner: getExecutivePlannerDefinition(),
          plannerTrace: [],
          document: updateResult.document,
          subagents,
          toolCalls: updateResult.toolCalls,
        };
        params.setExecutionSnapshot(snapshot);

        return {
          briefing: updateResult.briefing,
          persistedBriefing: await params.getPersistedBriefing(),
          document: updateResult.document,
          subagents,
          toolCalls: updateResult.toolCalls,
        };
      },
    },
  ];

  const loopEvents: CodexAgentLoopEvent[] = [];
  const result = await runCodexAgentLoop({
    systemMessages: [params.systemPrompt, contextPrompt],
    conversation: params.messages,
    tools,
    modelKey: 'EXECUTIVE',
    maxTurns: 8,
    onEvent: async (event) => {
      loopEvents.push(event);
      if (event.type === 'tool_call' && (event.status === 'SUCCESS' || event.status === 'ERROR')) {
        await appendtoolCall({
          threadId: params.threadId,
          toolName: event.toolName,
          status: event.status,
          toolArgs: event.arguments,
          toolResult: event.result || (event.error ? { error: event.error } : undefined),
        });
      }
      await params.onPlannerEvent?.({
        type: 'step',
        step: {
          ...getExecutivePlannerStepDefinition('generate_reply'),
          status: event.status === 'SKIPPED' ? 'SKIPPED' : event.status,
          detail:
            event.type === 'model_call'
              ? `Codex model call turn ${event.turn} ${event.status}`
              : event.type === 'tool_call'
                ? `Codex tool ${event.toolName} ${event.status}`
                : `Codex event ${event.status}`,
          timestamp: event.timestamp,
          payload: {
            codexAgentLoop: event,
          },
        },
      });
    },
  });

  params.setExecutionSnapshot({
    ...(params.getExecutionSnapshot() || { planner: getExecutivePlannerDefinition(), plannerTrace: [] }),
    recenttoolCalls: await loadRecentExecutionRecords(params.threadId),
  });

  return {
    reply: result.finalText.trim(),
    loopEvents,
    model: result.model || getOpenRouterModel('EXECUTIVE'),
  };
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
      error: `${operation}failed: ${detail}`,
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

  executionSnapshot = {
    ...executionSnapshot,
    planner: currentPlanner,
    plannerTrace,
    recenttoolCalls: await loadRecentExecutionRecords(thread.id),
  };

  await emitPlannerEvent({
    type: 'step',
    step: {
      ...getExecutivePlannerStepDefinition('generate_reply'),
      status: 'RUNNING',
      detail: 'Executive Assistant is generating a reply.',
      timestamp: new Date().toISOString(),
    },
  });

  let reply = '';
  let codexLoop: unknown = null;
  try {
    const replyResult = await generateExecutiveReply({
      investorId: params.investorId,
      threadId: thread.id,
      messages: params.messages,
      briefing,
      getBriefing: () => briefing,
      systemPrompt: promptConfig.systemPrompt,
      getPersistedBriefing: async () => {
        persistedBriefing = await getTodayExecutiveBriefing(params.investorId);
        return persistedBriefing;
      },
      setBriefing: (nextBriefing) => {
        briefing = nextBriefing;
      },
      getExecutionSnapshot: () => executionSnapshot,
      setExecutionSnapshot: (snapshot) => {
        executionSnapshot = {
          ...snapshot,
          planner: currentPlanner,
          plannerTrace,
        };
      },
      onPlannerEvent: emitPlannerEvent,
    });
    reply = replyResult.reply;
    codexLoop = {
      model: replyResult.model,
      events: replyResult.loopEvents,
    };
    await emitPlannerEvent({
      type: 'step',
      step: {
        ...getExecutivePlannerStepDefinition('generate_reply'),
        status: 'SUCCESS',
        detail: 'Executive Assistant reply generated.',
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
        error: `Executive Assistant failed: ${detail}`,
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
      codexLoop: compactForModel(codexLoop),
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
      codexLoop,
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
            data: { error: `AI execution failed: ${detail}` },
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
        error: 'Stored run request is missing or invalid.',
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
        error: `AI execution failed: ${detail}`,
        result: toPrismaJson({ error: `AI execution failed: ${detail}` }),
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
        content: `Hi, I am Executive Assistant Momo.\n\n${briefing.headline}\n\nI can help with:\n1) Work updates\n2) Today's priorities\n3) Decision support`,
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
    return routeErrorResponse('Load executive assistant', error);
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
      return NextResponse.json({ error: 'System prompt is required.' }, { status: 400 });
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
    return routeErrorResponse('Save system prompt', error);
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
      return NextResponse.json({ error: 'At least one user message is required.' }, { status: 400 });
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
    return routeErrorResponse('Executive assistant request', error);
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
    return routeErrorResponse('Stop or delete executive assistant session', error);
  }
}
