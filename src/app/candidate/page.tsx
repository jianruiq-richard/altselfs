import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export default async function CandidateDashboard() {
  const user = await currentUser();

  if (!user) {
    redirect('/sign-in');
  }

  // Get user data from our database
  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id },
    include: {
      chatsAsCandidate: {
        where: {
          status: 'ACTIVE',
        },
        include: {
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

  // Get all active avatars
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
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-slate-900">投资人分身广场</h1>
          <p className="text-slate-600 mt-1">先与分身打磨方案，达标后再进入人工沟通</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {dbUser.chatsAsCandidate.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-semibold text-slate-900 mb-4">正在聊的会话</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {dbUser.chatsAsCandidate.map((chat) => (
                <div key={chat.id} className="bg-white border border-slate-200 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">{chat.avatar.name}</h3>
                      <p className="text-sm text-slate-500">来自 {chat.avatar.investor.name || '匿名投资人'}</p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700">
                      进行中
                    </span>
                  </div>

                  {chat.messages[0]?.content && (
                    <p className="text-sm text-slate-600 line-clamp-2 mb-3">
                      最近消息：{chat.messages[0].content}
                    </p>
                  )}

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500">
                      更新于 {new Date(chat.updatedAt).toLocaleString('zh-CN')}
                    </p>
                    <Link
                      href={`/chat/${chat.avatar.id}`}
                      className="text-sm font-medium text-blue-700 hover:underline"
                    >
                      继续对话
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {avatars.length === 0 ? (
          // No avatars state
          <div className="text-center py-16">
            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">
              暂无可用的投资人分身
            </h2>
            <p className="text-slate-600">
              请稍后再来查看，投资人们正在创建他们的数字分身
            </p>
          </div>
        ) : (
          // Avatars grid
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {avatars.map((avatar) => (
              <div key={avatar.id} className="bg-white rounded-lg border border-slate-200 p-6 hover:shadow-lg transition-shadow duration-200">
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mr-4">
                    {avatar.avatar ? (
                      <img
                        src={avatar.avatar}
                        alt={avatar.name}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-slate-900">{avatar.name}</h3>
                    <p className="text-sm text-slate-500">
                      来自 {avatar.investor.name || '匿名投资人'}
                    </p>
                  </div>
                </div>

                {avatar.description && (
                  <p className="text-slate-600 mb-4 text-sm line-clamp-3">
                    {avatar.description}
                  </p>
                )}

                <div className="flex items-center justify-between text-sm text-slate-500 mb-4">
                  <span>{avatar._count.chats} 次对话</span>
                  <span>创建于 {new Date(avatar.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>

                <Link
                  href={`/chat/${avatar.id}`}
                  className="w-full bg-green-600 text-white px-4 py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors text-center block"
                >
                  开始对话
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
