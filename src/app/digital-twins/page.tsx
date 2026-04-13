import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { FigmaShell } from '@/components/figma-shell';
import DigitalTwinsGallery, { type DigitalTwinCard, type DigitalTwinCategory } from '@/components/digital-twins-gallery';

type TwinSeed = {
  id: string;
  name: string;
  avatar: string | null;
  description: string;
  systemPrompt: string;
  status: string;
  isPublic: boolean;
  investorName: string;
  conversations: number;
  allowChat: boolean;
};

const mockTwinSeeds: TwinSeed[] = [
  {
    id: 'mock-1',
    name: 'Alex Chen',
    avatar: null,
    description: '10年软件开发经验，专注于 AI 和 Web3。擅长系统架构设计，热爱开源。',
    systemPrompt: '技术 创业 AI Web3 React Node.js Python 系统设计',
    status: 'ACTIVE',
    isPublic: true,
    investorName: 'Alex Chen',
    conversations: 1247,
    allowChat: false,
  },
  {
    id: 'mock-2',
    name: 'Sarah Wang',
    avatar: null,
    description: '8年 UX/UI 设计经验，擅长用户研究和交互设计。',
    systemPrompt: '设计 UX UI Figma 用户研究 产品设计',
    status: 'ACTIVE',
    isPublic: true,
    investorName: 'Sarah Wang',
    conversations: 892,
    allowChat: false,
  },
  {
    id: 'mock-3',
    name: 'Michael Zhang',
    avatar: null,
    description: '帮助多家创业公司从0到1，擅长产品策略与市场分析。',
    systemPrompt: '商业 strategy product 运营 管理 增长',
    status: 'ACTIVE',
    isPublic: true,
    investorName: 'Michael Zhang',
    conversations: 2103,
    allowChat: false,
  },
  {
    id: 'mock-4',
    name: 'Lisa Liu',
    avatar: null,
    description: 'AI 研究员与讲师，长期关注模型评测、应用落地与知识体系化。',
    systemPrompt: '研究 知识 AI 学习 analysis insight 数据',
    status: 'ACTIVE',
    isPublic: true,
    investorName: 'Lisa Liu',
    conversations: 1567,
    allowChat: false,
  },
  {
    id: 'mock-5',
    name: 'Tom Wu',
    avatar: null,
    description: '增长策略顾问，擅长从产品、渠道、数据三维制定增长路径。',
    systemPrompt: '增长 商业 strategy 产品 运营 数据',
    status: 'ACTIVE',
    isPublic: true,
    investorName: 'Tom Wu',
    conversations: 743,
    allowChat: false,
  },
  {
    id: 'mock-6',
    name: 'Emma Chen',
    avatar: null,
    description: '创新顾问，关注科技趋势与组织变革，擅长商业模式设计。',
    systemPrompt: '创新 商业 strategy 管理 设计 产品',
    status: 'ACTIVE',
    isPublic: true,
    investorName: 'Emma Chen',
    conversations: 1089,
    allowChat: false,
  },
];

function inferCategory(text: string): Exclude<DigitalTwinCategory, 'all'> {
  const normalized = text.toLowerCase();
  if (/设计|design|figma|ui|ux/.test(normalized)) return 'design';
  if (/研究|知识|analysis|insight|learn/.test(normalized)) return 'knowledge';
  if (/增长|商业|strategy|product|运营|管理/.test(normalized)) return 'business';
  return 'tech';
}

function extractTags(text: string): string[] {
  const dictionary = [
    'AI',
    'Web3',
    'SaaS',
    '出海',
    '增长',
    '投研',
    '产品',
    '技术',
    '设计',
    '创业',
    '数据',
    '运营',
  ];
  const matched = dictionary.filter((tag) => text.toLowerCase().includes(tag.toLowerCase()));
  return matched.slice(0, 4);
}

function extractSkills(text: string): string[] {
  const map = [
    { key: /react|前端|frontend/, value: 'React' },
    { key: /node|backend|后端/, value: 'Node.js' },
    { key: /python|数据|analysis/, value: 'Python' },
    { key: /产品|strategy|商业/, value: '产品策略' },
    { key: /design|设计|ui|ux/, value: '体验设计' },
    { key: /沟通|协作|管理/, value: '沟通协作' },
  ];
  const list = map.filter((item) => item.key.test(text.toLowerCase())).map((item) => item.value);
  return list.slice(0, 4);
}

function normalizeCardFromAvatar(input: {
  id: string;
  name: string;
  avatar: string | null;
  description: string | null;
  systemPrompt: string;
  status: string;
  isPublic: boolean;
  investorName: string | null;
  conversations: number;
  allowChat: boolean;
}) {
  const textBase = `${input.description || ''}\n${input.systemPrompt || ''}`;
  const tags = extractTags(textBase);
  const skills = extractSkills(textBase);
  return {
    id: input.id,
    name: input.name,
    avatarEmoji: null,
    avatarUrl: input.avatar,
    title: input.investorName ? `${input.investorName} 的数字分身` : '数字分身',
    bio: input.description || '这个数字分身还没有填写详细介绍。',
    tags: tags.length > 0 ? tags : ['数字分身', '真实数据'],
    skills: skills.length > 0 ? skills : ['会话理解', '项目讨论', '经验分享'],
    conversations: input.conversations,
    rating: Math.min(5, 4.6 + Math.min(input.conversations, 60) / 150),
    category: inferCategory(textBase),
    isPublic: input.isPublic,
    detailHref: null,
    chatHref: input.allowChat ? `/chat/${input.id}` : null,
  } satisfies DigitalTwinCard;
}

export default async function DigitalTwinsPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id },
    select: { role: true },
  });
  if (!dbUser) redirect('/dashboard');

  const avatars = await prisma.avatar.findMany({
    where: { status: 'ACTIVE', isPublic: true },
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

  const realTwinCards: DigitalTwinCard[] = avatars.map((avatar) =>
    normalizeCardFromAvatar({
      id: avatar.id,
      name: avatar.name,
      avatar: avatar.avatar,
      description: avatar.description,
      systemPrompt: avatar.systemPrompt,
      status: avatar.status,
      isPublic: avatar.isPublic,
      investorName: avatar.investor.name,
      conversations: avatar._count.chats,
      allowChat: dbUser.role === 'CANDIDATE',
    })
  );

  const mockTwins: DigitalTwinCard[] = mockTwinSeeds.map((seed) =>
    normalizeCardFromAvatar({
      id: seed.id,
      name: seed.name,
      avatar: seed.avatar,
      description: seed.description,
      systemPrompt: seed.systemPrompt,
      status: seed.status,
      isPublic: seed.isPublic,
      investorName: seed.investorName,
      conversations: seed.conversations,
      allowChat: seed.allowChat,
    })
  );

  // 真实数据优先展示；当真实分身不足时自动补齐结构化 mock 样例。
  const cards = [...realTwinCards, ...mockTwins]
    .filter((card, index, arr) => arr.findIndex((item) => item.id === card.id) === index)
    .slice(0, 12);

  return (
    <FigmaShell homeHref={dbUser.role === 'INVESTOR' ? '/investor' : '/candidate'} showPageHeader={false}>
      <DigitalTwinsGallery cards={cards} />
    </FigmaShell>
  );
}
