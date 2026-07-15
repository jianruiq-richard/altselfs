'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, Users, Settings, Sparkles, Briefcase, UserCircle, Mail, MessageSquare, LogOut } from 'lucide-react';
import { SignOutButton, useUser } from '@clerk/nextjs';
import { useEffect, useMemo, useState } from 'react';

type NavItem = {
  key: string;
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  activePrefixes?: string[];
};

function buildSignInRedirectUrl() {
  if (typeof window === 'undefined') return '/sign-in';
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const params = new URLSearchParams({ redirect_url: currentPath || '/dashboard' });
  return `/sign-in?${params.toString()}`;
}

export function FigmaShell({
  homeHref = '/dashboard',
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
  const router = useRouter();
  const { isLoaded, isSignedIn, user } = useUser();
  const [mobileUserMenuOpen, setMobileUserMenuOpen] = useState(false);

  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    router.replace(buildSignInRedirectUrl());
  }, [isLoaded, isSignedIn, router]);

  const navItems = useMemo<NavItem[]>(
    () => [
      { key: 'home', name: 'Workcontent', href: homeHref, icon: Home },
      { key: 'hall', name: 'Digital Twin Gallery', href: '/digital-twins', icon: Users, activePrefixes: ['/candidate', '/chat'] },
      { key: 'my-twin', name: 'My Digital Twin', href: '/avatar', icon: Sparkles, activePrefixes: ['/avatar'] },
      { key: 'talent', name: 'AI Talent Hub', href: '/ai-talent', icon: Briefcase },
      { key: 'accounts', name: 'Department Management', href: '/accounts', icon: UserCircle },
      { key: 'messages', name: 'content', href: '/messages', icon: Mail },
      {
        key: 'assistant',
        name: 'AIcontent',
        href: '/investor/chat/100',
        icon: MessageSquare,
        activePrefixes: ['/investor/info-ops', '/investor/chat'],
      },
      { key: 'settings', name: 'Settings', href: '/profile', icon: Settings },
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

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f6efe7] px-6 text-center text-stone-700">
        <div>
          <p className="text-base font-medium text-stone-950">{isLoaded ? 'Sign in' : 'sign in'}</p>
          <p className="mt-2 text-sm text-stone-500">{isLoaded ? 'sign in...' : 'content...'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6efe7] text-stone-950 md:flex md:h-screen md:overflow-hidden">
      <aside className="hidden h-full w-64 shrink-0 border-r border-[#e4d5c3] bg-[#fffaf3] md:block">
        <div className="flex h-full flex-col">
          <div className="border-b border-[#e4d5c3] px-6 py-6">
            <div>
              <h1 className="text-2xl font-bold text-stone-950">Altselfs</h1>
              <p className="mt-1 text-sm text-stone-500">Decision OS</p>
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
                    isActive ? 'bg-[#efe0ce] text-[#8a4d22]' : 'text-stone-700 hover:bg-[#f5eadc]'
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-[#e4d5c3] p-4">
            <Link href="/profile" className="block rounded-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#b77a3d] to-[#5b3725] text-xl font-semibold text-white">
                  {(user?.fullName || 'content').slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-gray-900">
                    {user?.fullName || 'content'}
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
                className="mt-2 flex w-full items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-[#f5eadc] hover:text-stone-950"
              >
                <LogOut className="h-4 w-4" />
                Sign outSign in
              </button>
            </SignOutButton>
          </div>
        </div>
      </aside>

      <div className="sticky top-0 z-20 border-b border-[#e4d5c3] bg-[#fffaf3]/95 backdrop-blur md:hidden">
        <div className="mx-auto flex w-full items-center justify-between gap-3 px-4 py-3 [padding-top:max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="text-lg font-bold text-stone-950">Altselfs</p>
            <p className="truncate text-xs text-stone-500">Decision OS</p>
          </div>
          <div className="relative min-w-0">
            <button
              type="button"
              onClick={() => setMobileUserMenuOpen((open) => !open)}
              aria-expanded={mobileUserMenuOpen}
              aria-haspopup="menu"
              className="flex min-w-0 items-center gap-3 rounded-xl border border-[#e4d5c3] bg-[#f6efe7] px-3 py-2 text-left"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#b77a3d] to-[#5b3725] text-sm font-semibold text-white">
                {(user?.fullName || 'content').slice(0, 1)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-stone-950">{user?.fullName || 'content'}</p>
                <p className="max-w-[8.5rem] truncate text-xs text-stone-500">{user?.primaryEmailAddress?.emailAddress || 'user@example.com'}</p>
              </div>
            </button>
            {mobileUserMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-44 overflow-hidden rounded-xl border border-[#e4d5c3] bg-[#fffaf3] py-1 shadow-[0_18px_45px_rgba(73,48,31,0.16)]"
              >
                <Link
                  href="/profile"
                  role="menuitem"
                  onClick={() => setMobileUserMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-stone-700 hover:bg-[#f5eadc] hover:text-stone-950"
                >
                  <UserCircle className="h-4 w-4" />
                  content
                </Link>
                <SignOutButton redirectUrl="/">
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-stone-700 hover:bg-[#f5eadc] hover:text-stone-950"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign outSign in
                  </button>
                </SignOutButton>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <main className="min-w-0 flex-1 md:overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-4 py-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 sm:pb-[calc(6rem+env(safe-area-inset-bottom))] lg:px-8 lg:py-8 lg:pb-8">
          {showPageHeader ? (
            <div className="mb-6 flex flex-col gap-3 sm:mb-8 md:flex-row md:items-start md:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{title}</h1>
                {subtitle ? <p className="mt-2 max-w-3xl text-sm text-gray-500 sm:text-base">{subtitle}</p> : null}
              </div>
              {actions ? <div className="shrink-0 self-start">{actions}</div> : null}
            </div>
          ) : null}
          {children}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#e4d5c3] bg-[#fffaf3]/95 backdrop-blur md:hidden">
        <div className="overflow-x-auto px-2 py-2 [padding-bottom:max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex min-w-max items-center gap-1">
            {navItems.map((item) => {
              const isActive = activeNavKey === item.key;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`flex min-w-[4.5rem] shrink-0 flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs transition-colors ${
                    isActive ? 'bg-[#efe0ce] text-[#8a4d22]' : 'text-stone-600 hover:bg-[#f5eadc]'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="whitespace-nowrap">{item.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
}
