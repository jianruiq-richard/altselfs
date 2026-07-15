import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { FigmaShell } from '@/components/figma-shell';
import { CheckCircle2, Code2, FileText, Hash, Headphones, Mail, Megaphone, MessageSquare, Palette, Search, Star, Video } from 'lucide-react';
import { resolveHiredTeamKeys, TEAM_KEYS } from '@/lib/team-library';

const mockTalents = [
  {
    id: 'gmail-assistant',
    name: 'Gmail Assistant',
    description: 'Automatically organize your inbox, identify high-priority emails, and draft reply suggestions.',
    tags: ['Email triage', 'Priority decisions', 'Summary generation'],
    type: 'real',
    category: 'Information Operations',
    price: 'Free',
    rating: 4.8,
    hires: 12453,
  },
  {
    id: 'feishu-assistant',
    name: 'Lark Assistant',
    description: 'Aggregate team messages, meeting notes, and action items.',
    tags: ['Message synthesis', 'Meeting brief', 'Action-item extraction'],
    type: 'real',
    category: 'Information Operations',
    price: 'Free',
    rating: 4.9,
    hires: 8932,
  },
  {
    id: 'wechat-assistant',
    name: 'WeChat Assistant',
    description: 'Track WeChat Official Account updates, extract key information, and retain useful knowledge.',
    tags: ['Content summaries', 'Trend tracking', 'Knowledge capture'],
    type: 'real',
    category: 'Information Operations',
    price: 'Free',
    rating: 4.7,
    hires: 15678,
  },
  {
    id: 'xiaohongshu-assistant',
    name: 'Xiaohongshu Assistant',
    description: 'Track Xiaohongshu content trends, identify shifts, and surface content opportunities.',
    tags: ['Trend tracking', 'Note analysis', 'Trend insights'],
    type: 'real',
    category: 'Information Operations',
    price: 'Free',
    rating: 4.7,
    hires: 9642,
  },
  {
    id: 'pm-agent',
    name: 'Product Strategy Advisor',
    description: 'Demo: content, content.',
    tags: ['Roadmap planning', 'Requirement breakdown', 'Priority assessment'],
    type: 'demo',
    category: 'Engineering',
    price: '¥399/content (Demo)',
    rating: 4.7,
    hires: 412,
  },
  {
    id: 'discord-assistant',
    name: 'Discord Assistant',
    description: 'Demo: content Discord contentKey events.',
    tags: ['Community management', 'Discussion summaries', 'Key events'],
    type: 'demo',
    category: 'Marketing Operations',
    price: '¥199/content (Demo)',
    rating: 4.5,
    hires: 321,
  },
  {
    id: 'facebook-assistant',
    name: 'Facebook Assistant',
    description: 'Demo: content Facebook content.',
    tags: ['Activity tracking', 'Engagement analysis', 'Content organization'],
    type: 'demo',
    category: 'Marketing Operations',
    price: '¥199/content (Demo)',
    rating: 4.4,
    hires: 255,
  },
  {
    id: 'instagram-assistant',
    name: 'Instagram Assistant',
    description: 'Demo: content Instagram contentAudience engagement.',
    tags: ['Content analysis', 'Audience engagement', 'Trend discovery'],
    type: 'demo',
    category: 'Marketing Operations',
    price: '¥199/content (Demo)',
    rating: 4.6,
    hires: 367,
  },
  {
    id: 'tiktok-assistant',
    name: 'TikTok Assistant',
    description: 'Demo: content.',
    tags: ['Video analysis', 'Trend tracking', 'Creative ideas'],
    type: 'demo',
    category: 'Marketing Operations',
    price: '¥199/content (Demo)',
    rating: 4.5,
    hires: 402,
  },
  {
    id: 'growth-agent',
    name: 'Growth Operations Specialist',
    description: 'Demo: content, content.',
    tags: ['Funnel analysis', 'Conversion optimization', 'Campaign planning'],
    type: 'demo',
    category: 'Marketing Operations',
    price: '¥399/content (Demo)',
    rating: 4.8,
    hires: 287,
  },
  {
    id: 'qa-agent',
    name: 'Conversation QA Analyst',
    description: 'Demo: content, content.',
    tags: ['Conversation scoring', 'Risk alerts', 'Improvement suggestions'],
    type: 'demo',
    category: 'Engineering',
    price: '¥199/content (Demo)',
    rating: 4.6,
    hires: 198,
  },
] as const;

export default async function AITalentPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
    relationLoadStrategy: 'join',
    select: {
      id: true,
      role: true,
      integrations: {
        select: {
          provider: true,
        },
      },
      wechatSources: {
        select: {
          id: true,
        },
      },
      avatars: {
        select: {
          id: true,
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
      name: 'Executive Office',
      description: 'Owns briefings, cross-team cadence, and priority coordination.',
      gradient: 'from-purple-500 to-pink-600',
      icon: Code2,
      price: 'Free',
      originalPrice: 'Free',
      discount: null as string | null,
      members: ['Executive Assistant Momo (default)'],
      popular: false,
      hired: hiredTeamKeys.has(TEAM_KEYS.EXECUTIVE_OFFICE),
    },
    {
      id: TEAM_KEYS.INFO_OPS,
      name: 'Information Operations',
      description: 'Owns external message intake, summaries, competitive monitoring, and information distribution.',
      gradient: 'from-blue-500 to-purple-600',
      icon: Mail,
      price: 'Free',
      originalPrice: 'Free',
      discount: null as string | null,
      members: ['Information Operations Assistant (default)'],
      popular: true,
      hired: hiredTeamKeys.has(TEAM_KEYS.INFO_OPS),
    },
    {
      id: TEAM_KEYS.ENGINEERING,
      name: 'Engineering',
      description: 'Owns digital twins, strategy iteration, and conversation quality optimization.',
      gradient: 'from-green-500 to-teal-600',
      icon: Code2,
      price: 'Free',
      originalPrice: 'Free',
      discount: null as string | null,
      members: ['Engineering AssistantAlpha (default)'],
      popular: false,
      hired: hiredTeamKeys.has(TEAM_KEYS.ENGINEERING),
    },
    {
      id: TEAM_KEYS.MARKETING_OPS,
      name: 'Marketing Operations',
      description: 'Owns campaign monitoring, share-of-voice tracking, and channel execution.',
      gradient: 'from-orange-500 to-red-600',
      icon: Megaphone,
      price: 'Free',
      originalPrice: 'Free',
      discount: null as string | null,
      members: ['Marketing AssistantBeta (default)'],
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
      homeHref="/dashboard"
      title="AI Talent Hub"
      subtitle="Hire AI teammates and build your dedicated team"
    >
      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-5 flex flex-col gap-4 md:flex-row">
          <div className="flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                readOnly
                value=""
                placeholder="Search AI teammates or departments..."
                className="w-full rounded-xl border border-gray-300 px-9 py-2.5 text-sm text-gray-700 placeholder:text-gray-400"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white">
              Department Teams
            </button>
            <button type="button" className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">
              Individual Hiring
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {['All', 'Information Operations', 'Engineering', 'Marketing Operations'].map((tab, index) => (
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
          <h2 className="text-xl font-bold text-gray-900">Department Packages</h2>
          <p className="text-sm text-gray-600">Hire an entire department at once for better efficiency and value</p>
        </div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {departmentPackages.map((pkg) => (
              <div
                key={pkg.id}
                className={`relative rounded-2xl border bg-white p-6 ${pkg.popular ? 'border-blue-500' : 'border-gray-200'}`}
              >
                {pkg.popular ? (
                  <span className="absolute -top-3 left-5 rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">Most popular</span>
                ) : null}
                <div className="mb-3 flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${pkg.gradient}`}>
                    <pkg.icon className="h-5 w-5 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">{pkg.name}</h3>
                </div>

                <p className="mt-1 text-sm text-gray-600">{pkg.description}</p>

                <div className="mt-4">
                  <p className="mb-2 text-sm font-medium text-gray-700">Includes {pkg.members.length} team members: </p>
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
                    {pkg.hired ? 'Hired (click to cancel)' : 'Hire entire department'}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-4">
            <h2 className="text-xl font-bold text-gray-900">Individual Hiring</h2>
            <p className="text-sm text-gray-600">Choose specific AI teammates for your needs</p>
          </div>

          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="text-sm text-gray-500">Enabled AI teammates</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{enabled.size}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="text-sm text-gray-500">Digital twin count</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{dbUser.avatars.length}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="text-sm text-gray-500">Demo roles</p>
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
                    {isEnabled ? 'Enabled' : talent.type === 'demo' ? 'Demo' : 'Available'}
                  </span>
                </div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">{talent.name}</h3>
                  <div className="flex items-center gap-1 text-sm text-gray-700">
                    <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                    <span>{talent.rating}</span>
                  </div>
                </div>
                <p className="mb-2 text-xs text-gray-500">{talent.hires.toLocaleString()} hires · {talent.category}</p>
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
                    {isEnabled ? 'Enabled' : 'Hire'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
    </FigmaShell>
  );
}
