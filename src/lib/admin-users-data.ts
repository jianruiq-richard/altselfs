import { Prisma } from '@prisma/client';
import { getBillingPlan } from '@/lib/billing-plans';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';
import { prisma } from '@/lib/prisma';

const SENSITIVE_KEY_PATTERN = /authorization|cookie|password|secret|token|access[_-]?key|refresh[_-]?key|api[_-]?key/i;

type AdminBillingAgentDetail = {
  source: string;
  account: Record<string, unknown>;
  subscription: Record<string, unknown>;
  ledger: Array<Record<string, unknown>>;
  usageRecords: Array<Record<string, unknown>>;
  reservations: Array<Record<string, unknown>>;
};

export async function listAdminUsers(input: { query?: string | null; limit?: number }) {
  const query = input.query?.trim() || '';
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100);
  const where: Prisma.UserWhereInput = query
    ? {
        OR: [
          { id: { contains: query } },
          { clerkId: { contains: query } },
          { email: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { nickname: { contains: query, mode: 'insensitive' } },
        ],
      }
    : {};

  const users = await prisma.user.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: limit,
    select: {
      id: true,
      clerkId: true,
      email: true,
      name: true,
      nickname: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      creditAccount: {
        select: {
          balanceCredits: true,
          reservedCredits: true,
          lifetimeSpentCredits: true,
        },
      },
      creditSubscription: {
        select: {
          planKey: true,
          status: true,
          monthlyCredits: true,
        },
      },
      _count: {
        select: {
          agentThreads: true,
          executiveAssistantRuns: true,
          agentUsageRecords: true,
          creditLedger: true,
        },
      },
    },
  });

  return {
    users: users.map((user) => {
      const plan = getBillingPlan(user.creditSubscription?.planKey);
      const balanceCredits = user.creditAccount?.balanceCredits || 0;
      const reservedCredits = user.creditAccount?.reservedCredits || 0;
      return {
        id: user.id,
        clerkId: user.clerkId,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        billing: {
          balanceCredits,
          reservedCredits,
          availableCredits: balanceCredits - reservedCredits,
          lifetimeSpentCredits: user.creditAccount?.lifetimeSpentCredits || 0,
          planKey: user.creditSubscription?.planKey || plan.key,
          planName: plan.name,
          subscriptionStatus: user.creditSubscription?.status || 'ACTIVE',
          monthlyCredits: user.creditSubscription?.monthlyCredits ?? plan.monthlyCredits,
        },
        counts: {
          agentThreads: user._count.agentThreads,
          executiveRuns: user._count.executiveAssistantRuns,
          usageRecords: user._count.agentUsageRecords,
          ledgerEntries: user._count.creditLedger,
        },
      };
    }),
    limit,
    query,
  };
}

export async function getAdminUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      clerkId: true,
      email: true,
      name: true,
      nickname: true,
      phone: true,
      wechatId: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      creditAccount: true,
      creditSubscription: true,
    },
  });
  if (!user) return null;

  const [threads, ledger, usageRecords, reservations, executiveRuns, contextRuns] = await Promise.all([
    prisma.agentThread.findMany({
      where: { investorId: userId, status: { not: 'DELETED' } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 80,
      include: {
        _count: { select: { messages: true, toolCalls: true } },
        messages: {
          where: { role: { in: ['USER', 'ASSISTANT'] } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
    }),
    prisma.creditLedgerEntry.findMany({
      where: { investorId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 120,
    }),
    prisma.agentUsageRecord.findMany({
      where: { investorId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 120,
    }),
    prisma.creditReservation.findMany({
      where: { investorId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 60,
    }),
    prisma.executiveAssistantRun.findMany({
      where: { investorId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 60,
      select: {
        id: true,
        status: true,
        request: true,
        result: true,
        error: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    readAgentContextRunsByUser(userId),
  ]);

  const threadTitleById = await getThreadTitleMap([
    ...ledger.map((entry) => entry.threadId),
    ...usageRecords.map((record) => record.threadId),
    ...reservations.map((reservation) => reservation.threadId),
    ...contextRuns.map((run) => run.threadId),
  ]);
  const billing = await readAdminBillingDetailFromAgent(userId);
  const agentPlanKey = typeof billing.detail?.subscription?.planKey === 'string'
    ? billing.detail.subscription.planKey
    : null;
  const plan = getBillingPlan(agentPlanKey || user.creditSubscription?.planKey);
  const account = user.creditAccount;
  const accountPayload = billing.detail?.account ?? {
    id: account?.id || null,
    balanceCredits: account?.balanceCredits || 0,
    reservedCredits: account?.reservedCredits || 0,
    availableCredits: (account?.balanceCredits || 0) - (account?.reservedCredits || 0),
    lifetimeGrantedCredits: account?.lifetimeGrantedCredits || 0,
    lifetimeSpentCredits: account?.lifetimeSpentCredits || 0,
    lifetimeRefundedCredits: account?.lifetimeRefundedCredits || 0,
    createdAt: account?.createdAt.toISOString() || null,
    updatedAt: account?.updatedAt.toISOString() || null,
  };
  const subscriptionPayload = billing.detail?.subscription ?? {
    id: user.creditSubscription?.id || null,
    planKey: user.creditSubscription?.planKey || plan.key,
    planName: plan.name,
    status: user.creditSubscription?.status || 'ACTIVE',
    monthlyCredits: user.creditSubscription?.monthlyCredits ?? plan.monthlyCredits,
    concurrentTaskLimit: plan.concurrentTasks,
    currentPeriodStart: user.creditSubscription?.currentPeriodStart?.toISOString() || null,
    currentPeriodEnd: user.creditSubscription?.currentPeriodEnd?.toISOString() || null,
    provider: user.creditSubscription?.provider || null,
    providerCustomerId: user.creditSubscription?.providerCustomerId || null,
    providerSubscriptionId: user.creditSubscription?.providerSubscriptionId || null,
  };
  const ledgerPayload = billing.detail?.ledger ?? ledger.map((entry) => ({
    id: entry.id,
    type: entry.type,
    amountCredits: entry.amountCredits,
    reservedDeltaCredits: entry.reservedDeltaCredits,
    balanceAfterCredits: entry.balanceAfterCredits,
    reservedAfterCredits: entry.reservedAfterCredits,
    description: entry.description,
    idempotencyKey: entry.idempotencyKey,
    runId: entry.runId,
    threadId: entry.threadId,
    threadTitle: entry.threadId ? threadTitleById.get(entry.threadId) || null : null,
    metadata: cleanJson(entry.metadata),
    createdAt: entry.createdAt.toISOString(),
  }));
  const usagePayload = billing.detail?.usageRecords ?? usageRecords.map((record) => ({
    id: record.id,
    runId: record.runId,
    status: record.status,
    hermesModel: record.hermesModel,
    codexModel: record.codexModel,
    hermesCostUsd: decimalToNumber(record.hermesCostUsd),
    hermesCredits: record.hermesCredits,
    codexCredits: record.codexCredits,
    computedCredits: record.computedCredits,
    billedCredits: record.billedCredits,
    pricingVersion: record.pricingVersion,
    usage: cleanJson(record.usage),
    threadId: record.threadId,
    threadTitle: record.threadId ? threadTitleById.get(record.threadId) || null : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }));
  const reservationPayload = billing.detail?.reservations ?? reservations.map((reservation) => ({
    id: reservation.id,
    runId: reservation.runId,
    status: reservation.status,
    mode: reservation.mode,
    hermesModel: reservation.hermesModel,
    estimatedCredits: reservation.estimatedCredits,
    reservedCredits: reservation.reservedCredits,
    capturedCredits: reservation.capturedCredits,
    shortfallCredits: reservation.shortfallCredits,
    threadId: reservation.threadId,
    threadTitle: reservation.threadId ? threadTitleById.get(reservation.threadId) || null : null,
    expiresAt: reservation.expiresAt.toISOString(),
    settledAt: reservation.settledAt?.toISOString() || null,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  }));

  return {
    user: {
      id: user.id,
      clerkId: user.clerkId,
      email: user.email,
      name: user.name,
      nickname: user.nickname,
      phone: user.phone,
      wechatId: user.wechatId,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
    billingSource: {
      source: billing.detail?.source || 'prisma-fallback',
      warning: billing.warning || null,
    },
    account: accountPayload,
    subscription: subscriptionPayload,
    threads: threads.map((thread) => ({
      id: thread.id,
      agentType: thread.agentType,
      title: thread.title || firstLine(thread.messages[0]?.content || 'New discussion', 80),
      status: thread.status,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      messageCount: thread._count.messages,
      toolCallCount: thread._count.toolCalls,
      lastMessagePreview: firstLine(thread.messages[0]?.content || '', 180),
      lastMessageAt: thread.messages[0]?.createdAt.toISOString() || null,
    })),
    ledger: ledgerPayload,
    usageRecords: usagePayload,
    reservations: reservationPayload,
    executiveRuns: executiveRuns.map((run) => ({
      id: run.id,
      status: run.status,
      request: cleanJson(run.request),
      result: cleanJson(run.result),
      error: run.error,
      startedAt: run.startedAt?.toISOString() || null,
      completedAt: run.completedAt?.toISOString() || null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    })),
    contextRuns,
  };
}

export async function getAdminThreadDetail(threadId: string, input?: { limit?: number }) {
  const limit = Math.min(Math.max(Number(input?.limit) || 160, 20), 500);
  const thread = await prisma.agentThread.findUnique({
    where: { id: threadId },
    include: {
      investor: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      messages: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
      },
      toolCalls: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 120,
      },
      _count: { select: { messages: true, toolCalls: true } },
    },
  });
  if (!thread) return null;

  const [contextRuns, contextToolCalls, runEvents, artifacts] = await Promise.all([
    readAgentContextRunsByThread(threadId),
    readAgentContextToolCallsByThread(threadId),
    readAgentContextRunEventsByThread(threadId),
    readAgentContextArtifactsByThread(threadId),
  ]);

  return {
    thread: {
      id: thread.id,
      agentType: thread.agentType,
      title: thread.title || 'New discussion',
      status: thread.status,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      messageCount: thread._count.messages,
      toolCallCount: thread._count.toolCalls,
      investor: {
        id: thread.investor.id,
        email: thread.investor.email,
        name: thread.investor.name,
      },
    },
    messages: thread.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      meta: cleanJson(message.meta),
      createdAt: message.createdAt.toISOString(),
    })),
    toolCalls: thread.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      toolName: toolCall.toolName,
      status: toolCall.status,
      toolArgs: cleanJson(toolCall.toolArgs),
      toolResult: cleanJson(toolCall.toolResult),
      messageId: toolCall.messageId,
      createdAt: toolCall.createdAt.toISOString(),
    })),
    contextRuns,
    contextToolCalls,
    runEvents,
    artifacts,
  };
}

async function getThreadTitleMap(threadIds: Array<string | null | undefined>) {
  const ids = Array.from(new Set(threadIds.filter((item): item is string => Boolean(item))));
  if (ids.length === 0) return new Map<string, string>();
  const rows = await prisma.agentThread.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true },
  });
  return new Map(rows.map((row) => [row.id, row.title || 'New discussion']));
}

async function readAdminBillingDetailFromAgent(userId: string): Promise<{
  detail: AdminBillingAgentDetail | null;
  warning: string | null;
}> {
  try {
    const query = new URLSearchParams({ investorId: userId });
    const detail = await personalAgentInternalFetch<AdminBillingAgentDetail>(
      `/internal/admin/billing/user?${query.toString()}`,
      {},
      { attempts: 1, timeoutMs: 10_000 },
    );
    return { detail, warning: null };
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);
    console.warn('[admin-users] billing detail fallback', { userId, warning });
    return { detail: null, warning };
  }
}

async function readAgentContextRunsByUser(investorId: string) {
  try {
    const rows = await prisma.$queryRaw<AgentContextRunRow[]>`
      select id, investor_id, thread_id, status, route, request, execution_request, result, error,
             queued_at, started_at, completed_at, worker_id, worker_heartbeat_at, attempt_count,
             next_attempt_at, timeout_at, cancel_requested, model_provider, model, created_at, updated_at
      from agent_context_runs
      where investor_id = ${investorId}
      order by created_at desc, id desc
      limit 80
    `;
    return rows.map(mapAgentContextRunRow);
  } catch {
    return [];
  }
}

async function readAgentContextRunsByThread(threadId: string) {
  try {
    const rows = await prisma.$queryRaw<AgentContextRunRow[]>`
      select id, investor_id, thread_id, status, route, request, execution_request, result, error,
             queued_at, started_at, completed_at, worker_id, worker_heartbeat_at, attempt_count,
             next_attempt_at, timeout_at, cancel_requested, model_provider, model, created_at, updated_at
      from agent_context_runs
      where thread_id = ${threadId}
      order by created_at desc, id desc
      limit 80
    `;
    return rows.map(mapAgentContextRunRow);
  } catch {
    return [];
  }
}

async function readAgentContextToolCallsByThread(threadId: string) {
  try {
    const rows = await prisma.$queryRaw<AgentContextToolCallRow[]>`
      select id, investor_id, thread_id, run_id, message_id, tool_name, status,
             tool_args, tool_result, created_at
      from agent_context_tool_calls
      where thread_id = ${threadId}
      order by created_at desc, id desc
      limit 160
    `;
    return rows.map((row) => ({
      id: String(row.id || ''),
      investorId: String(row.investor_id || ''),
      threadId: String(row.thread_id || ''),
      runId: stringOrNull(row.run_id),
      messageId: stringOrNull(row.message_id),
      toolName: String(row.tool_name || ''),
      status: String(row.status || ''),
      toolArgs: cleanJson(row.tool_args),
      toolResult: cleanJson(row.tool_result),
      createdAt: dateIso(row.created_at),
    }));
  } catch {
    return [];
  }
}

async function readAgentContextRunEventsByThread(threadId: string) {
  try {
    const rows = await prisma.$queryRaw<AgentContextRunEventRow[]>`
      select e.id, e.run_id, e.type, e.payload, e.created_at
      from agent_context_run_events e
      join agent_context_runs r on r.id = e.run_id
      where r.thread_id = ${threadId}
      order by e.created_at desc, e.id desc
      limit 240
    `;
    return rows.map((row) => ({
      id: String(row.id || ''),
      runId: String(row.run_id || ''),
      type: String(row.type || ''),
      payload: cleanJson(row.payload),
      createdAt: dateIso(row.created_at),
    }));
  } catch {
    return [];
  }
}

async function readAgentContextArtifactsByThread(threadId: string) {
  try {
    const rows = await prisma.$queryRaw<AgentContextArtifactRow[]>`
      select id, investor_id, thread_id, run_id, kind, name, mime_type, size_bytes,
             content_text, metadata, created_at, updated_at
      from agent_context_artifacts
      where thread_id = ${threadId}
      order by created_at desc, id desc
      limit 120
    `;
    return rows.map((row) => ({
      id: String(row.id || ''),
      investorId: String(row.investor_id || ''),
      threadId: String(row.thread_id || ''),
      runId: stringOrNull(row.run_id),
      kind: String(row.kind || ''),
      name: String(row.name || ''),
      mimeType: stringOrNull(row.mime_type),
      sizeBytes: numberValue(row.size_bytes),
      contentPreview: firstLine(String(row.content_text || ''), 1200),
      metadata: cleanJson(row.metadata),
      createdAt: dateIso(row.created_at),
      updatedAt: dateIso(row.updated_at),
    }));
  } catch {
    return [];
  }
}

function mapAgentContextRunRow(row: AgentContextRunRow) {
  return {
    id: String(row.id || ''),
    investorId: String(row.investor_id || ''),
    threadId: String(row.thread_id || ''),
    status: String(row.status || ''),
    route: stringOrNull(row.route),
    request: cleanJson(row.request),
    executionRequest: cleanJson(row.execution_request),
    result: cleanJson(row.result),
    error: stringOrNull(row.error),
    queuedAt: dateIsoOrNull(row.queued_at),
    startedAt: dateIsoOrNull(row.started_at),
    completedAt: dateIsoOrNull(row.completed_at),
    workerId: stringOrNull(row.worker_id),
    workerHeartbeatAt: dateIsoOrNull(row.worker_heartbeat_at),
    attemptCount: numberValue(row.attempt_count),
    nextAttemptAt: dateIsoOrNull(row.next_attempt_at),
    timeoutAt: dateIsoOrNull(row.timeout_at),
    cancelRequested: Boolean(row.cancel_requested),
    modelProvider: stringOrNull(row.model_provider),
    model: stringOrNull(row.model),
    createdAt: dateIso(row.created_at),
    updatedAt: dateIso(row.updated_at),
  };
}

function cleanJson(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 8000 ? `${value.slice(0, 8000)}... [truncated]` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 120).map((item) => cleanJson(item, depth + 1));
  if (typeof value === 'object') {
    if ('toJSON' in value && typeof value.toJSON === 'function') return cleanJson(value.toJSON(), depth + 1);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : cleanJson(item, depth + 1),
      ]),
    );
  }
  return String(value);
}

function firstLine(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return Number(value) || 0;
  return value.toNumber();
}

function numberValue(value: unknown) {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return Number(value) || 0;
  return 0;
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function dateIso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
  }
  return new Date(0).toISOString();
}

function dateIsoOrNull(value: unknown) {
  if (!value) return null;
  return dateIso(value);
}

type AgentContextRunRow = {
  id: unknown;
  investor_id: unknown;
  thread_id: unknown;
  status: unknown;
  route: unknown;
  request: unknown;
  execution_request: unknown;
  result: unknown;
  error: unknown;
  queued_at: unknown;
  started_at: unknown;
  completed_at: unknown;
  worker_id: unknown;
  worker_heartbeat_at: unknown;
  attempt_count: unknown;
  next_attempt_at: unknown;
  timeout_at: unknown;
  cancel_requested: unknown;
  model_provider: unknown;
  model: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type AgentContextToolCallRow = {
  id: unknown;
  investor_id: unknown;
  thread_id: unknown;
  run_id: unknown;
  message_id: unknown;
  tool_name: unknown;
  status: unknown;
  tool_args: unknown;
  tool_result: unknown;
  created_at: unknown;
};

type AgentContextRunEventRow = {
  id: unknown;
  run_id: unknown;
  type: unknown;
  payload: unknown;
  created_at: unknown;
};

type AgentContextArtifactRow = {
  id: unknown;
  investor_id: unknown;
  thread_id: unknown;
  run_id: unknown;
  kind: unknown;
  name: unknown;
  mime_type: unknown;
  size_bytes: unknown;
  content_text: unknown;
  metadata: unknown;
  created_at: unknown;
  updated_at: unknown;
};
