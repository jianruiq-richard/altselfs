import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createChatCompletion, createJsonChatCompletion, getOpenRouterModel, type ChatMessage } from '@/lib/openrouter';
import { getInvestorOrNull } from '@/lib/investor-auth';
import {
  appendThreadMessage,
  appendtoolCall,
  ensureThread,
  getLatestThreadWithMessages,
  toClientMessages,
} from '@/lib/agent-session';

const execFileAsync = promisify(execFile);
const XHS_PROVIDER = 'XIAOHONGSHU';
const MAX_CUSTOM_PROMPT_LENGTH = 8000;
const MAX_HISTORY = 10;

type ClientMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type PlannerAction = 'search_notes' | 'get_note_detail' | 'get_user_notes' | 'clarify';
type toolPlan = {
  action: PlannerAction;
  reason?: string;
  args?: {
    query?: string;
    noteUrl?: string;
    userUrl?: string;
    limit?: number;
  };
};

const DEFAULT_SKILL_SET = [
  {
    skill: 'xhs_search_notes',
    description: 'message, message, message, message.',
    trigger: 'message, message, message',
    source: 'Spider_XHS.apis.xhs_pc_apis.search_some_note',
  },
  {
    skill: 'xhs_get_note_detail',
    description: 'message (message, message, message, message), message.',
    trigger: 'message',
    source: 'Spider_XHS.apis.xhs_pc_apis.get_note_info',
  },
  {
    skill: 'xhs_get_user_notes',
    description: 'messageaccountsAllmessage (message), messageaccountsmessage.',
    trigger: 'messageaccountsmessage',
    source: 'Spider_XHS.apis.xhs_pc_apis.get_user_all_notes',
  },
];

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

function extractJsonObject(raw: string): string | null {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fence && fence.trim().startsWith('{') && fence.trim().endsWith('}')) return fence.trim();
  const left = raw.indexOf('{');
  const right = raw.lastIndexOf('}');
  if (left >= 0 && right > left) return raw.slice(left, right + 1);
  return null;
}

function safeParsePlan(raw: string): toolPlan {
  try {
    const parsed = JSON.parse(extractJsonObject(raw) ?? raw) as Partial<toolPlan>;
    const allowed = new Set<PlannerAction>(['search_notes', 'get_note_detail', 'get_user_notes', 'clarify']);
    const action = allowed.has(parsed.action as PlannerAction) ? (parsed.action as PlannerAction) : 'clarify';
    const limit = typeof parsed.args?.limit === 'number' ? Math.max(1, Math.min(30, Math.round(parsed.args.limit))) : undefined;
    return {
      action,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      args: {
        query: typeof parsed.args?.query === 'string' ? parsed.args.query.trim() : undefined,
        noteUrl: typeof parsed.args?.noteUrl === 'string' ? parsed.args.noteUrl.trim() : undefined,
        userUrl: typeof parsed.args?.userUrl === 'string' ? parsed.args.userUrl.trim() : undefined,
        limit,
      },
    };
  } catch {
    return { action: 'clarify', reason: 'planner parse failed', args: {} };
  }
}

function buildPlannerPrompt(input: { userQuery: string; messages: ClientMessage[] }) {
  const history = input.messages
    .slice(-MAX_HISTORY)
    .map((message, i) => `${i + 1}. [${message.role}] ${message.content}`)
    .join('\n');
  return [
    'messagetoolmessage, message JSON.',
    'message action, message args.',
    'action message: ',
    '1) search_notes: message',
    '2) get_note_detail: message (message noteUrl)',
    '3) get_user_notes: messageaccountsmessage (message userUrl)',
    '4) clarify: message',
    'JSON Schema:',
    '{',
    '  "action":"search_notes|get_note_detail|get_user_notes|clarify",',
    '  "reason":"message",',
    '  "args":{',
    '    "query":"message, message",',
    '    "noteUrl":"message, message",',
    '    "userUrl":"message, message",',
    '    "limit":10',
    '  }',
    '}',
    `message: ${input.userQuery}`,
    `message: \n${history || 'message'}`,
  ].join('\n');
}

function buildSystemPrompt(customPrompt?: string | null) {
  const lines = [
    'messageAI teammate (Claude Code Agent).',
    'message Spider_XHS message, message.',
    'message: ',
    '1) message3message, message, message.',
    '2) message, message.',
    '3) message: message, message, message.',
    '',
    'messageLearnmessage (message external_solutions/Spider_XHS): ',
    ...DEFAULT_SKILL_SET.map((item) => `- ${item.skill}: ${item.description} (message: ${item.trigger})`),
  ];
  if (customPrompt?.trim()) {
    lines.push('', 'message: ', customPrompt.trim());
  }
  return lines.join('\n');
}

async function runSpiderSkill(plan: toolPlan, cookies: string) {
  const remoteEndpoint = process.env.XHS_SPIDER_ENDPOINT;
  if (remoteEndpoint) {
    const res = await fetch(remoteEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: plan.action,
        args: plan.args || {},
        cookies,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `remote spider failed: ${res.status}`);
    }
    return data;
  }

  const script = path.join(process.cwd(), 'scripts', 'xhs_spider_bridge.py');
  const spiderRoot = path.join(process.cwd(), 'external_solutions', 'Spider_XHS');
  const payload = JSON.stringify({
    action: plan.action,
    args: plan.args || {},
    cookies,
    spiderRoot,
  });

  const { stdout, stderr } = await execFileAsync('python3', [script, payload], {
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (stderr?.trim()) {
    console.error('[xhs-assistant] spider stderr:', stderr.trim());
  }
  const raw = (stdout || '').trim();
  if (!raw) {
    throw new Error('Spider_XHS message');
  }
  const parsed = JSON.parse(raw) as { ok?: boolean; error?: string };
  if (parsed.ok === false) {
    throw new Error(parsed.error || 'Spider_XHS Execution failed');
  }
  return parsed;
}

async function upsertXhsIntegration(input: {
  investorId: string;
  customPrompt?: string;
  cookies?: string;
}) {
  const { investorId, customPrompt, cookies } = input;
  return prisma.investorIntegration.upsert({
    where: { investorId_provider: { investorId, provider: XHS_PROVIDER } },
    update: {
      status: 'CONNECTED',
      accountName: 'Xiaohongshu Assistant',
      ...(typeof customPrompt === 'string' ? { assistantCustomPrompt: customPrompt } : {}),
      ...(typeof cookies === 'string' ? { accessToken: cookies || null } : {}),
    },
    create: {
      investorId,
      provider: XHS_PROVIDER,
      status: 'CONNECTED',
      accountName: 'Xiaohongshu Assistant',
      assistantCustomPrompt: customPrompt || null,
      accessToken: typeof cookies === 'string' ? cookies || null : null,
    },
  });
}

export async function GET() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [integration, thread] = await Promise.all([
    prisma.investorIntegration.findUnique({
      where: { investorId_provider: { investorId: investor.id, provider: XHS_PROVIDER } },
    }),
    getLatestThreadWithMessages(investor.id, XHS_PROVIDER),
  ]);

  return NextResponse.json({
    integration: {
      connected: Boolean(integration),
      customPrompt: integration?.assistantCustomPrompt || '',
      cookiesConfigured: Boolean(integration?.accessToken || process.env.XHS_COOKIES),
    },
    skillSet: DEFAULT_SKILL_SET,
    runtime: {
      cookiesConfigured: Boolean(process.env.XHS_COOKIES),
      endpointConfigured: Boolean(process.env.XHS_SPIDER_ENDPOINT),
      spiderPath: 'external_solutions/Spider_XHS',
    },
    thread: thread
      ? {
          id: thread.id,
          messages: toClientMessages(thread.messages),
        }
      : null,
  });
}

export async function PUT(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { customPrompt?: unknown; cookies?: unknown } | null;
  const customPrompt = typeof body?.customPrompt === 'string' ? body.customPrompt.trim() : '';
  const cookies = typeof body?.cookies === 'string' ? body.cookies.trim() : undefined;
  if (customPrompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
    return NextResponse.json({ error: `message ${MAX_CUSTOM_PROMPT_LENGTH} message` }, { status: 400 });
  }

  const integration = await upsertXhsIntegration({ investorId: investor.id, customPrompt, cookies });
  return NextResponse.json({
    ok: true,
    integration: {
      provider: integration.provider,
      customPrompt: integration.assistantCustomPrompt || '',
      cookiesConfigured: Boolean(integration.accessToken || process.env.XHS_COOKIES),
      updatedAt: integration.updatedAt.toISOString(),
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
    return NextResponse.json({ error: 'messagemessagesmessage' }, { status: 400 });
  }

  const [integration, thread] = await Promise.all([
    prisma.investorIntegration.findUnique({
      where: { investorId_provider: { investorId: investor.id, provider: XHS_PROVIDER } },
    }),
    ensureThread({
      investorId: investor.id,
      agentType: XHS_PROVIDER,
      threadId: body?.threadId || null,
    }),
  ]);

  await appendThreadMessage({ threadId: thread.id, role: 'USER', content: latest.content });

  const cookies = integration?.accessToken || process.env.XHS_COOKIES || '';
  const endpointConfigured = Boolean(process.env.XHS_SPIDER_ENDPOINT);
  if (!cookies && !endpointConfigured) {
    const reply = 'message: message Cookie (message XHS_COOKIES), message XHS_SPIDER_ENDPOINT.';
    await appendThreadMessage({ threadId: thread.id, role: 'ASSISTANT', content: reply });
    return NextResponse.json({
      threadId: thread.id,
      reply,
      messages: [...messages, { role: 'assistant', content: reply }],
    });
  }

  let plan: toolPlan = { action: 'clarify', reason: 'default', args: {} };
  try {
    const plannerMessages: ChatMessage[] = [
      { role: 'system', content: buildPlannerPrompt({ userQuery: latest.content, messages }) },
      { role: 'user', content: latest.content },
    ];
    const plannerRaw = await createJsonChatCompletion(
      plannerMessages,
      getOpenRouterModel('XHS_PLANNER')
    );
    plan = safeParsePlan(plannerRaw);
    await appendtoolCall({
      threadId: thread.id,
      toolName: 'xhs_planner',
      toolArgs: { userQuery: latest.content },
      toolResult: plan,
    });
  } catch (error) {
    console.error('[xhs-assistant] planner failed:', error);
  }

  if (plan.action === 'clarify') {
    const reply = 'message.message, messageaccountsmessage.';
    await appendThreadMessage({ threadId: thread.id, role: 'ASSISTANT', content: reply });
    return NextResponse.json({
      threadId: thread.id,
      reply,
      plan,
      messages: [...messages, { role: 'assistant', content: reply }],
    });
  }

  let toolResult: unknown = null;
  let reply = '';
  try {
    toolResult = await runSpiderSkill(plan, cookies);
    await appendtoolCall({
      threadId: thread.id,
      toolName: `xhs_${plan.action}`,
      toolArgs: plan.args || {},
      toolResult,
    });

    const finalMessages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(integration?.assistantCustomPrompt) },
      {
        role: 'user',
        content: [
          `message: ${latest.content}`,
          `message: ${plan.action}`,
          `message: ${JSON.stringify(toolResult, null, 2)}`,
          'message: 3message + message + message.',
        ].join('\n\n'),
      },
    ];
    reply = await createChatCompletion(
      finalMessages,
      getOpenRouterModel('XHS_ASSISTANT')
    );

    const current = await upsertXhsIntegration({
      investorId: investor.id,
      customPrompt: integration?.assistantCustomPrompt || '',
    });
    await prisma.integrationSnapshot.create({
      data: {
        integrationId: current.id,
        provider: XHS_PROVIDER,
        summary: reply.slice(0, 2000),
        raw: JSON.parse(JSON.stringify({ plan, toolResult })) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reply = `messagefailed: ${detail}`;
  }

  await appendThreadMessage({ threadId: thread.id, role: 'ASSISTANT', content: reply });
  return NextResponse.json({
    threadId: thread.id,
    reply,
    plan,
    toolResult,
    messages: [...messages, { role: 'assistant', content: reply }],
  });
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
      agentType: XHS_PROVIDER,
    },
  });
  return NextResponse.json({ ok: true });
}
