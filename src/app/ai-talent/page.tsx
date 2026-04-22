import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { FigmaShell } from '@/components/figma-shell';
import { CheckCircle2, Code2, FileText, Hash, Headphones, Mail, Megaphone, MessageSquare, Palette, Search, Star, Video } from 'lucide-react';
import { resolveHiredTeamKeys, TEAM_KEYS } from '@/lib/team-library';

const mockTalents = [
  {
    id: 'gmail-assistant',
    name: 'Gmail助手',
    description: '自动整理收件箱，识别高优先级邮件并生成回复建议。',
    tags: ['邮件分类', '优先级判断', '摘要生成'],
    type: 'real',
    category: '信息处理运营',
    price: '免费',
    rating: 4.8,
    hires: 12453,
  },
  {
    id: 'feishu-assistant',
    name: '飞书助手',
    description: '聚合团队消息、会议纪要与待办事项。',
    tags: ['消息归纳', '会议提要', '待办提取'],
    type: 'real',
    category: '信息处理运营',
    price: '免费',
    rating: 4.9,
    hires: 8932,
  },
  {
    id: 'wechat-assistant',
    name: '公众号助手',
    description: '跟踪公众号更新，提炼关键信息并沉淀知识点。',
    tags: ['内容摘要', '趋势跟踪', '知识沉淀'],
    type: 'real',
    category: '信息处理运营',
    price: '免费',
    rating: 4.7,
    hires: 15678,
  },
  {
    id: 'xiaohongshu-assistant',
    name: '小红书助手',
    description: '跟踪小红书内容热点，提炼趋势变化并沉淀选题方向。',
    tags: ['热点追踪', '笔记分析', '趋势洞察'],
    type: 'real',
    category: '信息处理运营',
    price: '免费',
    rating: 4.7,
    hires: 9642,
  },
  {
    id: 'pm-agent',
    name: '产品策略顾问',
    description: '演示态：用于概念展示，后续可接入实际推理流程。',
    tags: ['路线图规划', '需求拆解', '优先级评估'],
    type: 'demo',
    category: '工程开发',
    price: '¥399/月（演示）',
    rating: 4.7,
    hires: 412,
  },
  {
    id: 'discord-assistant',
    name: 'Discord助手',
    description: '演示态：整理 Discord 社区讨论与关键事件。',
    tags: ['社区管理', '讨论总结', '关键事件'],
    type: 'demo',
    category: '营销运营',
    price: '¥199/月（演示）',
    rating: 4.5,
    hires: 321,
  },
  {
    id: 'facebook-assistant',
    name: 'Facebook助手',
    description: '演示态：监控 Facebook 动态并识别互动信号。',
    tags: ['动态追踪', '互动分析', '内容整理'],
    type: 'demo',
    category: '营销运营',
    price: '¥199/月（演示）',
    rating: 4.4,
    hires: 255,
  },
  {
    id: 'instagram-assistant',
    name: 'Instagram助手',
    description: '演示态：管理 Instagram 内容与粉丝互动。',
    tags: ['内容分析', '粉丝互动', '趋势发现'],
    type: 'demo',
    category: '营销运营',
    price: '¥199/月（演示）',
    rating: 4.6,
    hires: 367,
  },
  {
    id: 'tiktok-assistant',
    name: 'TikTok助手',
    description: '演示态：跟踪短视频热点并输出创意方向。',
    tags: ['视频分析', '热点追踪', '创意灵感'],
    type: 'demo',
    category: '营销运营',
    price: '¥199/月（演示）',
    rating: 4.5,
    hires: 402,
  },
  {
    id: 'growth-agent',
    name: '增长运营专家',
    description: '演示态：用于概念展示，后续接入增长分析数据。',
    tags: ['漏斗分析', '转化优化', '活动策划'],
    type: 'demo',
    category: '营销运营',
    price: '¥399/月（演示）',
    rating: 4.8,
    hires: 287,
  },
  {
    id: 'qa-agent',
    name: '对话质检员',
    description: '演示态：用于概念展示，后续接入会话质量评分。',
    tags: ['对话评分', '风险提示', '改进建议'],
    type: 'demo',
    category: '工程开发',
    price: '¥199/月（演示）',
    rating: 4.6,
    hires: 198,
  },
] as const;

export default async function AITalentPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id },
    include: {
      integrations: true,
      wechatSources: true,
      avatars: true,
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

  const enabled = new Set<string>();
  for (const integration of dbUser.integrations) {
    if (integration.provider === 'GMAIL') enabled.add('gmail-assistant');
    if (integration.provider === 'FEISHU') enabled.add('feishu-assistant');
  }
  if (dbUser.wechatSources.length > 0) enabled.add('wechat-assistant');

  const hiredTeamKeys = resolveHiredTeamKeys({
    teamHires: dbUser.teamHires,
    fallback: {
      integrationCount: dbUser.integrations.length,
      wechatSourceCount: dbUser.wechatSources.length,
      avatarCount: dbUser.avatars.length,
      agentTypes: dbUser.agentThreads.map((thread) => thread.agentType),
    },
  });

  const departmentPackages = [
    {
      id: TEAM_KEYS.EXECUTIVE_OFFICE,
      name: '总裁办',
      description: '负责晨报、跨部门节奏和重点事项调度。',
      gradient: 'from-purple-500 to-pink-600',
      icon: Code2,
      price: '免费',
      originalPrice: '免费',
      discount: null as string | null,
      members: ['总裁秘书Momo（默认）'],
      popular: false,
      hired: hiredTeamKeys.has(TEAM_KEYS.EXECUTIVE_OFFICE),
    },
    {
      id: TEAM_KEYS.INFO_OPS,
      name: '信息处理运营部门',
      description: '负责外部消息接入、摘要、竞品监控与信息分发。',
      gradient: 'from-blue-500 to-purple-600',
      icon: Mail,
      price: '免费',
      originalPrice: '免费',
      discount: null as string | null,
      members: ['信息助手小明（默认）'],
      popular: true,
      hired: hiredTeamKeys.has(TEAM_KEYS.INFO_OPS),
    },
    {
      id: TEAM_KEYS.ENGINEERING,
      name: '研发团队',
      description: '负责数字分身、策略迭代与会话质量优化。',
      gradient: 'from-green-500 to-teal-600',
      icon: Code2,
      price: '免费',
      originalPrice: '免费',
      discount: null as string | null,
      members: ['研发助手Alpha（默认）'],
      popular: false,
      hired: hiredTeamKeys.has(TEAM_KEYS.ENGINEERING),
    },
    {
      id: TEAM_KEYS.MARKETING_OPS,
      name: '营销运营部门',
      description: '负责投放监控、声量追踪与渠道推广执行。',
      gradient: 'from-orange-500 to-red-600',
      icon: Megaphone,
      price: '免费',
      originalPrice: '免费',
      discount: null as string | null,
      members: ['营销助手Beta（默认）'],
      popular: false,
      hired: hiredTeamKeys.has(TEAM_KEYS.MARKETING_OPS),
    },
  ];

  const getTalentIcon = (id: string) => {
    if (id === 'gmail-assistant') return { Icon: Mail, color: 'text-red-600 bg-red-50' };
    if (id === 'feishu-assistant') return { Icon: MessageSquare, color: 'text-blue-600 bg-blue-50' };
    if (id === 'wechat-assistant') return { Icon: FileText, color: 'text-green-600 bg-green-50' };
    if (id === 'xiaohongshu-assistant') return { Icon: Star, color: 'text-rose-600 bg-rose-50' };
    if (id === 'pm-agent') return { Icon: Palette, color: 'text-purple-600 bg-purple-50' };
    if (id === 'growth-agent') return { Icon: Megaphone, color: 'text-orange-600 bg-orange-50' };
    if (id === 'discord-assistant') return { Icon: Hash, color: 'text-indigo-600 bg-indigo-50' };
    if (id === 'facebook-assistant') return { Icon: Megaphone, color: 'text-blue-600 bg-blue-50' };
    if (id === 'instagram-assistant') return { Icon: Palette, color: 'text-pink-600 bg-pink-50' };
    if (id === 'tiktok-assistant') return { Icon: Video, color: 'text-gray-900 bg-gray-100' };
    if (id === 'qa-agent') return { Icon: Headphones, color: 'text-teal-600 bg-teal-50' };
    return { Icon: Code2, color: 'text-slate-700 bg-slate-100' };
  };

  return (
    <FigmaShell
      homeHref={dbUser.role === 'INVESTOR' ? '/dashboard' : '/candidate'}
      title="AI人才大厅"
      subtitle="雇佣AI员工，组建你的专属团队"
    >
      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-5 flex flex-col gap-4 md:flex-row">
          <div className="flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                readOnly
                value=""
                placeholder="搜索AI员工或部门..."
                className="w-full rounded-xl border border-gray-300 px-9 py-2.5 text-sm text-gray-700 placeholder:text-gray-400"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white">
              部门团队
            </button>
            <button type="button" className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">
              单个雇佣
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {['全部', '信息处理运营', '工程开发', '营销运营'].map((tab, index) => (
            <button
              key={tab}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${
                index === 0 ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">部门团队套餐</h2>
          <p className="text-sm text-gray-600">一键雇佣整个部门，更高效更优惠</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {departmentPackages.map((pkg) => (
            <div
              key={pkg.id}
              className={`relative rounded-2xl border bg-white p-6 ${pkg.popular ? 'border-blue-500' : 'border-gray-200'}`}
            >
              {pkg.popular ? (
                <span className="absolute -top-3 left-5 rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">最热门</span>
              ) : null}
              <div className="mb-3 flex items-center gap-3">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${pkg.gradient}`}>
                  <pkg.icon className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900">{pkg.name}</h3>
              </div>
              <p className="mt-1 text-sm text-gray-600">{pkg.description}</p>

              <div className="mt-4">
                <p className="mb-2 text-sm font-medium text-gray-700">包含 {pkg.members.length} 名员工：</p>
                <div className="space-y-1">
                  {pkg.members.map((name) => (
                    <div key={name} className="flex items-center gap-2 text-sm text-gray-700">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex items-end gap-2">
                <span className="text-2xl font-bold text-gray-900">{pkg.price}</span>
                {pkg.discount ? (
                  <>
                    <span className="text-sm text-gray-400 line-through">{pkg.originalPrice}</span>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{pkg.discount}</span>
                  </>
                ) : null}
              </div>

              <form action="/api/investor/team-hires" method="post" className="mt-4">
                <input type="hidden" name="teamKey" value={pkg.id} />
                <input type="hidden" name="action" value={pkg.hired ? 'unhire' : 'hire'} />
                <button
                  type="submit"
                  className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold ${
                    pkg.hired
                      ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {pkg.hired ? '已雇佣（点击取消）' : '雇佣整个部门'}
                </button>
              </form>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">单个雇佣</h2>
          <p className="text-sm text-gray-600">根据需求选择特定的AI员工</p>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">已启用AI员工</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{enabled.size}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">数字分身数量</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{dbUser.avatars.length}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">演示态岗位</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{mockTalents.filter((t) => t.type === 'demo').length}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {mockTalents.map((talent) => {
          const isEnabled = enabled.has(talent.id);
          const { Icon, color } = getTalentIcon(talent.id);
          return (
            <div key={talent.id} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="mb-4 flex items-start justify-between">
                <div className={`rounded-lg p-3 ${color}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    isEnabled
                      ? 'bg-emerald-100 text-emerald-800'
                      : talent.type === 'demo'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {isEnabled ? '已启用' : talent.type === 'demo' ? '演示态' : '可启用'}
                </span>
              </div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">{talent.name}</h3>
                <div className="flex items-center gap-1 text-sm text-gray-700">
                  <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                  <span>{talent.rating}</span>
                </div>
              </div>
              <p className="mb-2 text-xs text-gray-500">{talent.hires.toLocaleString()} 次雇佣 · {talent.category}</p>
              <p className="mt-2 text-sm text-gray-600">{talent.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {talent.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-gray-200 px-2 py-1 text-xs text-gray-600">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between">
                <span className="text-lg font-bold text-gray-900">{talent.price}</span>
                <button
                  type="button"
                  className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                    isEnabled ? 'border border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isEnabled ? '已启用' : '雇佣'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </FigmaShell>
  );
}
