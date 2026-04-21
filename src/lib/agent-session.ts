import { prisma } from '@/lib/prisma';

export type AgentType = 'GMAIL' | 'FEISHU' | 'WECHAT' | 'EXECUTIVE';
export type AgentMessageRole = 'USER' | 'ASSISTANT' | 'TOOL';

export async function getLatestThreadWithMessages(investorId: string, agentType: AgentType) {
  const thread = await prisma.agentThread.findFirst({
    where: { investorId, agentType },
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 60,
      },
    },
  });

  return thread;
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
    role: string;
    content: string;
  }>
) {
  return messages
    .filter((message) => message.role === 'USER' || message.role === 'ASSISTANT')
    .map((message) => ({
      role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
      content: message.content,
    }));
}
