import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { FigmaShell } from '@/components/figma-shell';
import { AlertCircle, Bot, Briefcase, Building2, ChevronRight, Mail, MessageSquare, Megaphone, Plus, Settings, Trash2 } from 'lucide-react';
import { buildExecutiveDailyBriefing } from '@/lib/executive-office';
import { resolveHiredTeamKeys, TEAM_KEYS } from '@/lib/team-library';

export default async function AccountsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
    relationLoadStrategy: 'join',
    select: {
      role: true,
      integrations: {
        select: {
          id: true,
          provider: true,
          status: true,
          accountEmail: true,
          accountName: true,
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
          id: true,
          displayName: true,
          description: true,
          updatedAt: true,
        },
      },
      avatars: {
        select: {
          id: true,
          name: true,
          chats: {
            select: {
              id: true,
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
  const xhsIntegration = dbUser.integrations.find((it) => it.provider === 'XIAOHONGSHU' && it.status === 'CONNECTED');

  const infoOpsEmployeeRows = [
    {
      id: 'wechat-sources',
      typeName: 'WeChat Assistant',
      account: dbUser.wechatSources.length > 0 ? `${dbUser.wechatSources.length} content` : 'content',
      agentName: 'WeChat Assistantcontent',
      status: (dbUser.wechatSources.length > 0 ? 'active' : 'paused') as 'active' | 'paused',
      processedToday: dbUser.wechatSources.length * 3,
      source: 'real' as const,
    },
    {
      id: 'xiaohongshu-assistant',
      typeName: 'Xiaohongshu Assistant',
      account: xhsIntegration?.accountName || 'content',
      agentName: 'Xiaohongshu Assistantcontent',
      status: (xhsIntegration ? 'active' : 'paused') as 'active' | 'paused',
      processedToday: xhsIntegration?.snapshots[0] ? 6 : 0,
      source: 'real' as const,
    },
    {
      id: 'gmail-assistant',
      typeName: 'Gmail Assistant',
      account: gmailIntegration?.accountEmail || 'Not connected Gmail',
      agentName: 'Email Assistant',
      status: (gmailIntegration ? 'active' : 'paused') as 'active' | 'paused',
      processedToday: gmailIntegration ? Math.max(6, (gmailIntegration.snapshots[0]?.summary?.length || 0) % 30) : 0,
      source: 'real' as const,
    },
    {
      id: 'feishu-assistant',
      typeName: 'Lark Assistant',
      account: feishuIntegration?.accountEmail || 'Not connected content',
      agentName: 'Lark Assistantcontent',
      status: (feishuIntegration ? 'active' : 'paused') as 'active' | 'paused',
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
      name: 'Executive Office',
      description: 'content, content.',
      icon: Briefcase,
      color: 'from-purple-500 to-pink-600',
      employees: isExecutiveHired ? 1 : 0,
      status: isExecutiveHired ? 'Running' : 'contentHire',
      employeeRows: isExecutiveHired
        ? [
            {
              id: 'executive-secretary',
              typeName: 'Executive Assistant',
              account: `content: ${dailyBriefing.generatedTime}`,
              agentName: 'Executive Assistant Momo',
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
        `content: ${dailyBriefing.date}`,
        `content: ${dailyBriefing.priorityTasks.length} content`,
        'content: /investor/chat/100',
      ],
    },
    {
      id: TEAM_KEYS.INFO_OPS,
      name: 'Information Operations',
      description: 'content, content, content.',
      icon: Mail,
      color: 'from-blue-500 to-purple-600',
      employees: isInfoOpsHired ? Math.max(1, infoOpsEmployeeRows.length) : 0,
      status: isInfoOpsHired ? 'Running' : 'contentHire',
      employeeRows: isInfoOpsHired ? infoOpsEmployeeRows : [],
      details: [
        `Gmail/content: ${connectedIntegrations}`,
        `content: ${dbUser.wechatSources.length}`,
        'Xiaohongshu Assistant: content',
        'content: content',
      ],
    },
    {
      id: TEAM_KEYS.ENGINEERING,
      name: 'Engineering',
      description: 'content, content.',
      icon: MessageSquare,
      color: 'from-green-500 to-teal-600',
      employees: isEngineeringHired ? Math.max(1, dbUser.avatars.length || 1) : 0,
      status: isEngineeringHired ? 'Running' : 'contentHire',
      employeeRows: isEngineeringHired
        ? dbUser.avatars.length > 0
          ? dbUser.avatars.slice(0, 3).map((avatar) => ({
              id: `avatar-${avatar.id}`,
              typeName: 'Engineering Assistant',
              account: avatar.name,
              agentName: `${avatar.name}·content`,
              status: 'active' as const,
              processedToday: Math.max(3, avatar.chats.length * 2),
              source: 'real' as const,
            }))
          : [
              {
                id: 'default-engineering-agent',
                typeName: 'Engineering Assistant',
                account: 'defaultteammate (content)',
                agentName: 'Engineering AssistantAlpha',
                status: 'paused' as const,
                processedToday: 0,
                source: 'real' as const,
              },
            ]
        : [],
      details: [
        `content: ${dbUser.avatars.length}`,
        'content: content',
        'defaultteammate: Engineering AssistantAlpha',
      ],
    },
    {
      id: TEAM_KEYS.MARKETING_OPS,
      name: 'Marketing Operations',
      description: 'content, content.',
      icon: Megaphone,
      color: 'from-orange-500 to-red-600',
      employees: isMarketingHired ? 1 : 0,
      status: isMarketingHired ? 'Running' : 'contentHire',
      employeeRows: isMarketingHired
        ? [
            {
              id: 'default-marketing-agent',
              typeName: 'Marketing Assistant',
              account: 'defaultteammate (content)',
              agentName: 'Marketing AssistantBeta',
              status: 'paused' as const,
              processedToday: 0,
              source: 'real' as const,
            },
          ]
        : [],
      details: [
        'defaultteammate: Marketing AssistantBeta',
        'content: content',
        'content: content',
      ],
    },
  ] as const;

  return (
    <FigmaShell
      homeHref="/dashboard"
      title="Department Management"
      subtitle="Manage your AI teammate teams and department structure"
    >
      <div className="mb-8 grid gap-6 md:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total departments</p>
              <p className="mt-2 text-4xl font-bold text-gray-900">{departments.length}</p>
            </div>
            <Building2 className="h-8 w-8 text-blue-600" />
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Runningcontent</p>
              <p className="mt-2 text-4xl font-bold text-gray-900">{departments.filter((d) => d.status === 'Running').length}</p>
            </div>
            <Bot className="h-8 w-8 text-green-600" />
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Department teammates (concept)</p>
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
              <p className="text-sm text-gray-500">Democontent</p>
              <p className="mt-2 text-4xl font-bold text-gray-900">2</p>
            </div>
            <Mail className="h-8 w-8 text-purple-600" />
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600">
              <Plus className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-gray-900">HirecontentAI teammate</h2>
              <p className="mt-1 text-sm text-gray-600">content AI content, Hirecontentteammatecontent</p>
            </div>
          </div>
          <a href="/ai-talent" className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 sm:py-2.5">
            Go to Talent Hub
            <ChevronRight className="ml-1 h-4 w-4" />
          </a>
        </div>
      </div>

      <div className="space-y-6">
        {departments.map((dept) => (
          <div key={dept.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <div className={`flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br ${dept.color}`}>
                  <dept.icon className="h-7 w-7 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold text-gray-900">{dept.name}</h3>
                  <p className="text-sm text-gray-600">{dept.description}</p>
                </div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  dept.status === 'Running' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {dept.employees} team members
              </span>
            </div>

            {dept.employeeRows.length > 0 ? (
              <div className="space-y-4">
                {dept.employeeRows.map((employee) => (
                  <div key={employee.id} className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex flex-1 items-start gap-4">
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
                          <Bot className="h-6 w-6 text-white" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold text-gray-900">{employee.typeName}</h4>
                            <span
                              className={`rounded px-2 py-0.5 text-xs ${
                                employee.status === 'active' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {employee.status === 'active' ? 'Active' : 'Demo'}
                            </span>
                          </div>
                          <p className="mb-2 text-sm text-gray-600">{employee.account}</p>
                          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                            <span>AI teammate: {employee.agentName}</span>
                            <span>·</span>
                            <span>Todaycontent: {employee.processedToday} content</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <button type="button" className="rounded-md p-2 text-gray-500 hover:bg-gray-100" aria-label="Open details">
                          <Briefcase className="h-4 w-4" />
                        </button>
                        <button type="button" className="rounded-md p-2 text-gray-500 hover:bg-gray-100" aria-label="Settings">
                          <Settings className="h-4 w-4" />
                        </button>
                        <button type="button" className="rounded-md p-2 text-red-600 hover:bg-red-100" aria-label="Remove">
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
                <p className="text-sm text-gray-500">contentteammate, Go to Talent HubAdd.</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </FigmaShell>
  );
}
