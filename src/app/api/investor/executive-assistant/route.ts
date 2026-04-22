import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { createChatCompletion, type ChatMessage } from '@/lib/openrouter';
import {
  appendThreadMessage,
  ensureThread,
  getLatestThreadWithMessages,
  toClientMessages,
} from '@/lib/agent-session';
import { buildExecutiveAssistantReply, buildExecutiveDailyBriefing } from '@/lib/executive-office';
import { resolveHiredTeamKeys } from '@/lib/team-library';
import { EXECUTIVE_MOMO_SYSTEM_PROMPT } from '@/lib/prompts/executive-momo';

type ClientMessage = {
  role: 'user' | 'assistant';
  content: string;
};

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

async function generateExecutiveReply(messages: ClientMessage[], briefing: {
  date: string;
  generatedTime: string;
  headline: string;
  departmentOverview: Array<{ department: string; status: string; summary: string; progress: number }>;
  externalInsights: Array<{ category: string; content: string; source: string }>;
  priorityTasks: Array<{ priority: 'high' | 'medium' | 'low'; task: string; deadline: string; assignedBy: string }>;
}) {
  const contextPrompt = [
    '下面是当前可用的业务上下文。只在用户明确需要时才引用，不要机械反复提及。',
    buildBriefingContext(briefing),
    '输出约束补充：',
    '1) 回复使用中文口语化表达。',
    '2) 不要使用 markdown 格式符号。',
    '3) 一次最多提出一个问题；不要连续三轮都用问句。',
    '4) 默认优先共情、复述、安抚。',
  ].join('\n\n');

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: EXECUTIVE_MOMO_SYSTEM_PROMPT },
    { role: 'system', content: contextPrompt },
    ...messages.map((item) => ({ role: item.role, content: item.content })),
  ];

  const model = process.env.OPENROUTER_MODEL_EXECUTIVE || 'anthropic/claude-3.5-sonnet';
  const reply = await createChatCompletion(chatMessages, model);
  return reply.trim();
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

async function loadBriefing(investorId: string) {
  const investor = await prisma.user.findUnique({
    where: { id: investorId },
    include: {
      integrations: {
        include: {
          snapshots: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
      wechatSources: {
        orderBy: { updatedAt: 'desc' },
      },
      avatars: {
        include: {
          chats: {
            select: {
              needsInvestorReview: true,
              qualificationStatus: true,
            },
          },
        },
      },
      teamHires: {
        select: {
          teamKey: true,
          status: true,
        },
      },
      agentThreads: {
        select: { agentType: true },
      },
    },
  });

  if (!investor) return null;

  const hiredTeamKeys = resolveHiredTeamKeys({
    teamHires: investor.teamHires,
    fallback: {
      integrationCount: investor.integrations.length,
      wechatSourceCount: investor.wechatSources.length,
      avatarCount: investor.avatars.length,
      agentTypes: investor.agentThreads.map((thread) => thread.agentType),
    },
  });

  return buildExecutiveDailyBriefing({
    integrations: investor.integrations,
    wechatSources: investor.wechatSources,
    avatars: investor.avatars,
    hiredTeamKeys: Array.from(hiredTeamKeys),
  });
}

export async function GET() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const briefing = await loadBriefing(investor.id);
  if (!briefing) return NextResponse.json({ error: 'Investor not found' }, { status: 404 });

  let thread = await getLatestThreadWithMessages(investor.id, 'EXECUTIVE');
  if (!thread) {
    const created = await ensureThread({
      investorId: investor.id,
      agentType: 'EXECUTIVE',
    });
    await appendThreadMessage({
      threadId: created.id,
      role: 'ASSISTANT',
      content: `早上好！我是总裁秘书Momo。\n\n${briefing.headline}\n\n你可以问我：\n1) 各部门工作情况\n2) 今日重点事项\n3) 外界信息变化`,
    });
    thread = await getLatestThreadWithMessages(investor.id, 'EXECUTIVE');
  }

  return NextResponse.json({
    threadId: thread?.id || null,
    messages: thread ? toClientMessages(thread.messages) : [],
    briefing,
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

  const briefing = await loadBriefing(investor.id);
  if (!briefing) return NextResponse.json({ error: 'Investor not found' }, { status: 404 });

  const thread = await ensureThread({
    investorId: investor.id,
    agentType: 'EXECUTIVE',
    threadId: body?.threadId || null,
  });

  await appendThreadMessage({
    threadId: thread.id,
    role: 'USER',
    content: latest.content,
  });

  let reply = '';
  try {
    reply = await generateExecutiveReply(messages, briefing);
  } catch (error) {
    console.error('[executive-assistant] model generation failed, fallback to rule-based reply:', error);
    reply = buildExecutiveAssistantReply(latest.content, briefing);
  }

  await appendThreadMessage({
    threadId: thread.id,
    role: 'ASSISTANT',
    content: reply,
  });

  return NextResponse.json({
    threadId: thread.id,
    reply,
    messages: [...messages, { role: 'assistant', content: reply }],
    briefing,
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
      agentType: 'EXECUTIVE',
    },
  });

  return NextResponse.json({ ok: true });
}
