import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { BookOpen, Briefcase, Code, MessageCircle, Palette, Search, Star, TrendingUp } from 'lucide-react';
import { FigmaShell } from '@/components/figma-shell';

const categories = [
  { id: 'all', name: '全部', Icon: Star },
  { id: 'tech', name: '技术', Icon: Code },
  { id: 'business', name: '商业', Icon: Briefcase },
  { id: 'design', name: '设计', Icon: Palette },
  { id: 'knowledge', name: '知识', Icon: BookOpen },
] as const;

const mockTwins = [
  {
    id: 'mock-1',
    name: 'Alex Chen',
    avatar: '👨‍💻',
    title: '全栈工程师 & 创业者',
    bio: '10年软件开发经验，专注于AI和Web3。擅长系统架构设计，热爱开源。',
    tags: ['技术', '创业', 'AI', 'Web3'],
    skills: ['React', 'Node.js', 'Python', '系统设计'],
    conversations: 1247,
    rating: 4.9,
  },
  {
    id: 'mock-2',
    name: 'Sarah Wang',
    avatar: '👩‍🎨',
    title: '产品设计师',
    bio: '8年UX/UI设计经验，擅长用户研究和交互设计。',
    tags: ['设计', '产品', 'UX'],
    skills: ['Figma', '用户研究', '交互设计'],
    conversations: 892,
    rating: 4.8,
  },
  {
    id: 'mock-3',
    name: 'Michael Zhang',
    avatar: '👔',
    title: '产品经理 & 战略顾问',
    bio: '帮助多家创业公司从0到1，擅长产品策略与市场分析。',
    tags: ['产品', '战略', '管理'],
    skills: ['产品规划', '市场分析', 'OKR'],
    conversations: 2103,
    rating: 5.0,
  },
] as const;

export default async function DigitalTwinsPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id },
    select: { role: true },
  });
  if (!dbUser) redirect('/dashboard');

  const avatars = await prisma.avatar.findMany({
    where: { status: 'ACTIVE' },
    include: {
      investor: {
        select: {
          name: true,
        },
      },
      _count: {
        select: {
          chats: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 12,
  });

  const realTwinCards = avatars.map((avatar) => ({
    id: avatar.id,
    name: avatar.name,
    avatarEmoji: null as string | null,
    title: avatar.investor.name ? `${avatar.investor.name} 的数字分身` : '数字分身',
    bio: avatar.description || '这个数字分身还没有填写详细介绍。',
    tags: ['真实数据', '数字分身'],
    skills: ['会话理解', '项目讨论', '经验分享'],
    conversations: avatar._count.chats,
    rating: 4.8,
    chatHref: dbUser.role === 'CANDIDATE' ? `/chat/${avatar.id}` : null,
  }));

  const cards =
    realTwinCards.length > 0
      ? realTwinCards
      : mockTwins.map((item) => ({
          id: item.id,
          name: item.name,
          avatarEmoji: item.avatar,
          title: item.title,
          bio: item.bio,
          tags: item.tags,
          skills: item.skills,
          conversations: item.conversations,
          rating: item.rating,
          chatHref: null,
        }));

  return (
    <FigmaShell homeHref={dbUser.role === 'INVESTOR' ? '/investor' : '/candidate'} title="数字分身大厅" subtitle="探索其他用户的数字分身，与他们的知识和经验对话">
      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              readOnly
              value=""
              placeholder="搜索数字分身、技能、领域..."
              className="w-full rounded-xl border border-gray-300 py-2.5 pl-10 pr-3 text-sm text-gray-700 placeholder:text-gray-400"
            />
          </div>
          <div className="flex gap-2">
            <button type="button" className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white">
              <TrendingUp className="mr-2 h-4 w-4" />
              最热门
            </button>
            <button type="button" className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700">
              <Star className="mr-2 h-4 w-4" />
              最高分
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {categories.map((cat, index) => (
            <button
              key={cat.id}
              type="button"
              className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm ${
                index === 0 ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-700'
              }`}
            >
              <cat.Icon className="mr-1.5 h-4 w-4" />
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((twin) => (
          <div key={twin.id} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
            <div className="mb-4 flex items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-3xl text-white">
                {twin.avatarEmoji || twin.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="mb-1 truncate font-bold text-gray-900">{twin.name}</h3>
                <p className="mb-2 text-sm text-gray-600">{twin.title}</p>
                <div className="flex items-center gap-2 text-sm">
                  <div className="flex items-center">
                    <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                    <span className="ml-1 font-medium text-gray-800">{twin.rating.toFixed(1)}</span>
                  </div>
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-500">{twin.conversations} 次对话</span>
                </div>
              </div>
            </div>

            <p className="mb-4 line-clamp-2 text-sm text-gray-600">{twin.bio}</p>

            <div className="mb-4 flex flex-wrap gap-2">
              {twin.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                  {tag}
                </span>
              ))}
            </div>

            <div className="mb-4">
              <p className="mb-2 text-xs text-gray-500">擅长领域</p>
              <div className="flex flex-wrap gap-1">
                {twin.skills.slice(0, 3).map((skill) => (
                  <span key={skill} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600">
                    {skill}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button type="button" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                查看详情
              </button>
              {twin.chatHref ? (
                <Link href={twin.chatHref} className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-blue-700">
                  <span className="inline-flex items-center justify-center">
                    <MessageCircle className="mr-1.5 h-4 w-4" />
                    发起对话
                  </span>
                </Link>
              ) : (
                <button type="button" className="flex-1 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white">
                  发起对话
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </FigmaShell>
  );
}
