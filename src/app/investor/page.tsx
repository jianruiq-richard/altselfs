import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { FigmaShell } from '@/components/figma-shell';
import InvestorIntegrationsPanel from '@/components/investor-integrations-panel';
import InvestorWechatSourcesPanel from '@/components/investor-wechat-sources-panel';

export default async function InvestorDashboard({
  searchParams,
}: {
  searchParams: Promise<{
    integrationStatus?: string;
    integrationProvider?: string;
    integrationDetail?: string;
  }>;
}) {
  const user = await currentUser();
  const query = await searchParams;

  if (!user) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id },
    include: {
      avatars: {
        include: {
          chats: {
            include: {
              messages: {
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
        },
      },
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
    },
  });

  if (!dbUser || dbUser.role !== 'INVESTOR') {
    redirect('/dashboard');
  }

  const totalChats = dbUser.avatars.reduce((acc, avatar) => acc + avatar.chats.length, 0);
  const qualifiedChats = dbUser.avatars.reduce(
    (acc, avatar) =>
      acc + avatar.chats.filter((chat) => chat.qualificationStatus === 'QUALIFIED' || chat.needsInvestorReview).length,
    0
  );

  const integrationMap = new Map(dbUser.integrations.map((it) => [it.provider, it]));
  const initialWechatSources = dbUser.wechatSources.map((source) => ({
    id: source.id,
    biz: source.biz,
    displayName: source.displayName,
    description: source.description || '',
    lastArticleUrl: source.lastArticleUrl,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  }));

  const integrationCards = (['gmail', 'feishu'] as const).map((provider) => {
    const dbProvider = provider === 'gmail' ? 'GMAIL' : 'FEISHU';
    const integration = integrationMap.get(dbProvider);
    const latest = integration?.snapshots[0];
    return {
      provider,
      connected: Boolean(integration),
      accountEmail: integration?.accountEmail || null,
      accountName: integration?.accountName || null,
      updatedAt: integration?.updatedAt.toISOString() || null,
      latestSummary: latest?.summary || null,
      latestSummaryAt: latest?.createdAt.toISOString() || null,
    };
  });

  const profileFields = [dbUser.nickname, dbUser.phone, dbUser.wechatId].filter((v) => Boolean(v?.trim())).length;
  const completion = Math.round((profileFields / 3) * 100);
  const tokens = dbUser.wechatSources.length * 1200 + dbUser.avatars.length * 900;
  const learnedSkills = dbUser.integrations.length * 4 + dbUser.wechatSources.length * 2;

  const connectedAccounts = [
    ...dbUser.integrations.map((integration) => ({
      id: integration.id,
      type: integration.provider === 'GMAIL' ? 'Gmail' : integration.provider === 'FEISHU' ? '飞书' : integration.provider,
      account: integration.accountEmail || integration.accountName || '已连接账号',
      unread: integration.snapshots.length > 0 ? 1 : 0,
      agentName: integration.provider === 'GMAIL' ? '邮件助手小明' : '飞书助手小红',
      department: '信息处理运营部门',
    })),
    ...(dbUser.wechatSources.length > 0
      ? [
          {
            id: 'wechat-source',
            type: '公众号',
            account: `${dbUser.wechatSources.length} 个公众号`,
            unread: dbUser.wechatSources.length,
            agentName: '公众号助手小智',
            department: '信息处理运营部门',
          },
        ]
      : []),
  ];

  const recentSummaries = [
    ...dbUser.integrations
      .filter((it) => it.snapshots[0])
      .map((it) => ({
        id: `integration-${it.id}`,
        source: it.provider === 'GMAIL' ? 'Gmail' : '飞书',
        agentName: it.provider === 'GMAIL' ? '邮件助手小明' : '飞书助手小红',
        title: it.provider === 'GMAIL' ? '今日重要邮件摘要' : '团队协作更新',
        summary: it.snapshots[0]?.summary || '暂无摘要',
        time: new Date(it.snapshots[0]!.createdAt).toLocaleString('zh-CN'),
      })),
    ...dbUser.avatars
      .flatMap((avatar) => avatar.chats)
      .filter((chat) => chat.messages?.length || chat.summary)
      .slice(0, 3)
      .map((chat) => ({
        id: `chat-${chat.id}`,
        source: '分身会话',
        agentName: '分身会话质检员',
        title: chat.title || '会话进展摘要',
        summary: chat.summary || `会话评分 ${chat.qualificationScore}，状态 ${chat.qualificationStatus}`,
        time: new Date(chat.updatedAt).toLocaleString('zh-CN'),
      })),
  ].slice(0, 6);

  const stats = [
    { label: '今日处理', value: dbUser.wechatSources.length + dbUser.integrations.length * 3 + dbUser.avatars.length, change: '+12%' },
    { label: '未读信息', value: connectedAccounts.reduce((acc, item) => acc + item.unread, 0), change: '-8%' },
    { label: '生成摘要', value: dbUser.integrations.filter((it) => it.snapshots[0]).length + dbUser.wechatSources.length, change: '+23%' },
    { label: '效率提升', value: `${Math.min(95, 60 + dbUser.integrations.length * 8 + dbUser.wechatSources.length * 2)}%`, change: '+5%' },
  ];

  return (
    <FigmaShell
      homeHref="/investor"
      title="工作台"
      subtitle="欢迎回来，这是你的AI员工工作概览"
      actions={
        <Link
          href="/investor/avatar/new"
          className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          管理分身
        </Link>
      }
    >
      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-500">{stat.label}</p>
            <p className="mt-2 text-4xl font-bold text-gray-900">{stat.value}</p>
            <p className="mt-2 text-sm text-green-600">{stat.change}</p>
          </div>
        ))}
      </div>

      <div className="mb-8 rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">我的数字分身</h2>
            <p className="text-gray-500">你的AI化身，越使用越懂你</p>
          </div>
          <Link href="/investor/avatar/new" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            管理分身
          </Link>
        </div>

        <div className="mt-6 grid md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-600 mb-1">{completion}%</div>
            <p className="text-sm text-gray-600">完整度</p>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600 mb-1">{tokens.toLocaleString()}</div>
            <p className="text-sm text-gray-600">知识库tokens</p>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600 mb-1">{learnedSkills}</div>
            <p className="text-sm text-gray-600">已学习技能</p>
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">我的AI团队</h2>
            <p className="text-gray-500 text-sm">按部门组织的AI员工团队</p>
          </div>
          <div className="flex gap-2">
            <Link href="/ai-talent" className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">雇佣员工</Link>
            <Link href="/accounts" className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">管理部门</Link>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {[
            { name: '信息处理运营部门', employees: connectedAccounts.length, color: 'text-blue-600 bg-blue-50' },
            { name: '工程开发部门', employees: 0, color: 'text-green-600 bg-green-50' },
            { name: '营销运营部门', employees: 0, color: 'text-orange-600 bg-orange-50' },
          ].map((dept) => (
            <div key={dept.name} className={`p-4 rounded-lg ${dept.color}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">部门</span>
                <span className="rounded bg-white px-2 py-0.5 text-xs">{dept.employees} 员工</span>
              </div>
              <h3 className="font-semibold">{dept.name}</h3>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">信息处理运营部门</h2>
            <p className="text-gray-500 text-sm">你的AI员工正在处理这些信息源</p>
          </div>
          <Link href="/accounts" className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">查看所有部门</Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {connectedAccounts.map((account) => (
            <div key={account.id} className="p-4 border border-gray-200 rounded-lg hover:border-blue-300 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{account.type}</h3>
                  <p className="text-sm text-gray-500 mt-1">{account.account}</p>
                </div>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{account.unread} 未读</span>
              </div>
              <div className="text-sm text-gray-600 mb-3">AI员工: {account.agentName}</div>
              <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600">{account.department}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">最近摘要</h2>
            <p className="text-gray-500 text-sm">AI助手为你整理的关键信息</p>
          </div>
          <Link href="/messages" className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">查看全部</Link>
        </div>

        <div className="space-y-4">
          {recentSummaries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">暂无摘要，先连接 Gmail/飞书或开始分身会话。</div>
          ) : (
            recentSummaries.map((summary) => (
              <div key={summary.id} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-gray-200 px-2 py-0.5 text-xs">{summary.source}</span>
                    <span className="text-sm text-gray-500">{summary.agentName}</span>
                  </div>
                  <span className="text-sm text-gray-400">{summary.time}</span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{summary.title}</h3>
                <p className="text-sm text-gray-600 line-clamp-3">{summary.summary}</p>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-8">
        <InvestorWechatSourcesPanel initialSources={initialWechatSources} />
      </div>

      <div className="mt-8">
        <InvestorIntegrationsPanel
          initialCards={integrationCards}
          integrationStatus={query.integrationStatus}
          integrationProvider={query.integrationProvider}
          integrationDetail={query.integrationDetail}
        />
      </div>

      <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="text-xl font-bold text-gray-900">会话总览（真实数据）</h2>
        <p className="mt-1 text-sm text-gray-500">总会话 {totalChats} · 待介入 {qualifiedChats}</p>
      </div>
    </FigmaShell>
  );
}
