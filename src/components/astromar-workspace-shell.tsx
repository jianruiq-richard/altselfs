'use client';

import { SignOutButton, useUser } from '@clerk/nextjs';
import {
  ChevronRight,
  Home,
  LogOut,
  Menu,
  MessagesSquare,
  PanelLeftClose,
  BadgeDollarSign,
  Plug,
  Settings,
  SquarePen,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

type WorkspaceNavKey = 'home' | 'discussion' | 'connectors' | 'pricing' | 'settings';

type AstromarWorkspaceShellProps = {
  children: React.ReactNode;
  mobileTitle: string;
  sidebarContent?: React.ReactNode;
  rightRail?: React.ReactNode;
  onNewDiscussion?: () => void;
  newDiscussionBusy?: boolean;
  newDiscussionDisabled?: boolean;
  homeHref?: string;
};

const navItems = [
  { key: 'home' as const, name: 'Home', href: '/dashboard', icon: Home },
  { key: 'discussion' as const, name: 'Discussion', href: '/investor/chat/100', icon: MessagesSquare },
  { key: 'connectors' as const, name: 'Connectors', href: '/connectors', icon: Plug },
  { key: 'pricing' as const, name: 'Pricing', href: '/pricing', icon: BadgeDollarSign },
  { key: 'settings' as const, name: 'Settings', href: '/profile', icon: Settings },
];

function buildSignInRedirectUrl() {
  if (typeof window === 'undefined') return '/sign-in';
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `/sign-in?${new URLSearchParams({ redirect_url: currentPath || '/dashboard' }).toString()}`;
}

function activeNavKey(pathname: string): WorkspaceNavKey {
  if (pathname.startsWith('/investor/chat')) return 'discussion';
  if (pathname.startsWith('/connectors')) return 'connectors';
  if (pathname.startsWith('/pricing')) return 'pricing';
  if (pathname.startsWith('/profile')) return 'settings';
  return 'home';
}

export function AstromarWorkspaceShell({
  children,
  mobileTitle,
  sidebarContent,
  rightRail,
  onNewDiscussion,
  newDiscussionBusy = false,
  newDiscussionDisabled = false,
  homeHref = '/dashboard',
}: AstromarWorkspaceShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded, isSignedIn, user } = useUser();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const activeKey = useMemo(() => activeNavKey(pathname), [pathname]);

  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    router.replace(buildSignInRedirectUrl());
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#090a0a] px-6 text-center text-zinc-400">
        <div>
          <p className="text-base font-semibold text-zinc-100">{isLoaded ? 'Session expired' : 'Checking your session'}</p>
          <p className="mt-2 text-sm text-zinc-500">{isLoaded ? 'Redirecting to sign in...' : 'Please wait...'}</p>
        </div>
      </div>
    );
  }

  const displayName = user.fullName || user.firstName || 'User';
  const email = user.primaryEmailAddress?.emailAddress || 'Account';
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join('') || 'U';

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col bg-[#0c0d0e] text-zinc-100">
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        <Link href={homeHref} className="inline-flex items-center gap-2.5 font-semibold text-zinc-50">
          <span className="grid h-8 w-8 place-items-center rounded-[7px] border border-white/15 bg-[linear-gradient(145deg,rgba(255,255,255,.16),rgba(255,255,255,.025))] shadow-[inset_0_1px_0_rgba(255,255,255,.16)]">
            <span className="h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_16px_rgba(255,255,255,.62)]" />
          </span>
          <span className="text-[15px]">Astromar</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(false)}
          className="grid h-8 w-8 place-items-center rounded-[7px] text-zinc-500 hover:bg-white/5 hover:text-zinc-100 md:hidden"
          title="Close sidebar"
        >
          <X className="h-4 w-4" />
        </button>
        <PanelLeftClose className="hidden h-4 w-4 text-zinc-600 md:block" />
      </div>

      {onNewDiscussion ? (
        <button
          type="button"
          onClick={() => {
            setMobileSidebarOpen(false);
            onNewDiscussion();
          }}
          disabled={newDiscussionBusy || newDiscussionDisabled}
          className="mx-3 mb-3 inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[7px] border border-white/80 bg-[#f2f2f0] px-4 text-[13px] font-bold text-[#0b0b0b] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <SquarePen className="h-4 w-4" />
          {newDiscussionBusy ? 'Creating...' : 'New discussion'}
        </button>
      ) : (
        <Link
          href="/investor/chat/100"
          onClick={() => setMobileSidebarOpen(false)}
          className="mx-3 mb-3 inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[7px] border border-white/80 bg-[#f2f2f0] px-4 text-[13px] font-bold text-[#0b0b0b] hover:bg-white"
        >
          <SquarePen className="h-4 w-4" />
          New discussion
        </Link>
      )}

      <nav className="grid shrink-0 gap-0.5 border-b border-white/[0.09] px-2.5 pb-3" aria-label="Workspace navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.key === activeKey;
          return (
            <Link
              key={item.key}
              href={item.key === 'home' ? homeHref : item.href}
              onClick={() => setMobileSidebarOpen(false)}
              className={`flex min-h-[38px] items-center gap-2.5 rounded-[7px] px-3 text-[13px] transition-colors ${
                active ? 'bg-white/[0.085] text-white' : 'text-zinc-400 hover:bg-white/[0.045] hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="astromar-scrollbar astromar-scrollbar-stable min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">{sidebarContent}</div>

      <div className="shrink-0 border-t border-white/[0.09] bg-[#0c0d0e] p-3">
        <Link
          href="/profile"
          className="grid min-h-[58px] grid-cols-[38px_minmax(0,1fr)_18px] items-center gap-2.5 rounded-[7px] border border-white/[0.09] bg-white/[0.025] p-2 text-left hover:border-white/15 hover:bg-white/[0.05]"
        >
          <span className="grid h-[38px] w-[38px] place-items-center rounded-[7px] bg-[#d9dce1] text-[11px] font-extrabold text-[#161616]">{initials}</span>
          <span className="grid min-w-0">
            <strong className="truncate text-xs text-white">{displayName}</strong>
            <span className="truncate text-[10px] text-zinc-500">{email}</span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
        </Link>
        <SignOutButton redirectUrl="/">
          <button
            type="button"
            className="mt-1.5 flex min-h-9 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[11px] font-semibold text-zinc-400 hover:bg-red-400/[0.065] hover:text-red-300"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </SignOutButton>
      </div>
    </div>
  );

  return (
    <div
      className={`agent-activity-text grid h-dvh min-h-0 min-w-0 grid-cols-1 overflow-hidden bg-[#090a0a] text-zinc-100 md:grid-cols-[244px_minmax(0,1fr)] ${
        rightRail ? 'xl:grid-cols-[244px_minmax(0,1fr)_304px]' : ''
      }`}
    >
      <aside className="hidden min-h-0 border-r border-white/[0.09] md:block">{sidebar}</aside>

      {mobileSidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/65 md:hidden"
          aria-label="Close sidebar"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[244px] border-r border-white/[0.09] transition-transform md:hidden ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebar}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#090a0a]">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.09] px-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-[7px] text-zinc-400 hover:bg-white/5 hover:text-white"
            title="Open sidebar"
          >
            <Menu className="h-4 w-4" />
          </button>
          <strong className="truncate text-sm text-zinc-100">{mobileTitle}</strong>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
      </section>

      {rightRail ? (
        <aside className="hidden min-h-0 min-w-0 overflow-hidden border-l border-white/[0.09] bg-[#0c0d0e] xl:block">
          {rightRail}
        </aside>
      ) : null}
    </div>
  );
}
