import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export default async function Dashboard() {
  const user = await currentUser();

  if (!user) {
    redirect('/sign-in');
  }

  // Check if user exists in our database
  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id }
  });

  // If user doesn't exist in our database, we need to show role selection
  if (!dbUser) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-12">
              <h1 className="text-4xl font-bold text-gray-900 mb-4">
                欢迎来到 AltSelfs！
              </h1>
              <p className="text-xl text-gray-600">
                请选择你的身份来完成账户设置
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <Link
                href="/dashboard/setup?role=investor"
                className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow duration-200 text-center"
              >
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">我是投资人</h2>
                <p className="text-gray-600">创建数字分身，筛选投资项目</p>
              </Link>

              <Link
                href="/dashboard/setup?role=candidate"
                className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow duration-200 text-center"
              >
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">我是创业者</h2>
                <p className="text-gray-600">与投资人分身对话，完善项目</p>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Redirect based on user role
  if (dbUser.role === 'INVESTOR') {
    redirect('/investor');
  } else {
    redirect('/candidate');
  }
}
