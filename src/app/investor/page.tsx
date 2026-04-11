import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { ArrowRight, Bot, Briefcase, FileText, Mail, MessageCircle, Sparkles, TrendingUp, Users } from 'lucide-react';
import { FigmaShell } from '@/components/figma-shell';

export default async function InvestorDashboard() {
  const user = await currentUser();
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
            orderBy: { updatedAt: 'desc' },
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

  if (!dbUser || dbUser.role !== 'INVESTOR') redirect('/dashboard');

  const integrationMap = new Map(dbUser.integrations.map((it) => [it.provider, it]));
  const gmail = integrationMap.get('GMAIL');
  const feishu = integrationMap.get('FEISHU');

  const infoOpsAssistants = [
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
      assistant.type === 'Gmail'
        ? '今日重要邮件摘要'
        : assistant.type === '飞书'
          ? '团队协作更新'
          : '公众号动态精选',
    summary: assistant.summary,
    time: '刚刚',
    priority: assistant.connected ? 'medium' : 'low',
  }));

  return (
    <FigmaShell
      homeHref="/investor"
      title="工作台"
      subtitle="欢迎回来，这是你的 AI 员工工作概览"
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

      <div className="mb-8 rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">我的数字分身</h2>
              <p className="text-sm text-gray-500">你的 AI 化身，越使用越懂你</p>
            </div>
          </div>
          <Link href="/investor/avatar/new" className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
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
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">我的 AI 团队</h2>
            <p className="text-sm text-gray-500">按部门组织的 AI 员工团队</p>
          </div>
          <div className="flex gap-2">
            <Link href="/ai-talent" className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <Briefcase className="mr-1 h-4 w-4" />
              雇佣员工
            </Link>
            <Link href="/accounts" className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              管理部门
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-blue-50 p-4 text-blue-600">
            <div className="mb-2 flex items-center justify-between">
              <Users className="h-5 w-5" />
              <span className="rounded bg-white px-2 py-0.5 text-xs">{infoOpsAssistants.length} 员工</span>
            </div>
            <h3 className="font-semibold">信息处理运营部门</h3>
          </div>
          <div className="rounded-lg bg-green-50 p-4 text-green-600">
            <div className="mb-2 flex items-center justify-between">
              <Users className="h-5 w-5" />
              <span className="rounded bg-white px-2 py-0.5 text-xs">{dbUser.avatars.length} 员工</span>
            </div>
            <h3 className="font-semibold">研发团队</h3>
          </div>
          <div className="rounded-lg bg-orange-50 p-4 text-orange-600">
            <div className="mb-2 flex items-center justify-between">
              <Users className="h-5 w-5" />
              <span className="rounded bg-white px-2 py-0.5 text-xs">0 员工</span>
            </div>
            <h3 className="font-semibold">营销运营团队</h3>
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">信息处理运营部门</h2>
            <p className="text-sm text-gray-500">外部消息助手统一归入本部门管理</p>
          </div>
          <Link href="/investor/info-ops" className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
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
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">最近摘要</h2>
            <p className="text-sm text-gray-500">模块化摘要视图，可持续扩展更多团队</p>
          </div>
          <Link href="/messages" className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
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
