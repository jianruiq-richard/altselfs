import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createChatCompletion, createJsonChatCompletion, getOpenRouterModelCandidates, type ChatMessage } from '@/lib/openrouter';
import { getInvestorOrNull } from '@/lib/investor-auth';
import {
  appendThreadMessage,
  appendtoolCall,
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
  return getOpenRouterModelCandidates(['MAIL_AGENT_PRIMARY', 'MAIL_AGENT_FALLBACK']);
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
  const providerLabel = provider === 'gmail' ? 'Gmail' : 'Lark';
  const lines: string[] = [];
  lines.push(`Provider: ${providerLabel}`);
  lines.push(`Latest summary: ${summary || 'No summary available yet. Click "Refresh summary" first if you need account context.'}`);

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
      lines.push(`Email account: ${r.profile.emailAddress}`);
    }
    if (typeof r.profile?.messagesTotal === 'number') {
      lines.push(`Total messages reported by Gmail: ${r.profile.messagesTotal}`);
    }
    if (typeof r.profile?.threadsTotal === 'number') {
      lines.push(`Total threads reported by Gmail: ${r.profile.threadsTotal}`);
    }

    if (Array.isArray(r.allMessages) && r.allMessages.length > 0) {
      const total = r.allMessages.length;
      const unread = r.allMessages.filter((m) => Boolean(m.status?.unread)).length;
      const important = r.allMessages.filter((m) => Boolean(m.status?.important)).length;
      const withAttachments = r.allMessages.filter((m) => (m.attachments?.length || 0) > 0).length;
      const withBody = r.allMessages.filter((m) => Boolean((m.bodyText || '').trim())).length;
      lines.push(
        `Snapshot: ${total} messages (unread ${unread}, important ${important}, with attachments ${withAttachments}${r.hasMore ? `, capped at ${r.maxMessages || 'N/A'}` : ''})`
      );
      lines.push(`Message bodies available for ${withBody}/${total} messages.`);

      const top = r.allMessages.slice(0, 12).map((m, idx) => {
        const subject = (m.subject || '(no subject)').trim();
        const from = (m.from || 'Unknown sender').trim();
        const snippet = (m.snippet || '').trim().slice(0, 120);
        const bodyPreview = (m.bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 220);
        const status = [
          m.status?.unread ? 'unread' : null,
          m.status?.important ? 'important' : null,
          m.status?.starred ? 'starred' : null,
          m.status?.inbox ? 'inbox' : null,
          m.status?.sent ? 'sent' : null,
          m.status?.draft ? 'draft' : null,
          m.status?.trash ? 'trash' : null,
          m.status?.spam ? 'spam' : null,
        ]
          .filter(Boolean)
          .join('/');
        const attachSummary =
          m.attachments && m.attachments.length > 0
            ? m.attachments
                .slice(0, 4)
                .map((a) => `${a.filename || 'unnamed'}(${a.mimeType || 'unknown'},${a.size || 0}B)`)
                .join(', ')
            : 'none';
        return [
          `${idx + 1}. ${subject} (${from})`,
          `   received: ${m.receivedAt || m.date || 'unknown'} | status: ${status || 'normal'}`,
          `   attachments: ${attachSummary}`,
          `   snippet: ${snippet || 'none'}`,
          `   body preview: ${bodyPreview || 'none'}`,
        ].join('\n');
      });

      lines.push(`Recent messages:\n${top.join('\n')}`);

      const fullBodyItems = r.allMessages
        .filter((m) => Boolean((m.bodyText || '').trim()))
        .slice(0, 3)
        .map((m, idx) => {
          const subject = (m.subject || '(no subject)').trim();
          const from = (m.from || 'Unknown sender').trim();
          const body = (m.bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 6000);
          return [
            `[Full body ${idx + 1}] ${subject} (${from})`,
            `received: ${m.receivedAt || m.date || 'unknown'}`,
            'body preview (first 6000 chars):',
            body || 'none',
          ].join('\n');
        });

      if (fullBodyItems.length > 0) {
        lines.push(`Full body previews:\n${fullBodyItems.join('\n\n')}`);
      }
    }
  }

  return lines.join('\n');
}

function buildSystemPrompt(provider: 'gmail' | 'feishu', customPrompt?: string | null) {
  const providerLabel = provider === 'gmail' ? 'Gmail' : 'Lark';
  const base = [
    `You are the ${providerLabel} AI teammate.`,
    'Core responsibilities:',
    '1) Help the user understand and act on connected account context.',
    '2) Summarize messages, docs, calendar items, and action items when available.',
    '3) Be concise, specific, and professional by default.',
    'Response rules:',
    '1) Use the provided account summary and context; do not invent unseen messages.',
    '2) If the context is stale or missing, ask the user to refresh the summary.',
    '3) Call out uncertainty and missing data clearly.',
    '4) When referencing counts, use the format "source coverage: X/Y" when applicable.',
  ];

  const normalized = customPrompt?.trim();
  if (normalized) {
    base.push('Custom coaching:');
    base.push(normalized);
  }

  return base.join('\n');
}

function buildRealtimePlannerPrompt(conversation: ClientMessage[], customPrompt?: string | null) {
  const blocks = [
    'Plan the next Gmail tool action. You have access to realtime Gmail API tools.',
    'Return strict JSON only.',
    'Available actions:',
    '1) list_recent: list recent messages, optionally constrained by a query',
    '2) list_unread: list unread messages, optionally constrained by a query',
    '3) search_messages: search messages with a Gmail query',
    '4) read_message: read one message by messageId',
    '5) send_email: send an email',
    '6) snapshot_answer: answer from current context without a tool call',
    '7) clarify: ask a clarifying question',
    '',
    'JSON schema:',
    '{',
    '  "action": "list_recent|list_unread|search_messages|read_message|send_email|snapshot_answer|clarify",',
    '  "reason": "why this action is appropriate",',
    '  "args": {',
    '    "maxResults": 1-20,',
    '    "query": "Gmail search query",',
    '    "messageId": "Gmail message ID",',
    '    "to": "recipient email",',
    '    "cc": "optional cc email",',
    '    "bcc": "optional bcc email",',
    '    "subject": "email subject",',
    '    "body": "email body"',
    '  }',
    '}',
    '',
    'Rules:',
    '- If the user refers to a specific email, use read_message when you have a messageId.',
    '- If the user asks for matching emails, use search_messages.',
    '- If the user asks you to send or draft-and-send an email with all required fields, use send_email.',
    '- Use clarify when required fields or intent are missing.',
    '',
  ];

  if (customPrompt?.trim()) {
    blocks.push('Custom coaching:');
    blocks.push(customPrompt.trim());
    blocks.push('');
  }

  blocks.push(
    'Conversation:',
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
        'You are the Gmail AI teammate.',
        'Use the tool result to answer the user directly.',
        'Rules:',
        '1) Be concise and specific.',
        '2) When listing emails, include messageId when the user may need to read or reference a message.',
        '3) When summarizing, separate Summary, Action Items, and Draft Reply when useful.',
        '4) If an email was sent, include the sent message ID.',
        '5) Do not claim tool results you did not receive.',
        input.customPrompt?.trim() ? `Custom coaching:\n${input.customPrompt.trim()}` : '',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Conversation (latest first not guaranteed): ${JSON.stringify(input.userMessages.slice(-8))}`,
        `Planner action: ${JSON.stringify(input.plan)}`,
        `Tool result: ${JSON.stringify(input.toolResult)}`,
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
        { error: `Connect a ${provider === 'gmail' ? 'Gmail' : 'Lark'} account first.` },
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
        return { action: 'clarify', error: 'Please provide a Gmail search query.' };
      }
      const maxResults = Math.max(1, Math.min(Number(args.maxResults || 8), 20));
      const items = await searchGmailMessages(accessToken, { query, maxResults, includeSpamTrash: false });
      return { action: plan.action, query, items };
    }
    case 'read_message': {
      const messageId = String(args.messageId || '').trim();
      if (!messageId) {
        return { action: 'clarify', error: 'Please provide the Gmail messageId to read.' };
      }
      const item = await getGmailMessageById(accessToken, messageId);
      return { action: plan.action, item };
    }
    case 'send_email': {
      const to = String(args.to || '').trim();
      const subject = String(args.subject || '').trim();
      const body = String(args.body || '').trim();
      if (!to || !subject || !body) {
        return { action: 'clarify', error: 'Please provide the recipient, subject, and body before sending email.' };
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
    return NextResponse.json({ error: 'message' }, { status: 400 });
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
      { role: 'system', content: `Account context:\n${context}` },
      ...messages,
    ];

    try {
      const result = await runMailAgentText(aiMessages);
      await appendThreadMessage({
        threadId: thread.id,
        role: 'ASSISTANT',
        content: result.content || 'Received, but no reply is available yet.',
        meta: { model: result.model },
      });
      return NextResponse.json({ reply: result.content, model: result.model, threadId: thread.id });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown';
      return NextResponse.json({ error: `AI assistant failed: ${detail}` }, { status: 500 });
    }
  }

  try {
    const accessToken = await getActiveGmailToken(integration);

    const plannerMessages: ChatMessage[] = [
      {
        role: 'system',
        content: 'Return valid JSON only. Do not include Markdown or explanatory text.',
      },
      {
        role: 'user',
        content: buildRealtimePlannerPrompt(messages, customPrompt),
      },
    ];

    const planner = await runMailAgentJson(plannerMessages);
    const plan = safeParsePlan(planner.content);
    await appendtoolCall({
      threadId: thread.id,
      messageId: userMessageId,
      toolName: 'gmail_planner',
      status: 'SUCCESS',
      toolArgs: { messages: messages.slice(-8) },
      toolResult: { plan, model: planner.model },
    });
    const toolResult = await executeGmailPlan(accessToken, plan);
    await appendtoolCall({
      threadId: thread.id,
      messageId: userMessageId,
      toolName: `gmail_${plan.action}`,
      status: 'SUCCESS',
      toolArgs: plan.args,
      toolResult,
    });

    if ((toolResult as { action?: string }).action === 'clarify') {
      const clarify = (toolResult as { error?: string; note?: string }).error || 'Please clarify what you want me to do.';
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
            'You are the Gmail AI teammate. Answer from the available conversation context without calling tools.',
            customPrompt?.trim() ? `Custom coaching:\n${customPrompt.trim()}` : '',
          ].join('\n'),
        },
        ...messages,
      ]);
      await appendThreadMessage({
        threadId: thread.id,
        role: 'ASSISTANT',
        content: result.content || 'Received, but no reply is available yet.',
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
      content: final.content || 'Received, but no reply is available yet.',
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
            'Gmail needs additional authorization scopes. Reconnect Gmail and try again.',
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: `AI assistant execution failed: ${detail}` }, { status: 500 });
  }
}
