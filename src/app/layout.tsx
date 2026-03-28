import type { Metadata } from "next";
import { ClerkProvider } from '@clerk/nextjs';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import AuthStatus from '@/components/auth-status';
import "./globals.css";

export const metadata: Metadata = {
  title: "AltSelfs - 投资人数字分身平台",
  description: "为投资人和FA提供数字分身服务，提高项目筛选效率",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await currentUser();
  let roleLabel = '身份待确认';
  let displayName = user?.fullName || '已登录用户';

  if (user) {
    const dbUser = await prisma.user.findUnique({
      where: { clerkId: user.id },
      select: { role: true, nickname: true },
    });
    if (dbUser?.role === 'INVESTOR') {
      roleLabel = '投资人';
    } else if (dbUser?.role === 'CANDIDATE') {
      roleLabel = '创业者';
    }
    if (dbUser?.nickname?.trim()) {
      displayName = dbUser.nickname;
    }
  }

  return (
    <ClerkProvider>
      <html lang="zh-CN" className="h-full antialiased">
        <body className="min-h-full flex flex-col">
          <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
            <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
              <Link href="/" className="text-slate-900 font-semibold tracking-tight">
                AltSelfs
              </Link>
              {user ? (
                <AuthStatus
                  imageUrl={user.imageUrl}
                  displayName={displayName}
                  roleLabel={roleLabel}
                />
              ) : (
                <Link
                  href="/sign-in"
                  className="bg-sky-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-sky-700 transition-colors shadow-sm"
                >
                  登录
                </Link>
              )}
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
