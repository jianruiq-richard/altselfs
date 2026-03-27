import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export default async function InvestorDashboard() {
  const user = await currentUser();

  if (!user) {
    redirect('/sign-in');
  }

  // Get user data from our database
  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id },
    include: {
      avatars: {
        include: {
          chats: {
            include: {
              candidate: true,
            }
          }
        }
      }
    }
  });

  if (!dbUser || dbUser.role !== 'INVESTOR') {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">投资人控制台</h1>
          <Link
            href="/investor/avatar/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            创建新分身
          </Link>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {dbUser.avatars.length === 0 ? (
          // No avatars state
          <div className="text-center py-16">
            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              还没有数字分身
            </h2>
            <p className="text-gray-600 mb-8 max-w-md mx-auto">
              创建你的第一个数字分身，开始自动化项目筛选流程
            </p>
            <Link
              href="/investor/avatar/new"
              className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              创建数字分身
            </Link>
          </div>
        ) : (
          // Avatars grid
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {dbUser.avatars.map((avatar) => (
              <div key={avatar.id} className="bg-white rounded-lg shadow-lg p-6">
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
                    <h3 className="text-lg font-semibold text-gray-900">{avatar.name}</h3>
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                      avatar.status === 'ACTIVE'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {avatar.status === 'ACTIVE' ? '活跃' : '非活跃'}
                    </span>
                  </div>
                </div>

                {avatar.description && (
                  <p className="text-gray-600 mb-4 text-sm line-clamp-2">
                    {avatar.description}
                  </p>
                )}

                <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
                  <span>{avatar.chats.length} 次对话</span>
                  <span>创建于 {new Date(avatar.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>

                <div className="flex gap-2">
                  <Link
                    href={`/investor/avatar/${avatar.id}`}
                    className="flex-1 bg-blue-600 text-white px-3 py-2 rounded text-center hover:bg-blue-700 transition-colors text-sm"
                  >
                    管理
                  </Link>
                  <Link
                    href={`/investor/avatar/${avatar.id}/chats`}
                    className="flex-1 bg-gray-600 text-white px-3 py-2 rounded text-center hover:bg-gray-700 transition-colors text-sm"
                  >
                    对话记录
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}