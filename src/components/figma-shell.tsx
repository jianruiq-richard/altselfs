'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users, Settings, Sparkles, Briefcase, UserCircle, Mail, MessageSquare } from 'lucide-react';
import { UserButton, useUser } from '@clerk/nextjs';
import { useMemo } from 'react';

type NavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  matchPrefixes?: string[];
};

export function FigmaShell({
  homeHref = '/investor',
  title,
  subtitle,
  actions,
  children,
}: {
  homeHref?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user } = useUser();

  const navItems = useMemo<NavItem[]>(
    () => [
      { name: '工作台', href: homeHref, icon: Home, matchPrefixes: ['/investor/avatar'] },
      { name: '数字分身大厅', href: '/candidate', icon: Users, matchPrefixes: ['/chat'] },
      { name: '我的数字分身', href: '/investor/avatar/new', icon: Sparkles },
      { name: 'AI人才大厅', href: '/ai-talent', icon: Briefcase },
      { name: '部门管理', href: '/accounts', icon: UserCircle },
      { name: '信息中心', href: '/messages', icon: Mail },
      { name: 'AI助手', href: '/messages', icon: MessageSquare },
      { name: '设置', href: '/profile', icon: Settings },
    ],
    [homeHref]
  );

  return (
    <div className="flex min-h-screen bg-gray-50 text-slate-900">
      <aside className="w-64 border-r border-gray-200 bg-white">
        <div className="flex h-full flex-col">
          <div className="border-b border-gray-200 px-6 py-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">OPC平台</h1>
              <p className="mt-1 text-sm text-gray-500">AI员工管理系统</p>
            </div>
          </div>

          <nav className="flex-1 space-y-1 p-4">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.matchPrefixes ? item.matchPrefixes.some((p) => pathname.startsWith(p)) : false) ||
                (item.href !== '/' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="text-[17px]">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-gray-200 p-4">
            <Link href="/profile" className="block rounded-lg px-4 py-3 transition-colors hover:bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white">
                  <span className="text-sm font-semibold">{(user?.fullName || '用').slice(0, 1)}</span>
                  <span className="absolute -right-1 -bottom-1">
                    <UserButton />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">{user?.fullName || '用户名'}</p>
                  <p className="truncate text-sm text-gray-500">{user?.primaryEmailAddress?.emailAddress || 'user@example.com'}</p>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-7xl p-8">
          <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
              {subtitle ? <p className="mt-2 text-gray-500">{subtitle}</p> : null}
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
