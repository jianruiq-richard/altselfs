import { auth } from '@clerk/nextjs/server';
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
    description: 'Senior full-stack engineer with 10 years of experience across AI products, Web3 infrastructure, and developer platforms.',
    systemPrompt: 'Technical AI Web3 React Node.js Python software architecture',
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
    description: 'Product designer with 8 years of UX/UI experience for SaaS dashboards, mobile products, and design systems.',
    systemPrompt: 'Product design UX UI Figma design systems user research',
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
    description: 'Product strategist who helps zero-to-one teams define positioning, roadmap tradeoffs, and launch plans.',
    systemPrompt: 'Product strategy go-to-market roadmap positioning launch planning',
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
    description: 'AI research analyst focused on market signals, competitive intelligence, and practical adoption trends.',
    systemPrompt: 'AI research market analysis insights competitive intelligence',
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
    description: 'Operations leader with experience in growth systems, workflow design, and cross-functional execution.',
    systemPrompt: 'Operations strategy growth systems workflow design execution',
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
    description: 'Content and community strategist specializing in audience research, editorial planning, and creator partnerships.',
    systemPrompt: 'Content strategy community growth audience research creator partnerships',
    status: 'ACTIVE',
    isPublic: true,
    investorName: 'Emma Chen',
    conversations: 1089,
    allowChat: false,
  },
];

function inferCategory(text: string): Exclude<DigitalTwinCategory, 'all'> {
  const normalized = text.toLowerCase();
  if (/design|figma|ui|ux|research|system/.test(normalized)) return 'design';
  if (/research|analysis|insight|intelligence|learn|knowledge/.test(normalized)) return 'knowledge';
  if (/strategy|product|market|operations|growth|community|launch/.test(normalized)) return 'business';
  return 'tech';
}

function extractTags(text: string): string[] {
  const dictionary = [
    'AI',
    'Web3',
    'SaaS',
    'Product',
    'Strategy',
    'Design',
    'Research',
    'Technical',
    'Operations',
    'Growth',
    'Community',
    'Frontend',
  ];
  const matched = dictionary.filter((tag) => text.toLowerCase().includes(tag.toLowerCase()));
  return matched.slice(0, 4);
}

function extractSkills(text: string): string[] {
  const map = [
    { key: /react|frontend/, value: 'React' },
    { key: /node|backend|architecture/, value: 'Node.js' },
    { key: /python|analysis/, value: 'Python' },
    { key: /product|strategy|roadmap/, value: 'Product strategy' },
    { key: /design|figma|ui|ux/, value: 'Product design' },
    { key: /communication|community|content|partnership/, value: 'Communication' },
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
    title: input.investorName ? `${input.investorName}'s Digital Twin` : 'Digital Twin',
    bio: input.description || 'No bio available yet.',
    tags: tags.length > 0 ? tags : ['AI', 'Strategy'],
    skills: skills.length > 0 ? skills : ['Analysis', 'Planning', 'Communication'],
    conversations: input.conversations,
    rating: Math.min(5, 4.6 + Math.min(input.conversations, 60) / 150),
    category: inferCategory(textBase),
    isPublic: input.isPublic,
    detailHref: null,
    chatHref: input.allowChat ? `/chat/${input.id}` : null,
  } satisfies DigitalTwinCard;
}

export default async function DigitalTwinsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true },
  });
  if (!dbUser) redirect('/dashboard');

  const avatars = await prisma.avatar.findMany({
    where: { status: 'ACTIVE', isPublic: true },
    select: {
      id: true,
      name: true,
      avatar: true,
      description: true,
      systemPrompt: true,
      status: true,
      isPublic: true,
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

  // Keep real public twins first, then fill the gallery with polished mock examples.
  const cards = [...realTwinCards, ...mockTwins]
    .filter((card, index, arr) => arr.findIndex((item) => item.id === card.id) === index)
    .slice(0, 12);

  return (
    <FigmaShell homeHref="/dashboard" showPageHeader={false}>
      <DigitalTwinsGallery cards={cards} />
    </FigmaShell>
  );
}
