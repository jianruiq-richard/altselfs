import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { displayEmail } from '@/lib/user-identifier';
import { FigmaShell } from '@/components/figma-shell';

export default async function AvatarChatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  const avatar = await prisma.avatar.findFirst({
    where: {
      id,
      investor: {
        clerkId: userId,
        role: 'INVESTOR',
      },
    },
    relationLoadStrategy: 'join',
    select: {
      id: true,
      name: true,
      chats: {
        orderBy: {
          updatedAt: 'desc',
        },
        select: {
          id: true,
          title: true,
          status: true,
          summary: true,
          qualificationScore: true,
          qualificationStatus: true,
          qualificationReason: true,
          needsInvestorReview: true,
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
              createdAt: 'desc',
            },
            take: 6,
            select: {
              id: true,
              role: true,
              content: true,
              createdAt: true,
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
  });

  if (!avatar) {
    redirect('/dashboard');
  }

  return (
    <FigmaShell
      homeHref="/dashboard"
      title={`${avatar.name} · 对话记录`}
      subtitle={`共 ${avatar.chats.length} 个会话`}
      actions={
        <Link href="/dashboard" className="text-sm text-blue-700 hover:underline">
          返回工作台
        </Link>
      }
    >
      {avatar.chats.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <h2 className="text-2xl font-bold text-slate-900">还没有对话</h2>
          <p className="mt-2 text-slate-600">等待用户与你的分身开始对话。</p>
        </div>
      ) : (
        <div className="space-y-5">
          {avatar.chats.map((chat) => (
            <div key={chat.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {chat.title || `与 ${chat.candidate.nickname || chat.candidate.name || '匿名用户'} 的对话`}
                  </h3>
                  <p className="break-all text-sm text-gray-500">
                    {chat.candidate.nickname || chat.candidate.name || '匿名用户'} ({displayEmail(chat.candidate.email)})
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    电话：{chat.candidate.phone || '未填写'} · 微信：{chat.candidate.wechatId || '未填写'}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                    chat.status === 'ACTIVE'
                      ? 'bg-green-100 text-green-800'
                      : chat.status === 'COMPLETED'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800'
                  }`}>
                    {chat.status === 'ACTIVE' ? '进行中' : chat.status === 'COMPLETED' ? '已完成' : '已归档'}
                  </span>
                  <p className="text-sm text-gray-500 mt-1">{chat._count.messages} 条消息</p>
                </div>
              </div>

              {chat.summary && (
                <div className="bg-blue-50 rounded-lg p-4 mb-4">
                  <h4 className="text-sm font-medium text-blue-900 mb-2">对话总结</h4>
                  <p className="text-sm text-blue-800">{chat.summary}</p>
                </div>
              )}

              <div className="bg-slate-50 rounded-lg p-3 mb-4 border border-slate-200">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
                  {[...chat.messages].reverse().map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] px-4 py-2 rounded-lg text-sm sm:max-w-sm ${
                          message.role === 'user'
                            ? 'bg-blue-100 text-blue-900'
                            : 'bg-gray-100 text-gray-900'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">
                          {message.content.length > 100 ? `${message.content.substring(0, 100)}...` : message.content}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(message.createdAt).toLocaleString('zh-CN')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row">
                <Link
                  href={`/avatar/${avatar.id}/chat/${chat.id}`}
                  className="rounded-xl bg-blue-600 px-4 py-3 text-center text-sm text-white hover:bg-blue-700 sm:py-2"
                >
                  查看完整对话
                </Link>
                {chat.needsInvestorReview && (
                  <span className="rounded bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-700 sm:py-2">
                    建议你现在亲自介入
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </FigmaShell>
  );
}
