import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { FigmaShell } from '@/components/figma-shell';
import MyDigitalTwinWorkbench from '@/components/my-digital-twin-workbench';
import type { DefaultAvatarItem, ReceivedConversationItem } from '@/components/my-digital-twin-workbench';

function deriveTwinDisplayBase(input: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  const name = String(input.name || '').trim();
  if (name) return name;

  const email = String(input.email || '').trim();
  if (email.includes('@')) {
    const prefix = email.split('@')[0]?.trim();
    if (prefix) return prefix;
  }

  const phone = String(input.phone || '').trim();
  if (phone) return phone;

  return '';
}

function defaultTwinName(input: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  const base = deriveTwinDisplayBase(input);
  return base ? `${base} Twin` : 'My Digital Twin';
}

function pickVisitorEmoji(seed: string) {
  const pool = ['👨‍💼', '👩‍💻', '🎨', '📊', '🚀', '🧠', '📚', '🛠️'];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[hash % pool.length];
}

function buildMockConversations(baseAvatarId: string): ReceivedConversationItem[] {
  const now = Date.now();
  const samples: Array<{ name: string; title: string; summary: string; message: string }> = [
    {
      name: 'Alex Chen',
      title: 'Product founder',
      message: 'Can this AI workflow become a useful product?',
      summary: 'Explored product positioning, market risk, and recommended next steps.',
    },
    {
      name: 'Jordan Lee',
      title: 'Investor',
      message: 'What would make this opportunity worth a deeper look?',
      summary: 'Discussed investment criteria, traction signals, and follow-up questions.',
    },
    {
      name: 'Taylor Morgan',
      title: 'Technical lead',
      message: 'Can you review the technical architecture?',
      summary: 'Reviewed technical tradeoffs and implementation risks.',
    },
  ];

  return samples.map((sample, idx) => {
    const start = new Date(now - (idx + 3) * 86_400_000);
    const end = new Date(now - (idx + 2) * 86_400_000 + 3_600_000);
    return {
      id: `mock-conversation-${idx + 1}`,
      avatarId: baseAvatarId,
      chatId: null,
      visitor: {
        name: sample.name,
        avatar: pickVisitorEmoji(sample.name),
        title: sample.title,
      },
      lastMessage: sample.message,
      messageCount: 8 + idx * 4,
      startTime: start.toISOString(),
      lastActiveTime: end.toISOString(),
      status: idx === 0 ? 'active' : 'completed',
      aiSummary: sample.summary,
    };
  });
}

async function getInvestorTwinData(clerkId: string) {
  return prisma.user.findUnique({
    where: { clerkId },
    relationLoadStrategy: 'join',
    select: {
      id: true,
      role: true,
      name: true,
      email: true,
      nickname: true,
      phone: true,
      wechatId: true,
      _count: {
        select: {
          integrations: true,
          wechatSources: true,
        },
      },
      avatars: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          id: true,
          name: true,
          description: true,
          systemPrompt: true,
          avatar: true,
          status: true,
          isPublic: true,
          _count: {
            select: {
              chats: true,
            },
          },
          chats: {
            orderBy: {
              updatedAt: 'desc',
            },
            take: 20,
            select: {
              id: true,
              title: true,
              status: true,
              summary: true,
              qualificationReason: true,
              createdAt: true,
              updatedAt: true,
              candidate: {
                select: {
                  id: true,
                  nickname: true,
                  name: true,
                },
              },
              messages: {
                orderBy: {
                  createdAt: 'desc',
                },
                take: 1,
                select: {
                  content: true,
                },
              },
              _count: {
                select: {
                  messages: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

export default async function AvatarHomePage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  let dbUser = await getInvestorTwinData(userId);

  if (!dbUser) {
    redirect('/dashboard');
  }

  if (dbUser.avatars.length === 0) {
    await prisma.avatar.create({
      data: {
        investorId: dbUser.id,
        name: defaultTwinName({
          name: dbUser.name,
          email: dbUser.email,
          phone: dbUser.phone,
        }),
        description: 'Default digital twin for representing your preferences and decision style.',
        systemPrompt:
          'You are my digital twin. Answer in my style, ask clarifying questions when needed, and help others understand my priorities, preferences, and decision criteria.',
        status: 'ACTIVE',
      },
    });

    dbUser = await getInvestorTwinData(userId);
  }

  if (!dbUser || dbUser.avatars.length === 0) {
    redirect('/dashboard');
  }

  const defaultAvatarRecord = dbUser.avatars[0];
  const totalChats = defaultAvatarRecord._count.chats;
  const totalTokens = 2400 + totalChats * 320 + dbUser._count.integrations * 450 + dbUser._count.wechatSources * 180;

  const completionSeed = [
    20,
    dbUser._count.integrations > 0 ? 15 : 0,
    dbUser._count.wechatSources > 0 ? 15 : 0,
    dbUser.nickname ? 10 : 0,
    dbUser.phone ? 10 : 0,
    dbUser.wechatId ? 10 : 0,
    totalChats > 0 ? 20 : 0,
  ].reduce((a, b) => a + b, 0);
  const totalCompletion = Math.max(20, Math.min(96, completionSeed));

  const defaultAvatar: DefaultAvatarItem = {
    id: defaultAvatarRecord.id,
    name: defaultAvatarRecord.name,
    description: defaultAvatarRecord.description || '',
    systemPrompt: defaultAvatarRecord.systemPrompt,
    avatar: defaultAvatarRecord.avatar,
    status: defaultAvatarRecord.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    isPublic: defaultAvatarRecord.isPublic,
    chatsCount: defaultAvatarRecord._count.chats,
  };

  const receivedConversationsRaw: ReceivedConversationItem[] = defaultAvatarRecord.chats
    .map((chat) => {
      const visitorName = chat.candidate.nickname || chat.candidate.name || 'Anonymous user';
      const lastMessage = chat.messages[0]?.content || chat.qualificationReason || 'No message yet';
      return {
        id: chat.id,
        avatarId: defaultAvatarRecord.id,
        chatId: chat.id,
        visitor: {
          name: visitorName,
          avatar: pickVisitorEmoji(`${chat.candidate.id}-${chat.id}`),
          title: chat.candidate.nickname ? 'Registered user' : 'Visitor',
        },
        lastMessage,
        messageCount: chat._count.messages,
        startTime: chat.createdAt.toISOString(),
        lastActiveTime: chat.updatedAt.toISOString(),
        status: chat.status === 'ACTIVE' ? ('active' as const) : ('completed' as const),
        aiSummary:
          chat.summary ||
          chat.qualificationReason ||
          `The conversation with ${defaultAvatarRecord.name} is ready for review.`,
      };
    })
    .sort((a, b) => +new Date(b.lastActiveTime) - +new Date(a.lastActiveTime));

  const receivedConversations =
    receivedConversationsRaw.length > 0
      ? receivedConversationsRaw
      : buildMockConversations(defaultAvatarRecord.id);

  return (
    <FigmaShell homeHref="/dashboard" showPageHeader={false}>
      <MyDigitalTwinWorkbench
        totalTokens={totalTokens}
        totalCompletion={totalCompletion}
        defaultAvatar={defaultAvatar}
        receivedConversations={receivedConversations}
      />
    </FigmaShell>
  );
}
