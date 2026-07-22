import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { AstromarDashboardClient } from '@/components/astromar-dashboard-client';
import { buildExecutiveDailyBriefing } from '@/lib/executive-office';
import { prisma } from '@/lib/prisma';
import { resolveHiredTeamKeys } from '@/lib/team-library';

const providerLabels: Record<string, string> = {
  GMAIL: 'Gmail',
  FEISHU: 'Lark',
  META: 'Instagram / Facebook',
  XIAOHONGSHU: 'Xiaohongshu',
  SIMILARWEB_API1: 'Similarweb',
  SEMRUSH13: 'Semrush',
  SEMRUSH8: 'Semrush',
  DOMAIN_METRICS_CHECK: 'Domain metrics',
};

function readableThreadTitle(title: string | null) {
  const value = title?.trim();
  if (!value || ['instruction', 'New chat', 'New conversation'].includes(value)) return 'New discussion';
  return value;
}

function readRunTitle(request: unknown) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return 'Agent task';
  const record = request as Record<string, unknown>;
  const candidates = [record.displayMessage, record.message, record.prompt, record.task];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim()) as string | undefined;
  if (!value) return 'Agent task';
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 52 ? `${compact.slice(0, 52)}...` : compact;
}

export default async function InvestorDashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
    relationLoadStrategy: 'join',
    select: {
      id: true,
      email: true,
      name: true,
      nickname: true,
      avatars: {
        select: {
          name: true,
          chats: {
            select: {
              needsInvestorReview: true,
              qualificationStatus: true,
            },
          },
        },
      },
      integrations: {
        orderBy: { updatedAt: 'desc' },
        select: {
          provider: true,
          status: true,
          updatedAt: true,
          snapshots: {
            select: { summary: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
      wechatSources: {
        orderBy: { updatedAt: 'desc' },
        select: {
          displayName: true,
          description: true,
          updatedAt: true,
        },
      },
      teamHires: {
        select: { teamKey: true, status: true },
      },
      agentThreads: {
        where: { agentType: 'PERSONAL', status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        select: {
          id: true,
          title: true,
          status: true,
          updatedAt: true,
          _count: { select: { messages: true } },
        },
      },
      executiveAssistantRuns: {
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          status: true,
          request: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!dbUser) redirect('/dashboard/setup?role=investor');

  const hiredTeamKeys = resolveHiredTeamKeys({
    teamHires: dbUser.teamHires,
    fallback: {
      integrationCount: dbUser.integrations.length,
      wechatSourceCount: dbUser.wechatSources.length,
      avatarCount: dbUser.avatars.length,
      agentTypes: dbUser.agentThreads.map(() => 'PERSONAL'),
    },
  });
  const briefing = buildExecutiveDailyBriefing({
    integrations: dbUser.integrations,
    wechatSources: dbUser.wechatSources,
    avatars: dbUser.avatars,
    hiredTeamKeys: Array.from(hiredTeamKeys),
  });

  const signals = [
    ...dbUser.integrations
      .filter((integration) => integration.status === 'CONNECTED' && integration.snapshots[0])
      .map((integration) => ({
        title: `${providerLabels[integration.provider] || integration.provider} updated`,
        detail: integration.snapshots[0]?.summary || 'New connected-source activity is available.',
        source: providerLabels[integration.provider] || integration.provider,
        updatedAt: (integration.snapshots[0]?.createdAt || integration.updatedAt).toISOString(),
      })),
    ...dbUser.wechatSources.map((source) => ({
      title: `${source.displayName} published new context`,
      detail: source.description || 'A connected WeChat source has new activity.',
      source: 'WeChat',
      updatedAt: source.updatedAt.toISOString(),
    })),
  ]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 6);

  const activeRuns = dbUser.executiveAssistantRuns.filter((run) => ['QUEUED', 'RUNNING'].includes(run.status));
  const activeWork = activeRuns.length > 0
    ? dbUser.executiveAssistantRuns.slice(0, 5).map((run) => ({
        id: run.id,
        title: readRunTitle(run.request),
        status: run.status,
        updatedAt: run.updatedAt.toISOString(),
      }))
    : dbUser.agentThreads.slice(0, 5).map((thread) => ({
        id: thread.id,
        title: readableThreadTitle(thread.title),
        status: thread._count.messages > 0 ? 'READY' : thread.status,
        updatedAt: thread.updatedAt.toISOString(),
      }));

  const connectedSources = dbUser.integrations.filter((integration) => integration.status === 'CONNECTED').length + (dbUser.wechatSources.length > 0 ? 1 : 0);
  const metrics = [
    {
      label: 'Decisions to make',
      value: briefing.priorityTasks.length,
      detail: briefing.priorityTasks.some((task) => task.priority === 'high') ? 'High priority waiting' : 'Ready to review',
      tone: 'green' as const,
    },
    {
      label: 'Signals available',
      value: signals.length,
      detail: `${connectedSources} connected sources`,
      tone: 'blue' as const,
    },
    {
      label: 'Active work',
      value: activeRuns.length,
      detail: activeRuns.length > 0 ? 'Agent work in progress' : 'No running tasks',
      tone: 'amber' as const,
    },
  ];

  const userName = dbUser.nickname?.trim() || dbUser.name?.trim() || dbUser.email.split('@')[0] || 'Founder';
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  return (
    <AstromarDashboardClient
      userName={userName}
      dateLabel={dateLabel}
      briefingHeadline={briefing.headline}
      metrics={metrics}
      tasks={briefing.priorityTasks.map((task) => ({
        priority: task.priority,
        task: task.task,
        deadline: task.deadline,
        owner: task.assignedBy,
      }))}
      signals={signals}
      activeWork={activeWork}
    />
  );
}
