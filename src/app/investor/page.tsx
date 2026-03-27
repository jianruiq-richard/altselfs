import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export default async function InvestorDashboard() {
  const user = await currentUser();

  if (!user) {
    redirect('/sign-in');
  }

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id },
    include: {
      avatars: {
        include: {
          chats: true,
        },
      },
    },
  });

  if (!dbUser || dbUser.role !== 'INVESTOR') {
    redirect('/dashboard');
  }

  const totalChats = dbUser.avatars.reduce((acc, avatar) => acc + avatar.chats.length, 0);
  const qualifiedChats = dbUser.avatars.reduce(
    (acc, avatar) =>
      acc + avatar.chats.filter((chat) => chat.qualificationStatus === 'QUALIFIED' || chat.needsInvestorReview).length,
    0
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="bg-white/95 border-b border-slate-200 backdrop-blur">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">投资人控制台</h1>
            <p className="text-sm text-slate-600 mt-1">让分身先筛选，合格后你再介入</p>
          </div>
          <Link
            href="/investor/avatar/new"
            className="inline-flex items-center bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg border border-blue-700 hover:bg-blue-700 shadow-sm transition-colors"
          >
            创建新分身
          </Link>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-slate-500 text-sm">分身数量</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{dbUser.avatars.length}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-slate-500 text-sm">总会话数</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{totalChats}</p>
          </div>
          <div className="bg-white border border-emerald-200 rounded-xl p-4 shadow-sm">
            <p className="text-emerald-700 text-sm">待你介入</p>
            <p className="text-2xl font-bold text-emerald-800 mt-1">{qualifiedChats}</p>
          </div>
        </div>

        {dbUser.avatars.length === 0 ? (
          <div className="text-center py-16 bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-12 h-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">还没有数字分身</h2>
            <p className="text-slate-600 mb-8 max-w-md mx-auto">创建你的第一个数字分身，开始自动化项目筛选流程</p>
            <Link
              href="/investor/avatar/new"
              className="inline-flex items-center bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold border border-blue-700 hover:bg-blue-700 shadow-sm transition-colors"
            >
              创建数字分身
            </Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {dbUser.avatars.map((avatar) => {
              const pendingReviewCount = avatar.chats.filter(
                (chat) => chat.qualificationStatus === 'QUALIFIED' || chat.needsInvestorReview
              ).length;

              return (
                <div key={avatar.id} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow">
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
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{avatar.name}</h3>
                      <span
                        className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                          avatar.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {avatar.status === 'ACTIVE' ? '活跃' : '非活跃'}
                      </span>
                    </div>
                  </div>

                  {avatar.description && <p className="text-slate-600 mb-4 text-sm line-clamp-2">{avatar.description}</p>}

                  <div className="flex items-center justify-between text-sm text-slate-500 mb-3">
                    <span>{avatar.chats.length} 次对话</span>
                    <span>创建于 {new Date(avatar.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>

                  <p className="text-sm mb-4">
                    <span className="inline-flex items-center px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
                      待介入 {pendingReviewCount} 个
                    </span>
                  </p>

                  <div className="flex gap-2">
                    <Link
                      href={`/investor/avatar/${avatar.id}`}
                      className="flex-1 bg-blue-600 text-white font-semibold px-3 py-2 rounded-lg text-center border border-blue-700 hover:bg-blue-700 transition-colors text-sm shadow-sm"
                    >
                      管理
                    </Link>
                    <Link
                      href={`/investor/avatar/${avatar.id}/chats`}
                      className="flex-1 bg-white text-slate-800 font-medium px-3 py-2 rounded-lg text-center border border-slate-300 hover:bg-slate-100 transition-colors text-sm"
                    >
                      对话记录
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
