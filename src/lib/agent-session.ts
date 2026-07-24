import { prisma } from '@/lib/prisma';

export type AgentType = 'GMAIL' | 'FEISHU' | 'WECHAT' | 'XIAOHONGSHU' | 'EXECUTIVE' | 'PERSONAL';
export type AgentMessageRole = 'USER' | 'ASSISTANT' | 'TOOL';
export type AgentThreadStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED';

const ACTIVE_THREAD_STATUS: AgentThreadStatus = 'ACTIVE';
const PLACEHOLDER_THREAD_TITLES = ['instruction', 'New chat', 'New conversation', 'New discussion'];

function summarizeThreadTitle(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'New discussion';
  return normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized;
}

function isPlaceholderThreadTitle(title?: string | null) {
  const normalized = title?.trim();
  return !normalized || PLACEHOLDER_THREAD_TITLES.includes(normalized);
}

export async function getLatestThreadWithMessages(investorId: string, agentType: AgentType) {
  const thread = await prisma.agentThread.findFirst({
    where: { investorId, agentType, status: ACTIVE_THREAD_STATUS },
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

export async function listAgentThreads(
  investorId: string,
  agentType: AgentType,
  limit = 30,
  status: AgentThreadStatus = ACTIVE_THREAD_STATUS
) {
  const threads = await prisma.agentThread.findMany({
    where: { investorId, agentType, status },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    include: {
      _count: {
        select: { messages: true },
      },
      messages: {
        where: { role: { in: ['USER', 'ASSISTANT'] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1,
      },
    },
  });

  return threads.map((thread) => ({
    id: thread.id,
    status: thread.status as AgentThreadStatus,
    title: isPlaceholderThreadTitle(thread.title)
      ? summarizeThreadTitle(thread.messages[0]?.content || '')
      : thread.title,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    messageCount: thread._count.messages,
    preview: thread.messages[0]?.content || '',
  }));
}

export async function createThread(params: {
  investorId: string;
  agentType: AgentType;
  title?: string | null;
}) {
  return prisma.agentThread.create({
    data: {
      investorId: params.investorId,
      agentType: params.agentType,
      title: params.title?.trim() || 'New discussion',
      status: ACTIVE_THREAD_STATUS,
    },
  });
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
      status: ACTIVE_THREAD_STATUS,
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
      if (existing.status !== ACTIVE_THREAD_STATUS) {
        throw Object.assign(new Error('Thread is not active.'), { status: 404 });
      }
      return existing;
    }
  }

  const latest = await prisma.agentThread.findFirst({
    where: { investorId: params.investorId, agentType: params.agentType, status: ACTIVE_THREAD_STATUS },
    orderBy: { updatedAt: 'desc' },
  });

  if (latest) return latest;

  return createThread(params);
}

export async function renameAgentThread(params: {
  investorId: string;
  agentType: AgentType;
  threadId: string;
  title: string;
}) {
  const title = params.title.replace(/\s+/g, ' ').trim();
  if (!title) throw Object.assign(new Error('Title is required.'), { status: 400 });
  if (title.length > 120) throw Object.assign(new Error('Title must be 120 characters or fewer.'), { status: 400 });
  const result = await prisma.agentThread.updateMany({
    where: {
      id: params.threadId,
      investorId: params.investorId,
      agentType: params.agentType,
      status: { not: 'DELETED' },
    },
    data: { title, updatedAt: new Date() },
  });
  if (result.count === 0) throw Object.assign(new Error('Thread not found.'), { status: 404 });
}

export async function updateAgentThreadStatus(params: {
  investorId: string;
  agentType: AgentType;
  threadId: string;
  status: AgentThreadStatus;
}) {
  const result = await prisma.agentThread.updateMany({
    where: {
      id: params.threadId,
      investorId: params.investorId,
      agentType: params.agentType,
      status: { not: 'DELETED' },
    },
    data: { status: params.status, updatedAt: new Date() },
  });
  if (result.count === 0) throw Object.assign(new Error('Thread not found.'), { status: 404 });
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

  if (params.role === 'USER') {
    await prisma.agentThread.updateMany({
      where: {
        id: params.threadId,
        OR: [{ title: null }, { title: { in: PLACEHOLDER_THREAD_TITLES } }],
      },
      data: { title: summarizeThreadTitle(params.content) },
    });
  }

  return message;
}

export async function mergeThreadMessageMeta(params: {
  messageId: string;
  meta: Record<string, unknown>;
}) {
  const existing = await prisma.agentMessage.findUnique({
    where: { id: params.messageId },
    select: { meta: true },
  });
  const current = isRecord(existing?.meta) ? existing.meta : {};
  return prisma.agentMessage.update({
    where: { id: params.messageId },
    data: {
      meta: {
        ...current,
        ...params.meta,
      } as object,
    },
  });
}

export async function appendtoolCall(params: {
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
    meta?: unknown;
  }>
) {
  return messages
    .filter((message) => message.role === 'USER' || message.role === 'ASSISTANT')
    .map((message) => {
      const artifacts = extractMessageArtifacts(message.meta);
      const submission = extractMessageSubmission(message.meta);
      return {
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
        ...(artifacts.length > 0 ? { artifacts } : {}),
        ...(submission ? { submission } : {}),
      };
    });
}

function extractMessageSubmission(meta: unknown) {
  const record = isRecord(meta) ? meta : {};
  const submission = isRecord(record.submission) ? record.submission : null;
  if (!submission) return null;
  const status = typeof submission.status === 'string' ? submission.status.toUpperCase() : '';
  if (!['AUTHORIZING', 'QUEUED', 'RUNNING', 'REJECTED'].includes(status)) return null;
  return {
    status: status as 'AUTHORIZING' | 'QUEUED' | 'RUNNING' | 'REJECTED',
    runId: typeof submission.runId === 'string' ? submission.runId : null,
    code: typeof submission.code === 'string' ? submission.code : null,
    error: typeof submission.error === 'string' ? submission.error : null,
  };
}

function extractMessageArtifacts(meta: unknown) {
  const record = isRecord(meta) ? meta : {};
  const raw = isRecord(record.raw) ? record.raw : {};
  const generated = Array.isArray(raw.generatedArtifacts) ? raw.generatedArtifacts : [];
  return generated
    .map((item) => {
      if (!isRecord(item)) return null;
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'artifact';
      const downloadPath = typeof item.downloadPath === 'string' ? item.downloadPath.trim() : '';
      if (!downloadPath) return null;
      return {
        id: typeof item.id === 'string' ? item.id : '',
        name,
        kind: typeof item.kind === 'string' ? item.kind : 'generated_file',
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : null,
        sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : null,
        downloadPath,
      };
    })
    .filter((item): item is {
      id: string;
      name: string;
      kind: string;
      mimeType: string | null;
      sizeBytes: number | null;
      downloadPath: string;
    } => Boolean(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
