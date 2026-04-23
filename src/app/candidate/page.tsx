import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { FigmaShell } from '@/components/figma-shell';

export default async function CandidateDashboard() {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  // Get user data from our database
  const dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
    relationLoadStrategy: 'join',
    select: {
      role: true,
      nickname: true,
      phone: true,
      wechatId: true,
      chatsAsCandidate: {
        where: {
          status: 'ACTIVE',
        },
        select: {
          id: true,
          updatedAt: true,
          avatar: {
            select: {
              id: true,
              name: true,
              avatar: true,
              description: true,
              investor: {
                select: {
                  name: true,
                },
              },
            },
          },
          messages: {
            select: {
              content: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 1,
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
      },
    },
  });

  if (!dbUser || dbUser.role !== 'CANDIDATE') {
    redirect('/dashboard');
  }

  if (!dbUser.nickname || !dbUser.phone || !dbUser.wechatId) {
    redirect('/dashboard/setup?role=candidate');
  }

  // Get all active avatars
  const avatars = await prisma.avatar.findMany({
    where: { status: 'ACTIVE', isPublic: true },
    select: {
      id: true,
      name: true,
      avatar: true,
      description: true,
      createdAt: true,
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
  });

  return (
    <FigmaShell homeHref="/candidate" title="数字分身大厅" subtitle="与数字分身对话，快速迭代你的项目方案">
      {dbUser.chatsAsCandidate.length > 0 && (
        <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">正在聊的会话</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {dbUser.chatsAsCandidate.map((chat) => (
              <div key={chat.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">{chat.avatar.name}</h3>
                    <p className="text-sm text-slate-500">来自 {chat.avatar.investor.name || 'OPC成员'}</p>
                  </div>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">进行中</span>
                </div>
                {chat.messages[0]?.content ? (
                  <p className="line-clamp-2 text-sm text-slate-600">最近消息：{chat.messages[0].content}</p>
                ) : null}
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-slate-500">更新于 {new Date(chat.updatedAt).toLocaleString('zh-CN')}</p>
                  <Link href={`/chat/${chat.avatar.id}`} className="text-sm font-medium text-blue-700 hover:underline">
                    继续对话
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {avatars.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <h2 className="text-2xl font-bold text-slate-900">暂无可用的数字分身</h2>
          <p className="mt-2 text-slate-600">请稍后再来查看，OPC 成员正在创建他们的数字分身。</p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {avatars.map((avatar) => (
            <div key={avatar.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-purple-600">
                  {avatar.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatar.avatar} alt={avatar.name} className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{avatar.name}</h3>
                  <p className="text-sm text-slate-500">来自 {avatar.investor.name || 'OPC成员'}</p>
                </div>
              </div>

              {avatar.description ? <p className="mt-4 line-clamp-3 text-sm text-slate-600">{avatar.description}</p> : null}

              <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
                <span>{avatar._count.chats} 次对话</span>
                <span>创建于 {new Date(avatar.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>

              <Link
                href={`/chat/${avatar.id}`}
                className="mt-5 block rounded-xl bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-emerald-700"
              >
                开始对话
              </Link>
            </div>
          ))}
        </div>
      )}
    </FigmaShell>
  );
}
