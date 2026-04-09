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

  // If user doesn't exist in our database, show one-time OPC setup
  if (!dbUser) {
    return (
      <div className="min-h-screen bg-[#f5f7fb]">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <div className="mx-auto max-w-2xl">
            <div className="mb-12 text-center">
              <h1 className="mb-4 text-4xl font-bold text-slate-900">
                欢迎来到 OPC 平台
              </h1>
              <p className="text-xl text-slate-600">
                完成一次初始化后即可进入数字分身工作台
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <h2 className="mb-2 text-xl font-bold text-slate-900">开始使用 OPC + 数字分身</h2>
              <p className="mb-6 text-slate-600">系统将为你初始化统一工作台。</p>
              <Link
                href="/dashboard/setup"
                className="inline-flex rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                进入初始化
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
