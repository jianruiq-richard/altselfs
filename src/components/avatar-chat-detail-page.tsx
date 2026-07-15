import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { displayEmail, isFallbackEmail } from '@/lib/user-identifier';
import { FigmaShell } from '@/components/figma-shell';
import { MarkdownMessage } from '@/components/markdown-message';

export default async function AvatarChatDetailPage({
  params,
}: {
  params: Promise<{ id: string; chatId: string }>;
}) {
  const { id, chatId } = await params;
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      avatarId: id,
      avatar: {
        investor: {
          clerkId: userId,
          role: 'INVESTOR',
        },
      },
    },
    relationLoadStrategy: 'join',
    select: {
      id: true,
      title: true,
      summary: true,
      qualificationScore: true,
      qualificationStatus: true,
      qualificationReason: true,
      needsInvestorReview: true,
      avatar: {
        select: {
          name: true,
        },
      },
      candidate: {
        select: {
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
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });

  if (!chat) {
    redirect('/dashboard');
  }

  return (
    <FigmaShell
      homeHref="/dashboard"
      title={chat.title || `Conversation with ${chat.candidate.nickname || chat.candidate.name || 'Anonymous user'}`}
      subtitle={`Twin: ${chat.avatar.name} · Visitor: ${chat.candidate.nickname || chat.candidate.name || 'Anonymous user'} · Messages: ${chat.messages.length}`}
      actions={
        <Link href={`/avatar/${id}/chats`} className="text-sm text-blue-700 hover:underline">
          Back to conversations
        </Link>
      }
    >
      {chat.summary ? (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="mb-2 text-lg font-semibold text-blue-900">Conversation summary</h2>
          <p className="text-blue-800">{chat.summary}</p>
        </div>
      ) : null}

      <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="max-w-4xl">
          <div className="flex flex-wrap items-center gap-2 text-sm sm:gap-3">
            <span className="text-slate-600">
              AI score: <span className="font-semibold text-slate-900">{chat.qualificationScore}</span>
            </span>
            <span className={`inline-flex px-2 py-1 rounded-full ${
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
            {chat.needsInvestorReview && (
              <span className="text-emerald-700 font-medium">Review recommended</span>
            )}
          </div>
          {chat.qualificationReason && (
            <p className="text-sm text-slate-600 mt-1">{chat.qualificationReason}</p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Email: {displayEmail(chat.candidate.email)} · Phone: {chat.candidate.phone || 'Not provided'} · WeChat: {chat.candidate.wechatId || 'Not provided'}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mx-auto max-w-4xl">
          {chat.messages.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No messages in this conversation yet.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {chat.messages.map((message) => (
                <div key={message.id} className="flex items-start gap-3 sm:gap-4">
                  <div className="flex-shrink-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      message.role === 'user' ? 'bg-green-100' : 'bg-blue-100'
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

                  <div className="flex-1 min-w-0">
                    <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                      <span className="font-semibold text-gray-900">
                        {message.role === 'user' ? chat.candidate.nickname || chat.candidate.name || 'Anonymous user' : chat.avatar.name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(message.createdAt).toLocaleString('en-US')}
                      </span>
                    </div>
                    <div className="bg-white rounded-lg p-4 text-gray-900 shadow-sm">
                      <MarkdownMessage content={message.content} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mx-auto mt-8 max-w-4xl border-t pt-8">
          <div className="flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
            {chat.candidate.email && !isFallbackEmail(chat.candidate.email) ? (
              <Link
                href={`mailto:${chat.candidate.email}?subject=${encodeURIComponent(`Follow-up: ${chat.title || chat.avatar.name}`)}`}
                className="rounded-xl bg-green-600 px-6 py-3 text-center text-white hover:bg-green-700 sm:py-2"
              >
                Email candidate
              </Link>
            ) : (
              <span className="rounded-lg bg-slate-100 px-6 py-3 text-center text-slate-600 sm:py-2">
                Email unavailable
              </span>
            )}
          </div>
        </div>
      </div>
    </FigmaShell>
  );
}
