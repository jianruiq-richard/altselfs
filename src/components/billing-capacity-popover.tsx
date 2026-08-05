'use client';

import { ArrowRight, CircleGauge, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MinacoCreditsIcon } from '@/components/minaco-credits-icon';
import { formatCredits, getBillingPlan } from '@/lib/billing-plans';
import {
  fetchWorkspaceJson,
  getWorkspaceCachedStale,
  WORKSPACE_CACHE_KEYS,
} from '@/lib/workspace-client-cache';

export type BillingCapacityData = {
  mode: 'observe' | 'enforce';
  account: {
    balanceCredits: number;
    reservedCredits: number;
    availableCredits: number;
    lifetimeGrantedCredits?: number;
    lifetimeSpentCredits?: number;
    lifetimeRefundedCredits?: number;
  };
  subscription: {
    planKey: string;
    planName: string;
    status?: string;
    monthlyCredits?: number;
    concurrentTaskLimit: number;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
    scheduledPlanKey?: string | null;
    graceEndsAt?: string | null;
    provider?: string | null;
    billingCycle?: 'monthly' | 'yearly' | null;
  };
  capacity: {
    activeTaskCount: number;
    availableTaskSlots: number;
    concurrencyHoldCredits: number;
    hasCreditAuthorization: boolean;
    canStartTask: boolean;
  };
};

type BillingCapacityPopoverProps = {
  data?: BillingCapacityData | null;
  loading?: boolean;
  variant?: 'compact' | 'rail';
};

export function BillingCapacityPopover({
  data,
  loading = false,
  variant = 'compact',
}: BillingCapacityPopoverProps) {
  const controlled = data !== undefined;
  const [internalData, setInternalData] = useState<BillingCapacityData | null>(
    () => getWorkspaceCachedStale<BillingCapacityData>(WORKSPACE_CACHE_KEYS.billingCapacity),
  );
  const [internalLoading, setInternalLoading] = useState(!controlled && !internalData);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const open = hoverOpen || focusOpen || pinnedOpen;

  const loadCapacity = useCallback(async (showLoading = false) => {
    if (showLoading) setInternalLoading(true);
    try {
      const payload = await fetchWorkspaceJson<BillingCapacityData>(
        WORKSPACE_CACHE_KEYS.billingCapacity,
        '/api/billing/capacity',
        {},
        { force: true, ttlMs: 30_000 },
      );
      setInternalData(payload);
    } catch {
      setInternalData(null);
    } finally {
      if (showLoading) setInternalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (controlled) return;
    void loadCapacity(!getWorkspaceCachedStale<BillingCapacityData>(WORKSPACE_CACHE_KEYS.billingCapacity));
  }, [controlled, loadCapacity]);

  useEffect(() => {
    if (controlled || !internalData || internalData.capacity.activeTaskCount <= 0) return;
    const interval = window.setInterval(() => {
      void loadCapacity();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [controlled, internalData, loadCapacity]);

  useEffect(() => {
    if (!pinnedOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPinnedOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setHoverOpen(false);
      setFocusOpen(false);
      setPinnedOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [pinnedOpen]);

  const capacity = controlled ? data : internalData;
  const isLoading = controlled ? loading : internalLoading;
  const plan = getBillingPlan(capacity?.subscription.planKey);
  const availableCredits = capacity?.account.availableCredits || 0;
  const activeTaskCount = capacity?.capacity.activeTaskCount || 0;
  const concurrentTaskLimit = capacity?.subscription.concurrentTaskLimit || plan.concurrentTasks;
  const availableTaskSlots = capacity?.capacity.availableTaskSlots || 0;
  const capacityBlocked = capacity ? !capacity.capacity.canStartTask : false;
  const rail = variant === 'rail';

  return (
    <div
      ref={rootRef}
      className={`relative z-40 ${rail ? 'h-full w-full' : 'shrink-0'}`}
      onPointerEnter={() => setHoverOpen(true)}
      onPointerLeave={() => setHoverOpen(false)}
      onFocusCapture={() => setFocusOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusOpen(false);
          setPinnedOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`grid items-center text-left outline-none transition-colors hover:bg-white/[0.025] focus-visible:bg-white/[0.035] ${
          rail
            ? 'h-16 w-full grid-cols-[minmax(0,1fr)_auto] gap-4 px-4'
            : 'h-9 min-w-[154px] grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-[7px] border border-white/[0.09] bg-white/[0.025] px-2.5'
        }`}
        aria-label="View credits and task capacity"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setPinnedOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`grid shrink-0 place-items-center rounded-[6px] border ${
              rail ? 'h-8 w-8' : 'h-6 w-6'
            } ${
              capacityBlocked
                ? 'border-amber-300/20 bg-amber-300/[0.06] text-amber-200'
                : 'border-[#f2c36b]/20 bg-[#f2c36b]/[0.065] text-[#f9d997]'
            }`}
          >
            {isLoading
              ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              : <MinacoCreditsIcon className="h-4 w-4" />}
          </span>
          <span className="grid min-w-0">
            <strong className={`${rail ? 'text-[13px]' : 'text-[11px]'} truncate tabular-nums text-zinc-100`}>
              {capacity ? formatCredits(availableCredits) : '—'}
            </strong>
            <span className={`${rail ? 'text-[9px]' : 'text-[8px]'} truncate text-zinc-600`}>credits available</span>
          </span>
        </span>
        <span className="grid justify-items-end">
          <strong className={`${rail ? 'text-[11px]' : 'text-[10px]'} tabular-nums text-zinc-300`}>
            {capacity ? `${activeTaskCount}/${concurrentTaskLimit}` : '—'}
          </strong>
          <span className={`${rail ? 'text-[9px]' : 'text-[8px]'} text-zinc-600`}>tasks active</span>
        </span>
      </button>

      <div
        role="dialog"
        aria-label="Credits and task capacity"
        className={`absolute z-50 transition duration-150 ${
          open
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-1 opacity-0'
        } ${
          rail
            ? 'right-3 top-[54px] w-[calc(100%-24px)] pt-2.5'
            : 'right-0 top-full w-[286px] pt-1.5'
        }`}
      >
        <div className="overflow-hidden rounded-[8px] border border-white/[0.13] bg-[#17181a] shadow-[0_24px_70px_rgba(0,0,0,.58)]">
          <div className="flex items-center justify-between gap-4 border-b border-white/[0.09] px-4 py-3.5">
            <span className="grid min-w-0">
              <span className="text-[9px] font-bold uppercase text-zinc-600">Current plan</span>
              <strong className="mt-0.5 truncate text-[15px] text-zinc-100">
                {capacity?.subscription.planName || plan.name}
              </strong>
            </span>
            <Link
              href="/pricing"
              className="inline-flex min-h-8 shrink-0 items-center rounded-[7px] bg-zinc-100 px-3 text-[10px] font-bold text-[#101113] hover:bg-white"
            >
              Upgrade
            </Link>
          </div>

          <div className="grid gap-0 px-4">
            <div className="grid min-h-[66px] grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-white/[0.08]">
              <MinacoCreditsIcon className="h-[18px] w-[18px]" />
              <span className="grid min-w-0">
                <strong className="text-[11px] text-zinc-200">Credits</strong>
                <span className="mt-0.5 truncate text-[9px] text-zinc-600">
                  {formatCredits(Math.max(0, capacity?.account.balanceCredits || 0))} balance
                </span>
              </span>
              <strong className="text-[12px] tabular-nums text-zinc-100">
                {capacity ? formatCredits(availableCredits) : '—'}
              </strong>
            </div>

            <div className="grid min-h-[66px] grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5">
              <CircleGauge className="h-4 w-4 text-[#46d19a]" />
              <span className="grid min-w-0">
                <strong className="text-[11px] text-zinc-200">Concurrent tasks</strong>
                <span className="mt-0.5 truncate text-[9px] text-zinc-600">
                  {availableTaskSlots} slot{availableTaskSlots === 1 ? '' : 's'} available
                </span>
              </span>
              <strong className="text-[12px] tabular-nums text-zinc-100">
                {capacity ? `${activeTaskCount} / ${concurrentTaskLimit}` : '—'}
              </strong>
            </div>
          </div>

          <Link
            href="/profile?view=plan"
            className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 border-t border-white/[0.09] text-[10px] font-semibold text-zinc-400 hover:bg-white/[0.04] hover:text-white"
          >
            View usage
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
