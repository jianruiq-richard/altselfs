import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export default async function ChatDetailPage({
  params
}: {
  params: { id: string; chatId: string }
}) {
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

  // Get chat and verify ownership
  const chat = await prisma.chat.findUnique({
    where: { id: params.chatId },
    include: {
      avatar: true,
      candidate: {
        select: {
          name: true,
          email: true,
        },
      },
      messages: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  if (!chat || chat.avatar.investorId !== dbUser.id) {
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
                href={`/investor/avatar/${params.id}/chats`}
                className="text-blue-600 hover:underline text-sm mb-2 block"
              >
                ← 返回对话列表
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">
                {chat.title || `与 ${chat.candidate.name || '匿名用户'} 的对话`}
              </h1>
              <div className="flex items-center gap-4 text-sm text-gray-600 mt-1">
                <span>分身: {chat.avatar.name}</span>
                <span>用户: {chat.candidate.name || '匿名用户'}</span>
                <span>邮箱: {chat.candidate.email}</span>
                <span>消息: {chat.messages.length} 条</span>
              </div>
            </div>
            <div className="text-right">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium mb-2 ${
                chat.status === 'ACTIVE'
                  ? 'bg-green-100 text-green-800'
                  : chat.status === 'COMPLETED'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {chat.status === 'ACTIVE' ? '进行中' :
                 chat.status === 'COMPLETED' ? '已完成' : '已归档'}
              </span>
              <p className="text-sm text-gray-500">
                开始于 {new Date(chat.createdAt).toLocaleString('zh-CN')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Summary */}
      {chat.summary && (
        <div className="bg-blue-50 border-b">
          <div className="container mx-auto px-4 py-4">
            <h2 className="text-lg font-semibold text-blue-900 mb-2">对话总结</h2>
            <p className="text-blue-800">{chat.summary}</p>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {chat.messages.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">这个对话还没有消息</p>
            </div>
          ) : (
            <div className="space-y-6">
              {chat.messages.map((message, index) => (
                <div key={message.id} className="flex items-start gap-4">
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      message.role === 'user'
                        ? 'bg-green-100'
                        : 'bg-blue-100'
                    }`}>
                      {message.role === 'user' ? (
                        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      )}
                    </div>
                  </div>

                  {/* Message Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-gray-900">
                        {message.role === 'user'
                          ? chat.candidate.name || '创业者'
                          : chat.avatar.name
                        }
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(message.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                      <p className="text-gray-900 whitespace-pre-wrap">
                        {message.content}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="max-w-4xl mx-auto mt-8 pt-8 border-t">
          <div className="flex gap-4 justify-center">
            <button
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              onClick={() => {
                // TODO: Implement generate summary
                alert('生成对话总结功能开发中...');
              }}
            >
              生成对话总结
            </button>
            <button
              className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors"
              onClick={() => {
                // TODO: Implement contact candidate
                alert('联系创业者功能开发中...');
              }}
            >
              联系这位创业者
            </button>
            <button
              className="bg-gray-600 text-white px-6 py-2 rounded-lg hover:bg-gray-700 transition-colors"
              onClick={() => {
                // TODO: Implement export conversation
                alert('导出对话记录功能开发中...');
              }}
            >
              导出对话记录
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}