import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Briefcase,
  FileText,
  Mail,
  MessageCircle,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { FigmaShell } from '@/components/figma-shell';
import { ExecutiveDailyBriefingBrowser } from '@/components/executive-daily-briefing-browser';
import { buildExecutiveDailyBriefing } from '@/lib/executive-office';
import { getTodayExecutiveBriefing } from '@/lib/agents/executive-orchestrator';
import { resolveHiredTeamKeys, TEAM_KEYS } from '@/lib/team-library';

export default async function InvestorDashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
    relationLoadStrategy: 'join',
    select: {
      id: true,
      role: true,
      nickname: true,
      phone: true,
      wechatId: true,
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
        select: {
          provider: true,
          status: true,
          accountEmail: true,
          accountName: true,
          updatedAt: true,
          snapshots: {
            select: {
              summary: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
      wechatSources: {
        select: {
          displayName: true,
          description: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      },
      teamHires: {
        select: {
          teamKey: true,
          status: true,
        },
      },
      agentThreads: {
        select: {
          agentType: true,
        },
      },
    },
  });

  if (!dbUser) redirect('/dashboard/setup?role=investor');

  const integrationMap = new Map(dbUser.integrations.map((it) => [it.provider, it]));
  const gmail = integrationMap.get('GMAIL');
  const feishu = integrationMap.get('FEISHU');
  const xiaohongshu = integrationMap.get('XIAOHONGSHU');

  const infoOpsAssistants = [
    {
      key: 'wechat',
      type: 'WeChat',
      account: dbUser.wechatSources.length > 0 ? `${dbUser.wechatSources.length} sources` : 'Not connected',
      unread: dbUser.wechatSources.length,
      agentName: 'WeChat Assistant',
      connected: dbUser.wechatSources.length > 0,
      summary:
        dbUser.wechatSources[0]?.description ||
        (dbUser.wechatSources.length > 0
          ? `Tracking ${dbUser.wechatSources.length} WeChat sources. Latest source: ${dbUser.wechatSources[0].displayName}`
          : 'Not connected. Add sources to start monitoring.'),
    },
    {
      key: 'xiaohongshu',
      type: 'Xiaohongshu',
      account: xiaohongshu?.accountName || 'Not connected',
      unread: xiaohongshu?.snapshots[0] ? 1 : 0,
      agentName: 'Xiaohongshu Assistant',
      connected: Boolean(xiaohongshu),
      summary: xiaohongshu?.snapshots[0]?.summary || 'Not connected. Connect the Spider_XHS workflow from Information Operations.',
    },
    {
      key: 'gmail',
      type: 'Gmail',
      account: gmail?.accountEmail || 'Not connected Gmail',
      unread: gmail?.snapshots[0] ? 1 : 0,
      agentName: 'Email Assistant',
      connected: Boolean(gmail),
      summary: gmail?.snapshots[0]?.summary || 'Not connected. Connect Gmail to refresh summaries.',
    },
    {
      key: 'feishu',
      type: 'Lark',
      account: feishu?.accountEmail || 'Not connected Lark',
      unread: feishu?.snapshots[0] ? 1 : 0,
      agentName: 'Lark Assistant',
      connected: Boolean(feishu),
      summary: feishu?.snapshots[0]?.summary || 'Not connected. Connect Lark to refresh workspace summaries.',
    },
  ] as const;

  const profileFields = [dbUser.nickname, dbUser.phone, dbUser.wechatId].filter((v) => Boolean(v?.trim())).length;
  const completion = Math.round((profileFields / 3) * 100);
  const tokens = dbUser.wechatSources.length * 1200 + dbUser.avatars.length * 900;
  const learnedSkills = dbUser.integrations.length * 4 + dbUser.wechatSources.length * 2;

  const unreadInfo = infoOpsAssistants.reduce((acc, item) => acc + item.unread, 0);
  const generatedSummaries =
    dbUser.integrations.filter((it) => Boolean(it.snapshots[0])).length + (dbUser.wechatSources.length > 0 ? 1 : 0);
  const totalProcessed = dbUser.wechatSources.length + dbUser.integrations.length * 3 + dbUser.avatars.length;
  const efficiency = `${Math.min(95, 60 + dbUser.integrations.length * 8 + dbUser.wechatSources.length * 2)}%`;

  const stats = [
    { label: 'Today processed', value: totalProcessed, change: '+12%', icon: Mail, color: 'text-[#8a4d22]' },
    { label: 'Unread signals', value: unreadInfo, change: '-8%', icon: MessageCircle, color: 'text-emerald-700' },
    { label: 'Generated summaries', value: generatedSummaries, change: '+23%', icon: FileText, color: 'text-[#b77a3d]' },
    { label: 'Automation efficiency', value: efficiency, change: '+5%', icon: TrendingUp, color: 'text-[#c78b45]' },
  ] as const;

  const infoOpsSummaryBlocks = infoOpsAssistants.map((assistant) => ({
    id: assistant.key,
    source: assistant.type,
    agentName: assistant.agentName,
    title:
      assistant.key === 'wechat'
        ? 'WeChat digest'
        : assistant.key === 'xiaohongshu'
          ? 'Xiaohongshu pulse'
          : assistant.key === 'gmail'
            ? 'Today’s email'
            : 'Lark workspace',
    summary: assistant.summary,
    time: 'Now',
    priority: assistant.connected ? 'medium' : 'low',
  }));

  const hiredTeamKeys = resolveHiredTeamKeys({
    teamHires: dbUser.teamHires,
    fallback: {
      integrationCount: dbUser.integrations.length,
      wechatSourceCount: dbUser.wechatSources.length,
      avatarCount: dbUser.avatars.length,
      agentTypes: dbUser.agentThreads.map((thread) => thread.agentType),
    },
  });
  const isExecutiveHired = hiredTeamKeys.has(TEAM_KEYS.EXECUTIVE_OFFICE);
  const isInfoOpsHired = hiredTeamKeys.has(TEAM_KEYS.INFO_OPS);
  const isEngineeringHired = hiredTeamKeys.has(TEAM_KEYS.ENGINEERING);
  const isMarketingHired = hiredTeamKeys.has(TEAM_KEYS.MARKETING_OPS);

  const teamCards = [
    {
      key: TEAM_KEYS.EXECUTIVE_OFFICE,
      name: 'Executive Office',
      color: 'bg-purple-50 text-purple-600',
      employees: isExecutiveHired ? 1 : 0,
      status: isExecutiveHired ? 'Hired' : 'Not hired',
      statusClass: isExecutiveHired ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
      linkLabel: isExecutiveHired ? 'Executive Assistant Momo' : 'Hire AI teammate',
      linkHref: isExecutiveHired ? '/investor/chat/100' : '/ai-talent',
    },
    {
      key: TEAM_KEYS.INFO_OPS,
      name: 'Information Operations',
      color: 'bg-blue-50 text-blue-600',
      employees: isInfoOpsHired ? Math.max(1, infoOpsAssistants.length) : 0,
      status: isInfoOpsHired ? 'Hired' : 'Not hired',
      statusClass: isInfoOpsHired ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
      linkLabel: isInfoOpsHired ? 'Open Information Ops' : 'Hire AI teammate',
      linkHref: isInfoOpsHired ? '/investor/info-ops' : '/ai-talent',
    },
    {
      key: TEAM_KEYS.ENGINEERING,
      name: 'Engineering',
      color: 'bg-green-50 text-green-600',
      employees: isEngineeringHired ? Math.max(1, dbUser.avatars.length || 1) : 0,
      status: isEngineeringHired ? 'Hired' : 'Not hired',
      statusClass: isEngineeringHired ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
      linkLabel: isEngineeringHired ? 'Open digital twins' : 'Hire AI teammate',
      linkHref: isEngineeringHired ? '/avatar' : '/ai-talent',
    },
    {
      key: TEAM_KEYS.MARKETING_OPS,
      name: 'Marketing Operations',
      color: 'bg-orange-50 text-orange-600',
      employees: isMarketingHired ? 1 : 0,
      status: isMarketingHired ? 'Hired' : 'Not hired',
      statusClass: isMarketingHired ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
      linkLabel: isMarketingHired ? 'Default teammate' : 'Hire AI teammate',
      linkHref: '/ai-talent',
    },
  ] as const;

  const dailyBriefing = buildExecutiveDailyBriefing({
    integrations: dbUser.integrations,
    wechatSources: dbUser.wechatSources,
    avatars: dbUser.avatars,
    hiredTeamKeys: Array.from(hiredTeamKeys),
  });
  const todayPersistedBriefing = await getTodayExecutiveBriefing(dbUser.id);
  const persistedDailyBriefing = todayPersistedBriefing
    ? {
        dateKey: todayPersistedBriefing.dateKey,
        title: todayPersistedBriefing.title,
        summary: todayPersistedBriefing.summary,
        sections: todayPersistedBriefing.sections,
        updatedAt: todayPersistedBriefing.updatedAt.toISOString(),
      }
    : null;

  return (
    <FigmaShell
      homeHref="/dashboard"
      showPageHeader={false}
    >
      <ExecutiveDailyBriefingBrowser
        briefing={dailyBriefing}
        persistedBriefing={persistedDailyBriefing}
        className="mb-8"
      />

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-[#e4d5c3] bg-[#fffaf3] p-6 shadow-[0_12px_30px_rgba(73,48,31,0.05)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-stone-500">{stat.label}</p>
                <p className="mt-1 text-3xl font-bold text-stone-950">{stat.value}</p>
                <p className="mt-1 text-sm text-emerald-700">{stat.change}</p>
              </div>
              <div className={`rounded-lg bg-[#f5eadc] p-3 ${stat.color}`}>
                <stat.icon className="h-6 w-6" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-950 sm:text-3xl">Decision OS Workspace</h1>
          <p className="mt-2 max-w-3xl text-sm text-stone-500 sm:text-base">Your operating view for context, teammates, and today’s decision flow.</p>
        </div>
        <div className="shrink-0 self-start">
          <Link
            href="/avatar"
            className="inline-flex items-center rounded-xl bg-[#8a4d22] px-4 py-2 text-sm font-semibold text-white hover:bg-[#743f1b]"
          >
            Open my digital twin
          </Link>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-[#e4d5c3] bg-gradient-to-br from-[#fffaf3] to-[#efe0ce] p-4 shadow-[0_18px_45px_rgba(73,48,31,0.07)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#b77a3d] to-[#5b3725]">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-stone-950 sm:text-2xl">My Digital Twin</h2>
              <p className="text-sm text-stone-500">Your work context and decision preferences</p>
            </div>
          </div>
          <Link href="/avatar" className="inline-flex items-center justify-center rounded-xl bg-[#8a4d22] px-4 py-3 text-sm font-semibold text-white hover:bg-[#743f1b] sm:py-2">
            Open workspace
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <div className="text-center">
            <div className="mb-1 text-3xl font-bold text-[#8a4d22]">{completion}%</div>
            <p className="text-sm text-stone-600">Completion</p>
          </div>
          <div className="text-center">
            <div className="mb-1 text-3xl font-bold text-[#b77a3d]">{tokens.toLocaleString()}</div>
            <p className="text-sm text-stone-600">Context tokens</p>
          </div>
          <div className="text-center">
            <div className="mb-1 text-3xl font-bold text-emerald-700">{learnedSkills}</div>
            <p className="text-sm text-stone-600">Learned skills</p>
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-gray-900">AI Teammates</h2>
            <p className="text-sm text-gray-500">Departments staffed by AI teammates</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/ai-talent" className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 sm:py-2">
              <Briefcase className="mr-1 h-4 w-4" />
              Hire teammate
            </Link>
            <Link href="/accounts" className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 sm:py-2">
              Team Management
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {teamCards.map((team) => (
            <div key={team.key} className={`rounded-lg p-4 ${team.color}`}>
              <div className="mb-2 flex items-center justify-between">
                <Users className="h-5 w-5" />
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${team.statusClass}`}>{team.status}</span>
                  <span className="rounded bg-white px-2 py-0.5 text-xs">{team.employees} teammate</span>
                </div>
              </div>
              <h3 className="font-semibold">{team.name}</h3>
              <Link href={team.linkHref} className="mt-2 inline-block text-xs font-medium hover:underline">
                {team.linkLabel}
              </Link>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-gray-900">Information Operations</h2>
            <p className="text-sm text-gray-500">External message assistants and connected channels</p>
          </div>
          <Link href="/investor/info-ops" className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 sm:py-2">
            Manage Information Ops
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {infoOpsAssistants.map((assistant) => (
            <div key={assistant.key} className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-blue-300">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{assistant.type}</h3>
                  <p className="mt-1 text-sm text-gray-500">{assistant.account}</p>
                </div>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{assistant.unread} signals</span>
              </div>
              <div className="mb-3 flex items-center gap-2 text-sm text-gray-600">
                <Bot className="h-4 w-4 text-blue-600" />
                <span>{assistant.agentName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600">Information Operations</span>
                <Link href={`/investor/info-ops?assistant=${assistant.key}`} className="text-sm font-medium text-blue-600 hover:text-blue-700">
                  Open
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-gray-900">Latest summary</h2>
            <p className="text-sm text-gray-500">Recent outputs from your operating system</p>
          </div>
          <Link href="/messages" className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 sm:py-2">
            View all
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </div>

        <div className="space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Information Operations</h3>
              <span className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{infoOpsSummaryBlocks.length} summaries</span>
            </div>
            <div className="space-y-3">
              {infoOpsSummaryBlocks.map((summary) => (
                <div key={summary.id} className="rounded-lg border border-gray-200 p-4 transition-colors hover:bg-gray-50">
                  <div className="mb-2 flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-gray-200 px-2 py-0.5 text-xs">{summary.source}</span>
                      <span className="text-sm text-gray-500">{summary.agentName}</span>
                    </div>
                    <span className="text-sm text-gray-400">{summary.time}</span>
                  </div>
                  <h4 className="mb-1 font-semibold text-gray-900">{summary.title}</h4>
                  <p className="line-clamp-3 text-sm text-gray-600">{summary.summary}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Engineering</h3>
              <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">Coming soon</span>
            </div>
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              No engineering updates yet. Hire or connect an engineering teammate to populate this section.
            </div>
          </section>
        </div>
      </div>
    </FigmaShell>
  );
}
