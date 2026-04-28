import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Briefcase,
  CheckCircle2,
  Clock,
  FileText,
  Mail,
  MessageCircle,
  Newspaper,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { FigmaShell } from '@/components/figma-shell';
import { buildExecutiveDailyBriefing } from '@/lib/executive-office';
import { resolveHiredTeamKeys, TEAM_KEYS } from '@/lib/team-library';

export default async function InvestorDashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
    relationLoadStrategy: 'join',
    select: {
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
      type: '公众号',
      account: dbUser.wechatSources.length > 0 ? `${dbUser.wechatSources.length} 个公众号` : '未录入公众号',
      unread: dbUser.wechatSources.length,
      agentName: '公众号助手小智',
      connected: dbUser.wechatSources.length > 0,
      summary:
        dbUser.wechatSources[0]?.description ||
        (dbUser.wechatSources.length > 0
          ? `已录入 ${dbUser.wechatSources.length} 个公众号，最新源：${dbUser.wechatSources[0].displayName}`
          : '暂无摘要，录入公众号后可自动生成摘要。'),
    },
    {
      key: 'xiaohongshu',
      type: '小红书',
      account: xiaohongshu?.accountName || '未配置 小红书能力',
      unread: xiaohongshu?.snapshots[0] ? 1 : 0,
      agentName: '小红书助手小橙',
      connected: Boolean(xiaohongshu),
      summary: xiaohongshu?.snapshots[0]?.summary || '暂无摘要，可在信息处理运营部门中通过对话触发 Spider_XHS 技能。',
    },
    {
      key: 'gmail',
      type: 'Gmail',
      account: gmail?.accountEmail || '未绑定 Gmail',
      unread: gmail?.snapshots[0] ? 1 : 0,
      agentName: '邮件助手小明',
      connected: Boolean(gmail),
      summary: gmail?.snapshots[0]?.summary || '暂无摘要，绑定后可自动生成邮件摘要。',
    },
    {
      key: 'feishu',
      type: '飞书',
      account: feishu?.accountEmail || '未绑定 飞书',
      unread: feishu?.snapshots[0] ? 1 : 0,
      agentName: '飞书助手小红',
      connected: Boolean(feishu),
      summary: feishu?.snapshots[0]?.summary || '暂无摘要，绑定后可自动生成协作摘要。',
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
    { label: '今日处理', value: totalProcessed, change: '+12%', icon: Mail, color: 'text-blue-600' },
    { label: '未读信息', value: unreadInfo, change: '-8%', icon: MessageCircle, color: 'text-green-600' },
    { label: '生成摘要', value: generatedSummaries, change: '+23%', icon: FileText, color: 'text-purple-600' },
    { label: '效率提升', value: efficiency, change: '+5%', icon: TrendingUp, color: 'text-orange-600' },
  ] as const;

  const infoOpsSummaryBlocks = infoOpsAssistants.map((assistant) => ({
    id: assistant.key,
    source: assistant.type,
    agentName: assistant.agentName,
    title:
      assistant.key === 'wechat'
        ? '公众号动态精选'
        : assistant.key === 'xiaohongshu'
          ? '小红书热点精选'
          : assistant.key === 'gmail'
            ? '今日重要邮件摘要'
            : '团队协作更新',
    summary: assistant.summary,
    time: '刚刚',
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
      name: '总裁办',
      color: 'bg-purple-50 text-purple-600',
      employees: isExecutiveHired ? 1 : 0,
      status: isExecutiveHired ? '已雇佣' : '未雇佣',
      statusClass: isExecutiveHired ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
      linkLabel: isExecutiveHired ? '总裁秘书Momo' : '去 AI 人才大厅雇佣',
      linkHref: isExecutiveHired ? '/investor/chat/100' : '/ai-talent',
    },
    {
      key: TEAM_KEYS.INFO_OPS,
      name: '信息处理运营部门',
      color: 'bg-blue-50 text-blue-600',
      employees: isInfoOpsHired ? Math.max(1, infoOpsAssistants.length) : 0,
      status: isInfoOpsHired ? '已雇佣' : '未雇佣',
      statusClass: isInfoOpsHired ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
      linkLabel: isInfoOpsHired ? '进入部门管理' : '去 AI 人才大厅雇佣',
      linkHref: isInfoOpsHired ? '/investor/info-ops' : '/ai-talent',
    },
    {
      key: TEAM_KEYS.ENGINEERING,
      name: '研发团队',
      color: 'bg-green-50 text-green-600',
      employees: isEngineeringHired ? Math.max(1, dbUser.avatars.length || 1) : 0,
      status: isEngineeringHired ? '已雇佣' : '未雇佣',
      statusClass: isEngineeringHired ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
      linkLabel: isEngineeringHired ? '管理分身' : '去 AI 人才大厅雇佣',
      linkHref: isEngineeringHired ? '/avatar' : '/ai-talent',
    },
    {
      key: TEAM_KEYS.MARKETING_OPS,
      name: '营销运营团队',
      color: 'bg-orange-50 text-orange-600',
      employees: isMarketingHired ? 1 : 0,
      status: isMarketingHired ? '已雇佣' : '未雇佣',
      statusClass: isMarketingHired ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
      linkLabel: isMarketingHired ? '默认员工已配置' : '去 AI 人才大厅雇佣',
      linkHref: '/ai-talent',
    },
  ] as const;

  const dailyBriefing = buildExecutiveDailyBriefing({
    integrations: dbUser.integrations,
    wechatSources: dbUser.wechatSources,
    avatars: dbUser.avatars,
    hiredTeamKeys: Array.from(hiredTeamKeys),
  });

  return (
    <FigmaShell
      homeHref="/dashboard"
      title="工作台"
      subtitle="欢迎回来，这是你的 AI 员工工作概览"
      actions={
        <Link
          href="/avatar"
          className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          管理分身
        </Link>
      }
    >
      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="mt-1 text-3xl font-bold text-gray-900">{stat.value}</p>
                <p className="mt-1 text-sm text-green-600">{stat.change}</p>
              </div>
              <div className={`rounded-lg bg-gray-50 p-3 ${stat.color}`}>
                <stat.icon className="h-6 w-6" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-8 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50">
        <div className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600">
                <Newspaper className="h-6 w-6 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-gray-900 sm:text-2xl">每日晨报</h2>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                  <Clock className="h-4 w-4" />
                  {dailyBriefing.date} · {dailyBriefing.generatedTime}由总裁秘书Momo生成
                </p>
              </div>
            </div>
            <Link href="/investor/chat/100" className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 sm:py-2">
              与总裁秘书Momo对话
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
        <div className="space-y-6 px-4 pb-4 sm:px-6 sm:pb-6">
          <div>
            <h3 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">🌍 外界信息精选</h3>
            <div className="grid gap-4 md:grid-cols-3">
              {dailyBriefing.externalInsights.map((item) => (
                <div key={`${item.category}-${item.source}`} className="rounded-lg border border-amber-200 bg-white p-4">
                  <span className="mb-2 inline-flex rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700">{item.category}</span>
                  <p className="mb-2 text-sm leading-relaxed text-gray-700">{item.content}</p>
                  <p className="text-xs text-gray-500">{item.source}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">⚡ 今日重点事项</h3>
            <div className="space-y-3">
              {dailyBriefing.priorityTasks.map((item) => (
                <div key={`${item.task}-${item.deadline}`} className="rounded-lg border border-amber-200 bg-white p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex flex-1 items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                      <div className="flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <h4 className="font-medium text-gray-900">{item.task}</h4>
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${
                              item.priority === 'high' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {item.priority === 'high' ? '紧急' : '普通'}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">截止: {item.deadline}</p>
                        <p className="mt-1 text-xs text-gray-500">指派自 {item.assignedBy}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">📊 各部门工作概览</h3>
            <div className="space-y-3">
              {dailyBriefing.departmentOverview.map((item) => (
                <div key={item.department} className="rounded-lg border border-amber-200 bg-white p-4">
                  <div className="mb-2 flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-gray-900">{item.department}</h4>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          item.status === '运行正常' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-amber-600">{item.progress}%</span>
                  </div>
                  <p className="mb-2 text-sm text-gray-600">{item.summary}</p>
                  {item.progress > 0 ? (
                    <div className="h-2 w-full rounded-full bg-gray-200">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-white p-4">
            <p className="text-sm text-gray-700">💡 晨报由总裁秘书Momo基于所有部门工作情况和外界信息自动生成，每日06:00更新</p>
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-gray-900 sm:text-2xl">我的数字分身</h2>
              <p className="text-sm text-gray-500">你的 AI 化身，越使用越懂你</p>
            </div>
          </div>
          <Link href="/avatar" className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 sm:py-2">
            管理分身
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <div className="text-center">
            <div className="mb-1 text-3xl font-bold text-purple-600">{completion}%</div>
            <p className="text-sm text-gray-600">完整度</p>
          </div>
          <div className="text-center">
            <div className="mb-1 text-3xl font-bold text-blue-600">{tokens.toLocaleString()}</div>
            <p className="text-sm text-gray-600">知识库 tokens</p>
          </div>
          <div className="text-center">
            <div className="mb-1 text-3xl font-bold text-green-600">{learnedSkills}</div>
            <p className="text-sm text-gray-600">已学习技能</p>
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-gray-900">我的 AI 团队</h2>
            <p className="text-sm text-gray-500">按部门组织的 AI 员工团队</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/ai-talent" className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 sm:py-2">
              <Briefcase className="mr-1 h-4 w-4" />
              雇佣员工
            </Link>
            <Link href="/accounts" className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 sm:py-2">
              管理部门
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
                  <span className="rounded bg-white px-2 py-0.5 text-xs">{team.employees} 员工</span>
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
            <h2 className="text-xl font-bold text-gray-900">信息处理运营部门</h2>
            <p className="text-sm text-gray-500">外部消息助手统一归入本部门管理</p>
          </div>
          <Link href="/investor/info-ops" className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 sm:py-2">
            进入部门管理
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {infoOpsAssistants.map((assistant) => (
            <div key={assistant.key} className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-blue-300">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{assistant.type} 助手</h3>
                  <p className="mt-1 text-sm text-gray-500">{assistant.account}</p>
                </div>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{assistant.unread} 未读</span>
              </div>
              <div className="mb-3 flex items-center gap-2 text-sm text-gray-600">
                <Bot className="h-4 w-4 text-blue-600" />
                <span>{assistant.agentName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600">信息处理运营部门</span>
                <Link href={`/investor/info-ops?assistant=${assistant.key}`} className="text-sm font-medium text-blue-600 hover:text-blue-700">
                  进入管理
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-gray-900">最近摘要</h2>
            <p className="text-sm text-gray-500">模块化摘要视图，可持续扩展更多团队</p>
          </div>
          <Link href="/messages" className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 sm:py-2">
            查看全部
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </div>

        <div className="space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">信息处理运营部门摘要</h3>
              <span className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{infoOpsSummaryBlocks.length} 条</span>
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
              <h3 className="text-base font-semibold text-gray-900">研发团队摘要</h3>
              <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">待接入</span>
            </div>
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              该子模块预留中，后续接入研发团队摘要后自动展示。
            </div>
          </section>
        </div>
      </div>
    </FigmaShell>
  );
}
