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
    description: '10content, content AI content Web3.content, content.',
    systemPrompt: 'Technical content AI Web3 React Node.js Python content',
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
    description: '8content UX/UI content, content.',
    systemPrompt: 'content UX UI Figma content content',
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
    description: 'content0content1, content.',
    systemPrompt: 'content strategy product content content content',
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
    description: 'AI content, content, content.',
    systemPrompt: 'content content AI content analysis insight content',
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
    description: 'content, content, content, content.',
    systemPrompt: 'content content strategy content content content',
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
    description: 'content, content, content.',
    systemPrompt: 'content content strategy content content content',
    status: 'ACTIVE',
    isPublic: true,
    investorName: 'Emma Chen',
    conversations: 1089,
    allowChat: false,
  },
];

function inferCategory(text: string): Exclude<DigitalTwinCategory, 'all'> {
  const normalized = text.toLowerCase();
  if (/content|design|figma|ui|ux/.test(normalized)) return 'design';
  if (/content|content|analysis|insight|learn/.test(normalized)) return 'knowledge';
  if (/content|content|strategy|product|content|content/.test(normalized)) return 'business';
  return 'tech';
}

function extractTags(text: string): string[] {
  const dictionary = [
    'AI',
    'Web3',
    'SaaS',
    'content',
    'content',
    'content',
    'content',
    'Technical',
    'content',
    'content',
    'content',
    'content',
  ];
  const matched = dictionary.filter((tag) => text.toLowerCase().includes(tag.toLowerCase()));
  return matched.slice(0, 4);
}

function extractSkills(text: string): string[] {
  const map = [
    { key: /react|content|frontend/, value: 'React' },
    { key: /node|backend|content/, value: 'Node.js' },
    { key: /python|content|analysis/, value: 'Python' },
    { key: /content|strategy|content/, value: 'content' },
    { key: /design|content|ui|ux/, value: 'content' },
    { key: /content|content|content/, value: 'Communication' },
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
    title: input.investorName ? `${input.investorName} content` : 'content',
    bio: input.description || 'content.',
    tags: tags.length > 0 ? tags : ['content', 'content'],
    skills: skills.length > 0 ? skills : ['content', 'content', 'content'],
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

  // content; content mock content.
  const cards = [...realTwinCards, ...mockTwins]
    .filter((card, index, arr) => arr.findIndex((item) => item.id === card.id) === index)
    .slice(0, 12);

  return (
    <FigmaShell homeHref="/dashboard" showPageHeader={false}>
      <DigitalTwinsGallery cards={cards} />
    </FigmaShell>
  );
}
