import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createChatCompletion, createJsonChatCompletion, type ChatMessage } from '@/lib/openrouter';
import { getInvestorOrNull } from '@/lib/investor-auth';
import {
  appendThreadMessage,
  appendToolCall,
  ensureThread,
  getLatestThreadWithMessages,
  toClientMessages,
  type AgentType,
} from '@/lib/agent-session';
import {
  getGmailMessageById,
  parseProvider,
  providerToDb,
  refreshGoogleAccessToken,
  searchGmailMessages,
  sendGmailMessage,
} from '@/lib/integrations';

type ClientMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type GmailPlanAction =
  | 'list_recent'
  | 'list_unread'
  | 'search_messages'
  | 'read_message'
  | 'send_email'
  | 'snapshot_answer'
  | 'clarify';

type GmailPlan = {
  action: GmailPlanAction;
  reason?: string;
  args?: {
    maxResults?: number;
    query?: string;
    messageId?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
  };
};

const MAX_CUSTOM_PROMPT_LENGTH = 8000;

function getMailAgentModelCandidates() {
  const models = [
    process.env.OPENROUTER_MODEL_MAIL_AGENT_PRIMARY || 'openai/gpt-5.2',
    process.env.OPENROUTER_MODEL_MAIL_AGENT_FALLBACK || 'openai/gpt-5.2-mini',
    process.env.OPENROUTER_MODEL_PRIMARY,
    process.env.OPENROUTER_MODEL_FALLBACK,
    process.env.OPENROUTER_MODEL_BACKUP,
    'openai/gpt-4o-mini',
  ].filter(Boolean) as string[];

  const seen = new Set<string>();
  return models.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });
}

async function runMailAgentText(messages: ChatMessage[]) {
  const candidates = getMailAgentModelCandidates();
  let lastError: unknown;

  for (const model of candidates) {
    try {
      const content = await createChatCompletion(messages, model);
      return { content, model };
    } catch (error) {
      lastError = error;
      console.error(`[mail-agent] text model failed (${model}):`, error);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : 'unknown';
  throw new Error(`Mail agent text failed across models [${candidates.join(', ')}]: ${detail}`);
}

async function runMailAgentJson(messages: ChatMessage[]) {
  const candidates = getMailAgentModelCandidates();
  let lastError: unknown;

  for (const model of candidates) {
    try {
      const content = await createJsonChatCompletion(messages, model);
      return { content, model };
    } catch (error) {
      lastError = error;
      console.error(`[mail-agent] json model failed (${model}):`, error);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : 'unknown';
  throw new Error(`Mail agent json failed across models [${candidates.join(', ')}]: ${detail}`);
}

function extractJsonObject(raw: string): string | null {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    const candidate = fenceMatch[1].trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) {
      return candidate;
    }
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function safeParsePlan(raw: string): GmailPlan {
  try {
    const parsed = JSON.parse(extractJsonObject(raw) ?? raw) as Partial<GmailPlan>;
    const allowed = new Set<GmailPlanAction>([
      'list_recent',
      'list_unread',
      'search_messages',
      'read_message',
      'send_email',
      'snapshot_answer',
      'clarify',
    ]);

    const action = allowed.has(parsed.action as GmailPlanAction)
      ? (parsed.action as GmailPlanAction)
      : 'clarify';

    return {
      action,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      args: parsed.args && typeof parsed.args === 'object' ? parsed.args : {},
    };
  } catch {
    return { action: 'clarify', reason: 'planner parse failed', args: {} };
  }
}

function buildProviderContext(provider: 'gmail' | 'feishu', summary: string | null, raw: unknown) {
  const providerLabel = provider === 'gmail' ? 'Gmail' : '飞书';
  const lines: string[] = [];
  lines.push(`当前渠道：${providerLabel}`);
  lines.push(`最近摘要：${summary || '暂无摘要，请先点击“刷新摘要”。'}`);

  if (provider === 'gmail' && raw && typeof raw === 'object') {
    const r = raw as {
      profile?: { emailAddress?: string; messagesTotal?: number; threadsTotal?: number };
      hasMore?: boolean;
      maxMessages?: number;
      allMessages?: Array<{
        subject?: string;
        from?: string;
        snippet?: string;
        bodyText?: string;
        date?: string;
        receivedAt?: string | null;
        attachments?: Array<{
          filename?: string;
          mimeType?: string;
          size?: number;
          hasAttachmentId?: boolean;
        }>;
        status?: {
          unread?: boolean;
          important?: boolean;
          starred?: boolean;
          inbox?: boolean;
          sent?: boolean;
          draft?: boolean;
          trash?: boolean;
          spam?: boolean;
          categories?: string[];
          labels?: string[];
        };
      }>;
    };
    if (r.profile?.emailAddress) {
      lines.push(`邮箱账号：${r.profile.emailAddress}`);
    }
    if (typeof r.profile?.messagesTotal === 'number') {
      lines.push(`总邮件数：${r.profile.messagesTotal}`);
    }
    if (typeof r.profile?.threadsTotal === 'number') {
      lines.push(`总线程数：${r.profile.threadsTotal}`);
    }

    if (Array.isArray(r.allMessages) && r.allMessages.length > 0) {
      const total = r.allMessages.length;
      const unread = r.allMessages.filter((m) => Boolean(m.status?.unread)).length;
      const important = r.allMessages.filter((m) => Boolean(m.status?.important)).length;
      const withAttachments = r.allMessages.filter((m) => (m.attachments?.length || 0) > 0).length;
      const withBody = r.allMessages.filter((m) => Boolean((m.bodyText || '').trim())).length;
      lines.push(
        `全量同步邮件：${total} 封（未读 ${unread}，重要 ${important}，含附件 ${withAttachments}${r.hasMore ? `，已达上限 ${r.maxMessages || 'N/A'}` : ''}）`
      );
      lines.push(`正文同步状态：已同步 ${withBody}/${total} 封邮件正文。`);

      const top = r.allMessages.slice(0, 12).map((m, idx) => {
        const subject = (m.subject || '无主题').trim();
        const from = (m.from || '未知发件人').trim();
        const snippet = (m.snippet || '').trim().slice(0, 120);
        const bodyPreview = (m.bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 220);
        const status = [
          m.status?.unread ? '未读' : null,
          m.status?.important ? '重要' : null,
          m.status?.starred ? '星标' : null,
          m.status?.inbox ? '收件箱' : null,
          m.status?.sent ? '已发送' : null,
          m.status?.draft ? '草稿' : null,
          m.status?.trash ? '垃圾箱' : null,
          m.status?.spam ? '垃圾邮件' : null,
        ]
          .filter(Boolean)
          .join('/');
        const attachSummary =
          m.attachments && m.attachments.length > 0
            ? m.attachments
                .slice(0, 4)
                .map((a) => `${a.filename || 'unnamed'}(${a.mimeType || 'unknown'},${a.size || 0}B)`)
                .join(', ')
            : '无';
        return [
          `${idx + 1}. ${subject}（${from}）`,
          `   时间：${m.receivedAt || m.date || '未知'} | 状态：${status || '普通'}`,
          `   附件：${attachSummary}`,
          `   片段：${snippet || '无'}`,
          `   正文预览：${bodyPreview || '无'}`,
        ].join('\n');
      });

      lines.push(`最近邮件详情：\n${top.join('\n')}`);

      const fullBodyItems = r.allMessages
        .filter((m) => Boolean((m.bodyText || '').trim()))
        .slice(0, 3)
        .map((m, idx) => {
          const subject = (m.subject || '无主题').trim();
          const from = (m.from || '未知发件人').trim();
          const body = (m.bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 6000);
          return [
            `[全文${idx + 1}] ${subject}（${from}）`,
            `时间：${m.receivedAt || m.date || '未知'}`,
            `正文全文（截断上限6000字符）：`,
            body || '无',
          ].join('\n');
        });

      if (fullBodyItems.length > 0) {
        lines.push(`可深读正文：\n${fullBodyItems.join('\n\n')}`);
      }
    }
  }

  return lines.join('\n');
}

function buildSystemPrompt(provider: 'gmail' | 'feishu', customPrompt?: string | null) {
  const providerLabel = provider === 'gmail' ? 'Gmail' : '飞书';
  const base = [
    `你是投资人的“${providerLabel} 消息AI员工”。`,
    '你的工作是：',
    '1) 基于已提供的渠道数据回答问题并给出清晰下一步建议；',
    '2) 主动按优先级梳理待处理事项（高/中/低）；',
    '3) 输出尽量简洁，默认中文，优先给可执行建议。',
    '限制：',
    '1) 只能使用上下文中给出的信息，不要编造未给出的邮件/消息；',
    '2) 信息不足时明确指出缺失项，并提示用户点击“刷新摘要”；',
    '3) 当用户要求写回复时，给出可直接复制的草稿。',
    '4) 若上下文中出现“正文同步状态：已同步 X/Y”，且 X>0，不要再声称“正文未同步”。',
  ];

  const normalized = customPrompt?.trim();
  if (normalized) {
    base.push('用户自定义调教要求：');
    base.push(normalized);
  }

  return base.join('\n');
}

function buildRealtimePlannerPrompt(conversation: ClientMessage[], customPrompt?: string | null) {
  const blocks = [
    '你是 Gmail 实时代理的工具调度器。你的唯一任务是选择下一步要调用的 Gmail API。',
    '你必须只返回 JSON，不要输出任何其他文字。',
    '可选 action：',
    '1) list_recent: 拉取最近邮件（无需 query）',
    '2) list_unread: 拉取未读邮件（无需 query）',
    '3) search_messages: 按 query 搜索邮件',
    '4) read_message: 按 messageId 读取单封邮件正文',
    '5) send_email: 发送邮件',
    '6) snapshot_answer: 不需要 API，直接基于现有聊天回复',
    '7) clarify: 信息不足，先问澄清问题',
    '',
    'JSON schema:',
    '{',
    '  "action": "list_recent|list_unread|search_messages|read_message|send_email|snapshot_answer|clarify",',
    '  "reason": "短原因",',
    '  "args": {',
    '    "maxResults": 1-20,',
    '    "query": "搜索语句",',
    '    "messageId": "邮件ID",',
    '    "to": "收件人邮箱",',
    '    "cc": "抄送邮箱(可选)",',
    '    "bcc": "密送邮箱(可选)",',
    '    "subject": "主题",',
    '    "body": "正文"',
    '  }',
    '}',
    '',
    '规则：',
    '- 用户明确要求“查某封邮件/看正文”时优先 read_message。',
    '- 用户要求“搜索/筛选某主题”时用 search_messages。',
    '- 用户要求“发邮件/回邮件”且给出收件人+内容时用 send_email。',
    '- 缺关键参数就用 clarify。',
    '',
  ];

  if (customPrompt?.trim()) {
    blocks.push('用户给你的调教偏好（必须尽量遵循）：');
    blocks.push(customPrompt.trim());
    blocks.push('');
  }

  blocks.push(
    '最近对话：',
    ...conversation.map((m, idx) => `${idx + 1}. [${m.role}] ${m.content}`)
  );

  return blocks.join('\n');
}

async function buildRealtimeFinalReply(input: {
  userMessages: ClientMessage[];
  plan: GmailPlan;
  toolResult: unknown;
  customPrompt?: string | null;
}) {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是投资人的 Gmail 实时代理。',
        '你已经拿到了工具执行结果，请给出最终答复。',
        '要求：',
        '1) 简洁中文。',
        '2) 如果是邮件列表，请按优先级输出并附上 messageId（用于下一轮 read_message）。',
        '3) 如果是读取单封邮件，给“关键信息摘要 + 下一步建议 + 可回复草稿(如适用)”。',
        '4) 如果是发信成功，明确返回发送成功和 messageId。',
        '5) 不要编造工具结果中不存在的信息。',
        input.customPrompt?.trim() ? `用户自定义调教要求：\n${input.customPrompt.trim()}` : '',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `用户对话（最近）：${JSON.stringify(input.userMessages.slice(-8))}`,
        `工具决策：${JSON.stringify(input.plan)}`,
        `工具结果：${JSON.stringify(input.toolResult)}`,
      ].join('\n\n'),
    },
  ];

  return runMailAgentText(messages);
}

function normalizeCustomPrompt(input: unknown) {
  const prompt = String(input ?? '').trim();
  if (!prompt) return null;
  return prompt.slice(0, MAX_CUSTOM_PROMPT_LENGTH);
}

async function resolveInvestorAndProvider(
  req: NextRequest,
  params: Promise<{ provider: string }>
) {
  const investor = await getInvestorOrNull();
  if (!investor) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }

  const { provider: rawProvider } = await params;
  const provider = parseProvider(rawProvider);
  if (!provider) {
    return { error: NextResponse.json({ error: 'Unsupported provider' }, { status: 400 }) } as const;
  }

  const integration = await prisma.investorIntegration.findUnique({
    where: {
      investorId_provider: {
        investorId: investor.id,
        provider: providerToDb(provider),
      },
    },
  });

  if (!integration) {
    return {
      error: NextResponse.json(
        { error: `请先绑定${provider === 'gmail' ? 'Gmail' : '飞书'}账号` },
        { status: 400 }
      ),
    } as const;
  }

  return { investor, provider, integration, req } as const;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const resolved = await resolveInvestorAndProvider(req, params);
  if ('error' in resolved) return resolved.error;

  const agentType = providerToDb(resolved.provider) as AgentType;
  const thread = await getLatestThreadWithMessages(resolved.investor.id, agentType);

  return NextResponse.json({
    provider: resolved.provider,
    customPrompt: resolved.integration.assistantCustomPrompt || '',
    thread: thread
      ? {
          id: thread.id,
          messages: toClientMessages(thread.messages),
        }
      : null,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const resolved = await resolveInvestorAndProvider(req, params);
  if ('error' in resolved) return resolved.error;

  const body = (await req.json().catch(() => ({}))) as { customPrompt?: unknown };
  const customPrompt = normalizeCustomPrompt(body.customPrompt);

  const updated = await prisma.investorIntegration.update({
    where: { id: resolved.integration.id },
    data: {
      assistantCustomPrompt: customPrompt,
    },
    select: {
      id: true,
      provider: true,
      assistantCustomPrompt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    integration: {
      id: updated.id,
      provider: updated.provider,
      customPrompt: updated.assistantCustomPrompt || '',
      updatedAt: updated.updatedAt,
    },
  });
}

async function executeGmailPlan(accessToken: string, plan: GmailPlan) {
  const args = plan.args || {};

  switch (plan.action) {
    case 'list_recent': {
      const maxResults = Math.max(1, Math.min(Number(args.maxResults || 8), 20));
      const items = await searchGmailMessages(accessToken, { maxResults, includeSpamTrash: false });
      return { action: plan.action, items };
    }
    case 'list_unread': {
      const maxResults = Math.max(1, Math.min(Number(args.maxResults || 8), 20));
      const items = await searchGmailMessages(accessToken, {
        maxResults,
        includeSpamTrash: false,
        query: 'is:unread',
      });
      return { action: plan.action, items };
    }
    case 'search_messages': {
      const query = String(args.query || '').trim();
      if (!query) {
        return { action: 'clarify', error: '缺少搜索条件，请补充关键词或 Gmail 查询语法。' };
      }
      const maxResults = Math.max(1, Math.min(Number(args.maxResults || 8), 20));
      const items = await searchGmailMessages(accessToken, { query, maxResults, includeSpamTrash: false });
      return { action: plan.action, query, items };
    }
    case 'read_message': {
      const messageId = String(args.messageId || '').trim();
      if (!messageId) {
        return { action: 'clarify', error: '缺少 messageId，请先让我列出邮件并选择一封。' };
      }
      const item = await getGmailMessageById(accessToken, messageId);
      return { action: plan.action, item };
    }
    case 'send_email': {
      const to = String(args.to || '').trim();
      const subject = String(args.subject || '').trim();
      const body = String(args.body || '').trim();
      if (!to || !subject || !body) {
        return { action: 'clarify', error: '发信缺少必要参数（to/subject/body）。' };
      }
      const sent = await sendGmailMessage(accessToken, {
        to,
        cc: typeof args.cc === 'string' ? args.cc : undefined,
        bcc: typeof args.bcc === 'string' ? args.bcc : undefined,
        subject,
        body,
      });
      return { action: plan.action, sent };
    }
    case 'snapshot_answer':
      return { action: plan.action, note: 'planner chose no-tool answer' };
    case 'clarify':
      return { action: plan.action, note: 'planner needs clarification' };
    default:
      return { action: 'clarify', note: 'unknown action' };
  }
}

async function getActiveGmailToken(integration: {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
}) {
  if (!integration.accessToken) {
    throw new Error('Gmail token missing, please reconnect account.');
  }

  if (
    integration.refreshToken &&
    integration.expiresAt &&
    integration.expiresAt.getTime() < Date.now() + 60_000
  ) {
    const refreshed = await refreshGoogleAccessToken(integration.refreshToken);
    const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

    await prisma.investorIntegration.update({
      where: { id: integration.id },
      data: {
        accessToken: refreshed.access_token,
        scope: refreshed.scope ?? undefined,
        expiresAt,
      },
    });

    return refreshed.access_token;
  }

  return integration.accessToken;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const resolved = await resolveInvestorAndProvider(req, params);
  if ('error' in resolved) return resolved.error;
  const { provider, integration } = resolved;

  const body = (await req.json().catch(() => ({}))) as { messages?: ClientMessage[]; threadId?: string };
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages = incoming
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .filter((m) => m.content.length > 0)
    .slice(-20);

  if (messages.length === 0) {
    return NextResponse.json({ error: '缺少对话内容' }, { status: 400 });
  }

  const thread = await ensureThread({
    investorId: resolved.investor.id,
    agentType: providerToDb(provider) as AgentType,
    threadId: typeof body.threadId === 'string' ? body.threadId : null,
  });

  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  let userMessageId: string | null = null;
  if (lastUser) {
    const saved = await appendThreadMessage({
      threadId: thread.id,
      role: 'USER',
      content: lastUser.content,
    });
    userMessageId = saved.id;
  }

  const customPrompt = integration.assistantCustomPrompt || null;

  if (provider !== 'gmail') {
    const latestSnapshot = await prisma.integrationSnapshot.findFirst({
      where: { integrationId: integration.id },
      orderBy: { createdAt: 'desc' },
    });

    const context = buildProviderContext(provider, latestSnapshot?.summary || null, latestSnapshot?.raw);

    const aiMessages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(provider, customPrompt) },
      { role: 'system', content: `渠道上下文：\n${context}` },
      ...messages,
    ];

    try {
      const result = await runMailAgentText(aiMessages);
      await appendThreadMessage({
        threadId: thread.id,
        role: 'ASSISTANT',
        content: result.content || '已收到，但暂无回复。',
        meta: { model: result.model },
      });
      return NextResponse.json({ reply: result.content, model: result.model, threadId: thread.id });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown';
      return NextResponse.json({ error: `AI回复失败：${detail}` }, { status: 500 });
    }
  }

  try {
    const accessToken = await getActiveGmailToken(integration);

    const plannerMessages: ChatMessage[] = [
      {
        role: 'system',
        content: '你是严格 JSON 规划器。只输出 JSON 对象。',
      },
      {
        role: 'user',
        content: buildRealtimePlannerPrompt(messages, customPrompt),
      },
    ];

    const planner = await runMailAgentJson(plannerMessages);
    const plan = safeParsePlan(planner.content);
    await appendToolCall({
      threadId: thread.id,
      messageId: userMessageId,
      toolName: 'gmail_planner',
      status: 'SUCCESS',
      toolArgs: { messages: messages.slice(-8) },
      toolResult: { plan, model: planner.model },
    });
    const toolResult = await executeGmailPlan(accessToken, plan);
    await appendToolCall({
      threadId: thread.id,
      messageId: userMessageId,
      toolName: `gmail_${plan.action}`,
      status: 'SUCCESS',
      toolArgs: plan.args,
      toolResult,
    });

    if ((toolResult as { action?: string }).action === 'clarify') {
      const clarify = (toolResult as { error?: string; note?: string }).error || '请补充更具体的操作目标。';
      await appendThreadMessage({
        threadId: thread.id,
        role: 'ASSISTANT',
        content: clarify,
        meta: { plannerModel: planner.model, plan },
      });
      return NextResponse.json({ reply: clarify, planner: plan, toolResult, model: planner.model, threadId: thread.id });
    }

    if (plan.action === 'snapshot_answer') {
      const result = await runMailAgentText([
        {
          role: 'system',
          content: [
            '你是投资人的 Gmail 助手。基于当前对话直接回答，不调用工具。',
            customPrompt?.trim() ? `用户自定义调教要求：\n${customPrompt.trim()}` : '',
          ].join('\n'),
        },
        ...messages,
      ]);
      await appendThreadMessage({
        threadId: thread.id,
        role: 'ASSISTANT',
        content: result.content || '已收到，但暂无回复。',
        meta: { model: result.model, plan },
      });
      return NextResponse.json({ reply: result.content, planner: plan, toolResult, model: result.model, threadId: thread.id });
    }

    const final = await buildRealtimeFinalReply({
      userMessages: messages,
      plan,
      toolResult,
      customPrompt,
    });

    await appendThreadMessage({
      threadId: thread.id,
      role: 'ASSISTANT',
      content: final.content || '已收到，但暂无回复。',
      meta: {
        plannerModel: planner.model,
        responderModel: final.model,
        plan,
      },
    });

    return NextResponse.json({
      reply: final.content,
      planner: plan,
      toolResult,
      model: {
        planner: planner.model,
        responder: final.model,
      },
      threadId: thread.id,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    if (String(detail).toLowerCase().includes('insufficient authentication scopes')) {
      return NextResponse.json(
        {
          error:
            '当前 Gmail 授权范围不足以执行该操作（例如发信）。请在投资人面板点击“重新绑定 Gmail”后重试。',
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: `AI代理执行失败：${detail}` }, { status: 500 });
  }
}
