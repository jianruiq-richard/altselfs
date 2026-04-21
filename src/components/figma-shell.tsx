'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users, Settings, Sparkles, Briefcase, UserCircle, Mail, MessageSquare, LogOut } from 'lucide-react';
import { SignOutButton, useUser } from '@clerk/nextjs';
import { useMemo } from 'react';

type NavItem = {
  key: string;
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  activePrefixes?: string[];
};

export function FigmaShell({
  homeHref = '/investor',
  title,
  subtitle,
  actions,
  showPageHeader = true,
  children,
}: {
  homeHref?: string;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  showPageHeader?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user } = useUser();

  const navItems = useMemo<NavItem[]>(
    () => [
      { key: 'home', name: '工作台', href: homeHref, icon: Home },
      { key: 'hall', name: '数字分身大厅', href: '/digital-twins', icon: Users, activePrefixes: ['/candidate', '/chat'] },
      { key: 'my-twin', name: '我的数字分身', href: '/investor/avatar/new', icon: Sparkles, activePrefixes: ['/investor/avatar'] },
      { key: 'talent', name: 'AI人才大厅', href: '/ai-talent', icon: Briefcase },
      { key: 'accounts', name: '部门管理', href: '/accounts', icon: UserCircle },
      { key: 'messages', name: '信息中心', href: '/messages', icon: Mail },
      {
        key: 'assistant',
        name: 'AI助手',
        href: '/investor/chat/100',
        icon: MessageSquare,
        activePrefixes: ['/investor/info-ops', '/investor/chat'],
      },
      { key: 'settings', name: '设置', href: '/profile', icon: Settings },
    ],
    [homeHref]
  );

  const activeNavKey = useMemo(() => {
    const scoreFor = (item: NavItem) => {
      if (pathname === item.href) return item.href.length + 10_000;
      if (item.activePrefixes?.some((prefix) => pathname.startsWith(prefix))) {
        const longestPrefix = Math.max(...item.activePrefixes.map((prefix) => (pathname.startsWith(prefix) ? prefix.length : 0)));
        return longestPrefix + 5_000;
      }
      if (item.href !== '/' && pathname.startsWith(item.href)) return item.href.length;
      return -1;
    };

    let winner: { key: string; score: number } | null = null;
    for (const item of navItems) {
      const score = scoreFor(item);
      if (score < 0) continue;
      if (!winner || score > winner.score) {
        winner = { key: item.key, score };
      }
    }
    return winner?.key || null;
  }, [navItems, pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 text-slate-900">
      <aside className="h-full w-64 shrink-0 border-r border-gray-200 bg-white">
        <div className="flex h-full flex-col">
          <div className="border-b border-gray-200 px-6 py-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">OPC平台</h1>
              <p className="mt-1 text-sm text-gray-500">AI员工管理系统</p>
            </div>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto p-4">
            {navItems.map((item) => {
              const isActive = activeNavKey === item.key;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-gray-200 p-4">
            <Link href="/profile" className="block rounded-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-xl font-semibold text-white">
                  {(user?.fullName || '用').slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-gray-900">
                    {user?.fullName || '用户名'}
                  </p>
                  <p className="truncate text-sm text-gray-500">
                    {user?.primaryEmailAddress?.emailAddress || 'user@example.com'}
                  </p>
                </div>
              </div>
            </Link>
            <SignOutButton redirectUrl="/">
              <button
                type="button"
                className="mt-2 flex w-full items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </SignOutButton>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl p-8">
          {showPageHeader ? (
            <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
                {subtitle ? <p className="mt-2 text-gray-500">{subtitle}</p> : null}
              </div>
              {actions ? <div className="shrink-0">{actions}</div> : null}
            </div>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
