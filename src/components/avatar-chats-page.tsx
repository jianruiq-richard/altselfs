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
      title={`${avatar.name} · Conversation history`}
      subtitle={`${avatar.chats.length} conversations`}
      actions={
        <Link href="/dashboard" className="text-sm text-blue-700 hover:underline">
          Back to workspace
        </Link>
      }
    >
      {avatar.chats.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <h2 className="text-2xl font-bold text-slate-900">No conversations yet</h2>
          <p className="mt-2 text-slate-600">Share your digital twin to start a conversation.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {avatar.chats.map((chat) => (
            <div key={chat.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {chat.title || `Conversation with ${chat.candidate.nickname || chat.candidate.name || 'Anonymous user'}`}
                  </h3>
                  <p className="break-all text-sm text-gray-500">
                    {chat.candidate.nickname || chat.candidate.name || 'Anonymous user'} ({displayEmail(chat.candidate.email)})
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Phone: {chat.candidate.phone || 'Not provided'} · WeChat: {chat.candidate.wechatId || 'Not provided'}
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
                    {chat.status === 'ACTIVE' ? 'Active' : chat.status === 'COMPLETED' ? 'Completed' : 'Archived'}
                  </span>
                  <p className="text-sm text-gray-500 mt-1">{chat._count.messages} messages</p>
                </div>
              </div>

              {chat.summary && (
                <div className="bg-blue-50 rounded-lg p-4 mb-4">
                  <h4 className="text-sm font-medium text-blue-900 mb-2">Conversation summary</h4>
                  <p className="text-sm text-blue-800">{chat.summary}</p>
                </div>
              )}

              <div className="bg-slate-50 rounded-lg p-3 mb-4 border border-slate-200">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-700">
                    AI qualification score: <span className="font-semibold">{chat.qualificationScore}</span>
                  </p>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    chat.qualificationStatus === 'QUALIFIED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : chat.qualificationStatus === 'REJECTED'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                  }`}>
                    {chat.qualificationStatus === 'QUALIFIED'
                      ? 'Qualified'
                      : chat.qualificationStatus === 'REJECTED'
                        ? 'Not recommended'
                        : 'Needs more information'}
                  </span>
                </div>
                {chat.qualificationReason && (
                  <p className="text-sm text-slate-600 mt-2">{chat.qualificationReason}</p>
                )}
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-gray-900 mb-3">Recent messages</h4>
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
                          {new Date(message.createdAt).toLocaleString('en-US')}
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
                  View full conversation
                </Link>
                {chat.needsInvestorReview && (
                  <span className="rounded bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-700 sm:py-2">
                    Recommended: step in personally now
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
