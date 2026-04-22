import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { FigmaShell } from '@/components/figma-shell';
import { AlertCircle, Bot, Briefcase, Building2, ChevronRight, Mail, MessageSquare, Megaphone, Plus, Settings, Trash2 } from 'lucide-react';
import { buildExecutiveDailyBriefing } from '@/lib/executive-office';
import { resolveHiredTeamKeys, TEAM_KEYS } from '@/lib/team-library';

export default async function AccountsPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id },
    include: {
      integrations: {
        include: {
          snapshots: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
      wechatSources: true,
      avatars: {
        include: {
          chats: true,
        },
      },
      chatsAsCandidate: true,
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

  if (!dbUser) redirect('/dashboard');

  const connectedIntegrations = dbUser.integrations.filter((it) => it.status === 'CONNECTED').length;

  const gmailIntegration = dbUser.integrations.find((it) => it.provider === 'GMAIL' && it.status === 'CONNECTED');
  const feishuIntegration = dbUser.integrations.find((it) => it.provider === 'FEISHU' && it.status === 'CONNECTED');

  const infoOpsEmployeeRows = [
    {
      id: 'wechat-sources',
      typeName: '公众号助手',
      account: dbUser.wechatSources.length > 0 ? `${dbUser.wechatSources.length} 个公众号` : '未录入公众号',
      agentName: '公众号助手小智',
      status: (dbUser.wechatSources.length > 0 ? 'active' : 'paused') as const,
      processedToday: dbUser.wechatSources.length * 3,
      source: 'real' as const,
    },
    {
      id: 'xiaohongshu-assistant',
      typeName: '小红书助手',
      account: '未接入小红书',
      agentName: '小红书助手小橙',
      status: 'paused' as const,
      processedToday: 0,
      source: 'real' as const,
    },
    {
      id: 'gmail-assistant',
      typeName: 'Gmail助手',
      account: gmailIntegration?.accountEmail || '未绑定 Gmail',
      agentName: '邮件助手小明',
      status: (gmailIntegration ? 'active' : 'paused') as const,
      processedToday: gmailIntegration ? Math.max(6, (gmailIntegration.snapshots[0]?.summary?.length || 0) % 30) : 0,
      source: 'real' as const,
    },
    {
      id: 'feishu-assistant',
      typeName: '飞书助手',
      account: feishuIntegration?.accountEmail || '未绑定 飞书',
      agentName: '飞书助手小红',
      status: (feishuIntegration ? 'active' : 'paused') as const,
      processedToday: feishuIntegration ? Math.max(6, (feishuIntegration.snapshots[0]?.summary?.length || 0) % 30) : 0,
      source: 'real' as const,
    },
  ] as const;

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

  const dailyBriefing = buildExecutiveDailyBriefing({
    integrations: dbUser.integrations,
    wechatSources: dbUser.wechatSources,
    avatars: dbUser.avatars,
    hiredTeamKeys: Array.from(hiredTeamKeys),
  });

  const departments = [
    {
      id: TEAM_KEYS.EXECUTIVE_OFFICE,
      name: '总裁办',
      description: '负责全局视野汇总、每日晨报与跨部门重点事项调度。',
      icon: Briefcase,
      color: 'from-purple-500 to-pink-600',
      employees: isExecutiveHired ? 1 : 0,
      status: isExecutiveHired ? '运行中' : '待雇佣',
      employeeRows: isExecutiveHired
        ? [
            {
              id: 'executive-secretary',
              typeName: '总裁秘书',
              account: `晨报更新时间：${dailyBriefing.generatedTime}`,
              agentName: '总裁秘书Momo',
              status: 'active' as const,
              processedToday: dailyBriefing.departmentOverview.reduce(
                (acc, item) => acc + Math.max(1, Math.round(item.progress / 25)),
                0
              ),
              source: 'real' as const,
            },
          ]
        : [],
      details: [
        `晨报日期：${dailyBriefing.date}`,
        `重点事项：${dailyBriefing.priorityTasks.length} 条`,
        '入口：/investor/chat/100',
      ],
    },
    {
      id: TEAM_KEYS.INFO_OPS,
      name: '信息处理运营部门',
      description: '负责外部消息接入、摘要、归档和重点提醒。',
      icon: Mail,
      color: 'from-blue-500 to-purple-600',
      employees: isInfoOpsHired ? Math.max(1, infoOpsEmployeeRows.length) : 0,
      status: isInfoOpsHired ? '运行中' : '待雇佣',
      employeeRows: isInfoOpsHired ? infoOpsEmployeeRows : [],
      details: [
        `Gmail/飞书集成：${connectedIntegrations}`,
        `公众号源：${dbUser.wechatSources.length}`,
        '小红书助手：待接入',
        '消息流与摘要：已接入真实数据',
      ],
    },
    {
      id: TEAM_KEYS.ENGINEERING,
      name: '研发团队',
      description: '负责分身创建、参数维护与对话策略管理。',
      icon: MessageSquare,
      color: 'from-green-500 to-teal-600',
      employees: isEngineeringHired ? Math.max(1, dbUser.avatars.length || 1) : 0,
      status: isEngineeringHired ? '运行中' : '待雇佣',
      employeeRows: isEngineeringHired
        ? dbUser.avatars.length > 0
          ? dbUser.avatars.slice(0, 3).map((avatar) => ({
              id: `avatar-${avatar.id}`,
              typeName: '数字分身助手',
              account: avatar.name,
              agentName: `${avatar.name}·对话协同`,
              status: 'active' as const,
              processedToday: Math.max(3, avatar.chats.length * 2),
              source: 'real' as const,
            }))
          : [
              {
                id: 'default-engineering-agent',
                typeName: '研发助手',
                account: '默认员工（待接入分身）',
                agentName: '研发助手Alpha',
                status: 'paused' as const,
                processedToday: 0,
                source: 'real' as const,
              },
            ]
        : [],
      details: [
        `分身数量：${dbUser.avatars.length}`,
        '分身配置与系统提示词：已接入真实数据',
        '默认员工：研发助手Alpha',
      ],
    },
    {
      id: TEAM_KEYS.MARKETING_OPS,
      name: '营销运营团队',
      description: '负责渠道推广执行、声量追踪与竞品传播监控。',
      icon: Megaphone,
      color: 'from-orange-500 to-red-600',
      employees: isMarketingHired ? 1 : 0,
      status: isMarketingHired ? '运行中' : '待雇佣',
      employeeRows: isMarketingHired
        ? [
            {
              id: 'default-marketing-agent',
              typeName: '营销助手',
              account: '默认员工（待接入营销渠道）',
              agentName: '营销助手Beta',
              status: 'paused' as const,
              processedToday: 0,
              source: 'real' as const,
            },
          ]
        : [],
      details: [
        '默认员工：营销助手Beta',
        '渠道推广：待接入',
        '声量监控：待配置',
      ],
    },
  ] as const;

  return (
    <FigmaShell
      homeHref={dbUser.role === 'INVESTOR' ? '/dashboard' : '/candidate'}
      title="部门管理"
      subtitle="管理你的AI员工团队和部门架构"
    >
      <div className="mb-8 grid gap-6 md:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">总部门数</p>
              <p className="mt-2 text-4xl font-bold text-gray-900">{departments.length}</p>
            </div>
            <Building2 className="h-8 w-8 text-blue-600" />
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">运行中部门</p>
              <p className="mt-2 text-4xl font-bold text-gray-900">{departments.filter((d) => d.status === '运行中').length}</p>
            </div>
            <Bot className="h-8 w-8 text-green-600" />
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">部门员工（概念）</p>
              <p className="mt-2 text-4xl font-bold text-gray-900">{departments.reduce((acc, d) => acc + d.employees, 0)}</p>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
              <div className="h-3 w-3 rounded-full bg-green-600" />
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">演示态流程</p>
              <p className="mt-2 text-4xl font-bold text-gray-900">2</p>
            </div>
            <Mail className="h-8 w-8 text-purple-600" />
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600">
              <Plus className="h-6 w-6 text-white" />
            </div>
            <div>
            <h2 className="text-xl font-bold text-gray-900">雇佣新的AI员工</h2>
            <p className="mt-1 text-sm text-gray-600">前往 AI 人才大厅，雇佣单个员工或整个部门</p>
            </div>
          </div>
          <a href="/ai-talent" className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
            去人才大厅
            <ChevronRight className="ml-1 h-4 w-4" />
          </a>
        </div>
      </div>

      <div className="space-y-6">
        {departments.map((dept) => (
          <div key={dept.id} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br ${dept.color}`}>
                  <dept.icon className="h-7 w-7 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">{dept.name}</h3>
                  <p className="text-sm text-gray-600">{dept.description}</p>
                </div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  dept.status === '运行中' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {dept.employees} 名员工
              </span>
            </div>

            {dept.employeeRows.length > 0 ? (
              <div className="space-y-4">
                {dept.employeeRows.map((employee) => (
                  <div key={employee.id} className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300">
                    <div className="flex items-start justify-between">
                      <div className="flex flex-1 items-start gap-4">
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
                          <Bot className="h-6 w-6 text-white" />
                        </div>
                        <div className="flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <h4 className="font-semibold text-gray-900">{employee.typeName}</h4>
                            <span
                              className={`rounded px-2 py-0.5 text-xs ${
                                employee.status === 'active' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {employee.status === 'active' ? '活跃' : '演示'}
                            </span>
                            {employee.source === 'demo' ? (
                              <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">mock</span>
                            ) : null}
                          </div>
                          <p className="mb-2 text-sm text-gray-600">{employee.account}</p>
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <span>AI员工: {employee.agentName}</span>
                            <span>·</span>
                            <span>今日处理: {employee.processedToday} 条</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" className="rounded-md p-2 text-gray-500 hover:bg-gray-100" aria-label="进入详情">
                          <Briefcase className="h-4 w-4" />
                        </button>
                        <button type="button" className="rounded-md p-2 text-gray-500 hover:bg-gray-100" aria-label="设置">
                          <Settings className="h-4 w-4" />
                        </button>
                        <button type="button" className="rounded-md p-2 text-red-600 hover:bg-red-100" aria-label="移除">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="space-y-2">
                  {dept.details.map((item) => (
                    <div key={item} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center">
                <AlertCircle className="mx-auto mb-2 h-8 w-8 text-gray-400" />
                <p className="text-sm text-gray-500">这个部门还没有员工，去人才大厅添加。</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </FigmaShell>
  );
}
