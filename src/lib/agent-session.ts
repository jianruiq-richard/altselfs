import { prisma } from '@/lib/prisma';

export type AgentType = 'GMAIL' | 'FEISHU' | 'WECHAT' | 'XIAOHONGSHU' | 'EXECUTIVE' | 'PERSONAL';
export type AgentMessageRole = 'USER' | 'ASSISTANT' | 'TOOL';

export async function getLatestThreadWithMessages(investorId: string, agentType: AgentType) {
  const thread = await prisma.agentThread.findFirst({
    where: { investorId, agentType },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: {
        select: { messages: true },
      },
      messages: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 60,
      },
    },
  });

  if (thread) {
    thread.messages = [...thread.messages].reverse();
  }

  return thread;
}

export async function getThreadMessagesPage(params: {
  investorId: string;
  agentType: AgentType;
  threadId: string;
  beforeMessageId?: string | null;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit || 60, 1), 100);
  const thread = await prisma.agentThread.findFirst({
    where: {
      id: params.threadId,
      investorId: params.investorId,
      agentType: params.agentType,
    },
    select: { id: true },
  });

  if (!thread) return null;

  const beforeMessage = params.beforeMessageId
    ? await prisma.agentMessage.findFirst({
        where: {
          id: params.beforeMessageId,
          threadId: params.threadId,
        },
        select: { id: true, createdAt: true },
      })
    : null;

  const messages = await prisma.agentMessage.findMany({
    where: {
      threadId: params.threadId,
      role: { in: ['USER', 'ASSISTANT'] },
      ...(beforeMessage
        ? {
            OR: [
              { createdAt: { lt: beforeMessage.createdAt } },
              { createdAt: beforeMessage.createdAt, id: { lt: beforeMessage.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const hasMore = messages.length > limit;
  const pageMessages = messages.slice(0, limit).reverse();

  return {
    messages: pageMessages,
    hasMore,
    nextBeforeMessageId: pageMessages[0]?.id || null,
  };
}

export async function ensureThread(params: {
  investorId: string;
  agentType: AgentType;
  threadId?: string | null;
}) {
  if (params.threadId) {
    const existing = await prisma.agentThread.findUnique({
      where: { id: params.threadId },
    });

    if (existing && existing.investorId === params.investorId && existing.agentType === params.agentType) {
      return existing;
    }
  }

  const latest = await prisma.agentThread.findFirst({
    where: { investorId: params.investorId, agentType: params.agentType },
    orderBy: { updatedAt: 'desc' },
  });

  if (latest) return latest;

  return prisma.agentThread.create({
    data: {
      investorId: params.investorId,
      agentType: params.agentType,
    },
  });
}

export async function appendThreadMessage(params: {
  threadId: string;
  role: AgentMessageRole;
  content: string;
  meta?: unknown;
}) {
  const message = await prisma.agentMessage.create({
    data: {
      threadId: params.threadId,
      role: params.role,
      content: params.content,
      meta: params.meta as object | undefined,
    },
  });

  await prisma.agentThread.update({
    where: { id: params.threadId },
    data: { updatedAt: new Date() },
  });

  return message;
}

export async function appendToolCall(params: {
  threadId: string;
  toolName: string;
  status?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  messageId?: string | null;
}) {
  return prisma.agentToolCall.create({
    data: {
      threadId: params.threadId,
      toolName: params.toolName,
      status: params.status || 'SUCCESS',
      toolArgs: params.toolArgs as object | undefined,
      toolResult: params.toolResult as object | undefined,
      messageId: params.messageId || null,
    },
  });
}

export function toClientMessages(
  messages: Array<{
    id?: string;
    role: string;
    content: string;
    createdAt?: Date | string;
  }>
) {
  return messages
    .filter((message) => message.role === 'USER' || message.role === 'ASSISTANT')
    .map((message) => ({
      ...(message.id ? { id: message.id } : {}),
      role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
      content: message.content,
      ...(message.createdAt
        ? {
            createdAt:
              message.createdAt instanceof Date
                ? message.createdAt.toISOString()
                : message.createdAt,
          }
        : {}),
    }));
}
