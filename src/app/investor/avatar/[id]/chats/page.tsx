import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export default async function AvatarChatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();

  if (!user) {
    redirect('/sign-in');
  }

  // Get user data from our database
  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id },
  });

  if (!dbUser || dbUser.role !== 'INVESTOR') {
    redirect('/dashboard');
  }

  // Get avatar and verify ownership
  const avatar = await prisma.avatar.findUnique({
    where: { id },
    include: {
      chats: {
        include: {
          candidate: {
            select: {
              id: true,
              nickname: true,
              name: true,
              email: true,
              phone: true,
              wechatId: true,
            },
          },
          messages: {
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
      },
    },
  });

  if (!avatar || avatar.investorId !== dbUser.id) {
    redirect('/investor');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link
                href="/investor"
                className="text-blue-600 hover:underline text-sm mb-2 block"
              >
                ← 返回控制台
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">
                {avatar.name} - 对话记录
              </h1>
              <p className="text-gray-600">共 {avatar.chats.length} 个对话会话</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {avatar.chats.length === 0 ? (
          // No chats state
          <div className="text-center py-16">
            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              还没有对话
            </h2>
            <p className="text-gray-600">
              等待创业者与你的分身开始对话
            </p>
          </div>
        ) : (
          // Chats list
          <div className="space-y-6">
            {avatar.chats.map((chat) => (
              <div key={chat.id} className="bg-white rounded-lg shadow-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {chat.title || `与 ${chat.candidate.nickname || chat.candidate.name || '匿名用户'} 的对话`}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {chat.candidate.nickname || chat.candidate.name || '匿名用户'} ({chat.candidate.email})
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      电话：{chat.candidate.phone || '未填写'} · 微信：{chat.candidate.wechatId || '未填写'}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                      chat.status === 'ACTIVE'
                        ? 'bg-green-100 text-green-800'
                        : chat.status === 'COMPLETED'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {chat.status === 'ACTIVE' ? '进行中' :
                       chat.status === 'COMPLETED' ? '已完成' : '已归档'}
                    </span>
                    <p className="text-sm text-gray-500 mt-1">
                      {chat.messages.length} 条消息
                    </p>
                  </div>
                </div>

                {chat.summary && (
                  <div className="bg-blue-50 rounded-lg p-4 mb-4">
                    <h4 className="text-sm font-medium text-blue-900 mb-2">对话总结</h4>
                    <p className="text-sm text-blue-800">{chat.summary}</p>
                  </div>
                )}

                <div className="bg-slate-50 rounded-lg p-3 mb-4 border border-slate-200">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-700">
                      AI评估分数: <span className="font-semibold">{chat.qualificationScore}</span>
                    </p>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      chat.qualificationStatus === 'QUALIFIED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : chat.qualificationStatus === 'REJECTED'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {chat.qualificationStatus === 'QUALIFIED'
                        ? '已达标'
                        : chat.qualificationStatus === 'REJECTED'
                        ? '不建议'
                        : '待补充'}
                    </span>
                  </div>
                  {chat.qualificationReason && (
                    <p className="text-sm text-slate-600 mt-2">{chat.qualificationReason}</p>
                  )}
                </div>

                <div className="border-t pt-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-3">最近的对话</h4>
                  <div className="space-y-3 max-h-60 overflow-y-auto">
                    {chat.messages.slice(-6).map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-sm px-4 py-2 rounded-lg text-sm ${
                            message.role === 'user'
                              ? 'bg-blue-100 text-blue-900'
                              : 'bg-gray-100 text-gray-900'
                          }`}
                        >
                          <p className="whitespace-pre-wrap">
                            {message.content.length > 100
                              ? message.content.substring(0, 100) + '...'
                              : message.content}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(message.createdAt).toLocaleString('zh-CN')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 mt-4 pt-4 border-t">
                  <Link
                    href={`/investor/avatar/${avatar.id}/chat/${chat.id}`}
                    className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 transition-colors"
                  >
                    查看完整对话
                  </Link>
                  {chat.needsInvestorReview && (
                    <span className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded text-sm">
                      建议你现在亲自介入
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
