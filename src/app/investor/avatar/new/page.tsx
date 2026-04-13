import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { FigmaShell } from '@/components/figma-shell';
import MyDigitalTwinWorkbench from '@/components/my-digital-twin-workbench';
import type { AvatarItem, ReceivedConversationItem } from '@/components/my-digital-twin-workbench';

function pickVisitorEmoji(seed: string) {
  const pool = ['👨‍💼', '👩‍💻', '🎨', '📊', '🚀', '🧠', '📚', '🛠️'];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[hash % pool.length];
}

function buildMockConversations(avatars: AvatarItem[]): ReceivedConversationItem[] {
  const baseAvatar = avatars[0];
  const now = Date.now();
  const samples: Array<{ name: string; title: string; summary: string; message: string }> = [
    {
      name: '张伟',
      title: '产品经理',
      message: '想了解一下你在 AI 投资中的评估标准',
      summary: '访客重点询问了投资判断维度，系统展示了你在赛道、团队和执行力方面的筛选逻辑。',
    },
    {
      name: '李娜',
      title: '创业者',
      message: '我们团队想请你点评当前的商业模式',
      summary: '访客描述了当前项目商业模式，系统围绕目标用户、收入模型和竞争差异化给出建议。',
    },
    {
      name: '王强',
      title: '技术负责人',
      message: '请帮我看下技术路线和融资节奏是否匹配',
      summary: '访客咨询技术路线与融资节奏匹配问题，系统建议按阶段目标拆分里程碑并同步优化叙事。',
    },
  ];

  return samples.map((sample, idx) => {
    const start = new Date(now - (idx + 3) * 86_400_000);
    const end = new Date(now - (idx + 2) * 86_400_000 + 3_600_000);
    return {
      id: `mock-conversation-${idx + 1}`,
      avatarId: baseAvatar?.id || 'mock-avatar',
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

export default async function MyDigitalTwinPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id },
    include: {
      avatars: {
        include: {
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
            include: {
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
              },
              _count: {
                select: {
                  messages: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      integrations: true,
      wechatSources: true,
    },
  });

  if (!dbUser || dbUser.role !== 'INVESTOR') {
    redirect('/dashboard');
  }

  const avatarCount = dbUser.avatars.length;
  const totalChats = dbUser.avatars.reduce((sum, avatar) => sum + avatar._count.chats, 0);
  const totalTokens = avatarCount * 2400 + totalChats * 320 + dbUser.integrations.length * 450 + dbUser.wechatSources.length * 180;

  const completionSeed = [
    avatarCount > 0 ? 20 : 0,
    dbUser.integrations.length > 0 ? 15 : 0,
    dbUser.wechatSources.length > 0 ? 15 : 0,
    dbUser.nickname ? 10 : 0,
    dbUser.phone ? 10 : 0,
    dbUser.wechatId ? 10 : 0,
    totalChats > 0 ? 20 : 0,
  ].reduce((a, b) => a + b, 0);
  const totalCompletion = Math.max(20, Math.min(96, completionSeed));

  const avatars: AvatarItem[] = dbUser.avatars.map((avatar) => ({
    id: avatar.id,
    name: avatar.name,
    status: avatar.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    chatsCount: avatar._count.chats,
  }));

  const receivedConversationsRaw: ReceivedConversationItem[] = dbUser.avatars
    .flatMap((avatar) =>
      avatar.chats.map((chat) => {
        const visitorName = chat.candidate.nickname || chat.candidate.name || '匿名访客';
        const lastMessage = chat.messages[0]?.content || chat.qualificationReason || '开始了新的对话';
        return {
          id: chat.id,
          avatarId: avatar.id,
          chatId: chat.id,
          visitor: {
            name: visitorName,
            avatar: pickVisitorEmoji(`${chat.candidate.id}-${chat.id}`),
            title: chat.candidate.nickname ? '已注册用户' : '访客',
          },
          lastMessage,
          messageCount: chat._count.messages,
          startTime: chat.createdAt.toISOString(),
          lastActiveTime: chat.updatedAt.toISOString(),
          status: chat.status === 'ACTIVE' ? ('active' as const) : ('completed' as const),
          aiSummary:
            chat.summary ||
            chat.qualificationReason ||
            `该对话围绕 ${avatar.name} 的关注方向展开，当前建议继续补充关键信息后再进一步跟进。`,
        };
      })
    )
    .sort((a, b) => +new Date(b.lastActiveTime) - +new Date(a.lastActiveTime));

  const receivedConversations =
    receivedConversationsRaw.length > 0 ? receivedConversationsRaw : buildMockConversations(avatars);

  return (
    <FigmaShell homeHref="/investor" showPageHeader={false}>
      <MyDigitalTwinWorkbench
        avatarCount={avatarCount}
        totalChats={totalChats}
        totalTokens={totalTokens}
        totalCompletion={totalCompletion}
        avatars={avatars}
        receivedConversations={receivedConversations}
      />
    </FigmaShell>
  );
}
