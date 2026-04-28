import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createChatCompletion, createJsonChatCompletion, type ChatMessage } from '@/lib/openrouter';
import { getInvestorOrNull } from '@/lib/investor-auth';
import {
  appendThreadMessage,
  appendToolCall,
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
type ToolPlan = {
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
    description: '按关键词抓取小红书笔记列表，适合赛道动态、竞品内容监控、声量观察。',
    trigger: '用户询问某赛道关键词近期有什么内容、爆文、趋势',
    source: 'Spider_XHS.apis.xhs_pc_apis.search_some_note',
  },
  {
    skill: 'xhs_get_note_detail',
    description: '抓取单篇笔记详情（标题、正文、作者、互动数据），适合深挖单条内容。',
    trigger: '用户给出小红书笔记链接并要求解读',
    source: 'Spider_XHS.apis.xhs_pc_apis.get_note_info',
  },
  {
    skill: 'xhs_get_user_notes',
    description: '抓取某账号全部笔记（可截断数量），适合竞品账号投放和内容策略跟踪。',
    trigger: '用户给出账号主页链接并要求分析近期发布',
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

function safeParsePlan(raw: string): ToolPlan {
  try {
    const parsed = JSON.parse(extractJsonObject(raw) ?? raw) as Partial<ToolPlan>;
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
    '你是小红书工具规划器，只返回 JSON。',
    '根据用户意图选择 action，并补全 args。',
    'action 候选：',
    '1) search_notes: 关键词搜索笔记列表',
    '2) get_note_detail: 抓单篇笔记详情（需要 noteUrl）',
    '3) get_user_notes: 抓账号笔记列表（需要 userUrl）',
    '4) clarify: 信息不足时追问',
    'JSON Schema:',
    '{',
    '  "action":"search_notes|get_note_detail|get_user_notes|clarify",',
    '  "reason":"简要原因",',
    '  "args":{',
    '    "query":"关键词，可选",',
    '    "noteUrl":"笔记链接，可选",',
    '    "userUrl":"用户主页链接，可选",',
    '    "limit":10',
    '  }',
    '}',
    `用户问题：${input.userQuery}`,
    `最近对话：\n${history || '无'}`,
  ].join('\n');
}

function buildSystemPrompt(customPrompt?: string | null) {
  const lines = [
    '你是投资人的小红书AI员工（Claude Code Agent）。',
    '你会优先调用 Spider_XHS 的技能能力，再基于返回数据给出结论。',
    '输出要求：',
    '1) 先给3条关键结论，再给证据，再给可执行动作。',
    '2) 不编造数据，缺信息就明确说明。',
    '3) 对竞品监控优先关注：新发布、推广行为、声量变化。',
    '',
    '已沉淀技能（来自 external_solutions/Spider_XHS）：',
    ...DEFAULT_SKILL_SET.map((item) => `- ${item.skill}: ${item.description}（触发: ${item.trigger}）`),
  ];
  if (customPrompt?.trim()) {
    lines.push('', '用户追加技能调教：', customPrompt.trim());
  }
  return lines.join('\n');
}

async function runSpiderSkill(plan: ToolPlan, cookies: string) {
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
    throw new Error('Spider_XHS 返回为空');
  }
  const parsed = JSON.parse(raw) as { ok?: boolean; error?: string };
  if (parsed.ok === false) {
    throw new Error(parsed.error || 'Spider_XHS 执行失败');
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
      accountName: '小红书助手',
      ...(typeof customPrompt === 'string' ? { assistantCustomPrompt: customPrompt } : {}),
      ...(typeof cookies === 'string' ? { accessToken: cookies || null } : {}),
    },
    create: {
      investorId,
      provider: XHS_PROVIDER,
      status: 'CONNECTED',
      accountName: '小红书助手',
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
    return NextResponse.json({ error: `调教内容最多 ${MAX_CUSTOM_PROMPT_LENGTH} 字符` }, { status: 400 });
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
    return NextResponse.json({ error: '最后一条消息必须是用户消息' }, { status: 400 });
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
    const reply = '小红书能力未配置：缺少用户 Cookie（或全局 XHS_COOKIES），且未配置远端 XHS_SPIDER_ENDPOINT。';
    await appendThreadMessage({ threadId: thread.id, role: 'ASSISTANT', content: reply });
    return NextResponse.json({
      threadId: thread.id,
      reply,
      messages: [...messages, { role: 'assistant', content: reply }],
    });
  }

  let plan: ToolPlan = { action: 'clarify', reason: 'default', args: {} };
  try {
    const plannerMessages: ChatMessage[] = [
      { role: 'system', content: buildPlannerPrompt({ userQuery: latest.content, messages }) },
      { role: 'user', content: latest.content },
    ];
    const plannerRaw = await createJsonChatCompletion(
      plannerMessages,
      process.env.OPENROUTER_MODEL_XHS_PLANNER || 'openai/gpt-5.4'
    );
    plan = safeParsePlan(plannerRaw);
    await appendToolCall({
      threadId: thread.id,
      toolName: 'xhs_planner',
      toolArgs: { userQuery: latest.content },
      toolResult: plan,
    });
  } catch (error) {
    console.error('[xhs-assistant] planner failed:', error);
  }

  if (plan.action === 'clarify') {
    const reply = '我需要更具体的信息才能执行小红书技能。请提供关键词、笔记链接或账号主页链接。';
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
    await appendToolCall({
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
          `用户问题：${latest.content}`,
          `执行动作：${plan.action}`,
          `技能返回：${JSON.stringify(toolResult, null, 2)}`,
          '请输出：3条结论 + 证据 + 可执行动作。',
        ].join('\n\n'),
      },
    ];
    reply = await createChatCompletion(
      finalMessages,
      process.env.OPENROUTER_MODEL_XHS_ASSISTANT || 'openai/gpt-5.4'
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
    reply = `小红书技能调用失败：${detail}`;
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
