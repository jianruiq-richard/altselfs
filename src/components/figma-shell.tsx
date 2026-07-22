'use client';

import { AstromarWorkspaceShell } from '@/components/astromar-workspace-shell';

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
  return (
    <AstromarWorkspaceShell mobileTitle={title || 'Astromar'} homeHref={homeHref}>
      <div className="h-full min-h-0 overflow-y-auto bg-[#090a0a] text-zinc-100">
        <div className="mx-auto w-full max-w-7xl px-4 py-5 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8">
          {showPageHeader ? (
            <div className="mb-6 flex flex-col gap-3 border-b border-white/[0.09] pb-6 md:flex-row md:items-start md:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-zinc-50 sm:text-3xl">{title}</h1>
                {subtitle ? <p className="mt-2 max-w-3xl text-sm text-zinc-500 sm:text-base">{subtitle}</p> : null}
              </div>
              {actions ? <div className="shrink-0 self-start">{actions}</div> : null}
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </AstromarWorkspaceShell>
  );
}
