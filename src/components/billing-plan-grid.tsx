'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  CircleGauge,
  LoaderCircle,
  MessageCircle,
  Search,
  Sparkles,
  Telescope,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { productBrand } from '@/lib/brand';
import {
  BILLING_PLANS,
  type BillingCycle,
  type BillingPlan,
  type BillingPlanKey,
  estimatePlanWorkload,
  formatCredits,
  getPlanBillingCredits,
  getPlanBillingPriceUsd,
} from '@/lib/billing-plans';

export type BillingPlanCatalog = {
  configured?: boolean;
  plans?: Partial<Record<BillingPlanKey, {
    priceId?: string | null;
    monthlyPriceId?: string | null;
    yearlyPriceId?: string | null;
  }>>;
};

type BillingPlanGridProps = {
  variant: 'public' | 'account';
  className?: string;
  catalog?: BillingPlanCatalog | null;
  currentPlanKey?: string | null;
  currentBillingCycle?: string | null;
  cancelAtPeriodEnd?: boolean;
  billingAction?: string | null;
  getStartedHref?: string;
  showIntro?: boolean;
  onChoosePlan?: (planKey: BillingPlanKey, billingCycle: BillingCycle) => void;
  onOpenPortal?: () => void;
  onCancelSubscription?: () => void;
};

const billingCycles: Array<{ key: BillingCycle; label: string }> = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
];

export function BillingPlanGrid({
  variant,
  className = '',
  catalog,
  currentPlanKey,
  currentBillingCycle,
  cancelAtPeriodEnd = false,
  billingAction,
  getStartedHref = '/sign-in?method=email&redirect_url=/investor/chat/100',
  showIntro = true,
  onChoosePlan,
  onOpenPortal,
  onCancelSubscription,
}: BillingPlanGridProps) {
  const normalizedCurrentPlanKey = normalizePlanKey(currentPlanKey);
  const normalizedCurrentBillingCycle = normalizeBillingCycle(currentBillingCycle);
  const [billingCycle, setBillingCycle] = useBillingCycle(normalizedCurrentBillingCycle);
  const currentPlanIndex = BILLING_PLANS.findIndex((plan) => plan.key === normalizedCurrentPlanKey);

  useEffect(() => {
    if (variant === 'account' && normalizedCurrentBillingCycle) {
      setBillingCycle(normalizedCurrentBillingCycle);
    }
  }, [normalizedCurrentBillingCycle, setBillingCycle, variant]);

  return (
    <section className={className} aria-label="Available plans">
      <div className="mb-6 flex flex-col justify-between gap-5 md:flex-row md:items-end">
        {showIntro ? (
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#8eb3ff]">
              Pricing
            </span>
            <h2 className="mt-2 max-w-[620px] text-[28px] font-bold leading-tight text-zinc-100 md:text-[34px]">
              Plans built around actual agent work.
            </h2>
            <p className="mt-3 max-w-[680px] text-[12px] leading-6 text-zinc-500">
              Credits measure actual agent work and never expire. Annual billing keeps the same workspace limits,
              grants the full year of Credits up front, and gives 20% off the equivalent monthly subscription.
            </p>
          </div>
        ) : (
          <div className="hidden md:block" aria-hidden="true" />
        )}

        <div className="grid justify-start gap-2 md:justify-end">
          <div
            className="relative grid min-w-[260px] grid-cols-2 gap-1 rounded-full border border-white/[0.1] bg-white/[0.045] p-1"
            data-cycle={billingCycle}
          >
            <span
              className={`absolute bottom-1 top-1 w-[calc(50%-6px)] rounded-full bg-zinc-100 shadow-[0_14px_32px_rgba(0,0,0,0.28)] transition-transform duration-200 ${
                billingCycle === 'yearly' ? 'translate-x-[calc(100%+4px)]' : 'translate-x-0'
              }`}
              aria-hidden="true"
            />
            {billingCycles.map((cycle) => (
              <button
                key={cycle.key}
                type="button"
                onClick={() => setBillingCycle(cycle.key)}
                className={`relative z-[1] min-h-9 rounded-full px-4 text-[12px] font-black transition-colors ${
                  billingCycle === cycle.key ? 'text-zinc-950' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {cycle.label}
              </button>
            ))}
          </div>
          <span className="inline-flex w-max items-center gap-2 rounded-full border border-[#f2c36b]/30 bg-[#f2c36b]/[0.08] px-3 py-1.5 text-[11px] font-black text-[#f9d997] md:justify-self-end">
            <i className="h-1.5 w-1.5 rounded-full bg-[#f2c36b] shadow-[0_0_18px_rgba(242,195,107,0.65)]" aria-hidden="true" />
            20% discount
          </span>
          {variant === 'account' && normalizedCurrentPlanKey !== 'FREE' && normalizedCurrentBillingCycle ? (
            <span className="text-[10px] font-semibold text-zinc-600 md:text-right">
              Current subscription: {formatBillingCycleLabel(normalizedCurrentBillingCycle)}. Upgrades keep this cycle.
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {BILLING_PLANS.map((plan) => {
          const planIndex = BILLING_PLANS.findIndex((candidate) => candidate.key === plan.key);
          const current = normalizedCurrentPlanKey === plan.key;
          const downgradeBlocked = (
            variant === 'account' &&
            plan.key !== 'FREE' &&
            currentPlanIndex > 0 &&
            planIndex < currentPlanIndex
          );
          const cycleSwitchBlocked = Boolean(
            variant === 'account' &&
            normalizedCurrentBillingCycle &&
            plan.key !== 'FREE' &&
            currentPlanIndex > 0 &&
            planIndex > currentPlanIndex &&
            billingCycle !== normalizedCurrentBillingCycle
          );
          return (
            <PlanCard
              key={plan.key}
              billingAction={billingAction}
              billingCycle={billingCycle}
              cancelAtPeriodEnd={cancelAtPeriodEnd}
              catalog={catalog}
              current={current}
              currentBillingCycle={normalizedCurrentBillingCycle}
              cycleSwitchBlocked={cycleSwitchBlocked}
              downgradeBlocked={downgradeBlocked}
              getStartedHref={getStartedHref}
              onCancelSubscription={onCancelSubscription}
              onChoosePlan={onChoosePlan}
              onOpenPortal={onOpenPortal}
              plan={plan}
              variant={variant}
            />
          );
        })}
      </div>
    </section>
  );
}

function useBillingCycle(initialBillingCycle?: BillingCycle | null) {
  return useState<BillingCycle>(initialBillingCycle || 'monthly');
}

function PlanCard({
  variant,
  plan,
  billingCycle,
  catalog,
  current,
  currentBillingCycle,
  cycleSwitchBlocked,
  downgradeBlocked,
  cancelAtPeriodEnd,
  billingAction,
  getStartedHref,
  onChoosePlan,
  onOpenPortal,
  onCancelSubscription,
}: {
  variant: 'public' | 'account';
  plan: BillingPlan;
  billingCycle: BillingCycle;
  catalog?: BillingPlanCatalog | null;
  current: boolean;
  currentBillingCycle: BillingCycle | null;
  cycleSwitchBlocked: boolean;
  downgradeBlocked: boolean;
  cancelAtPeriodEnd: boolean;
  billingAction?: string | null;
  getStartedHref: string;
  onChoosePlan?: (planKey: BillingPlanKey, billingCycle: BillingCycle) => void;
  onOpenPortal?: () => void;
  onCancelSubscription?: () => void;
}) {
  const paidPriceId = configuredPriceId(catalog, plan.key, billingCycle);
  const includedCredits = getPlanBillingCredits(plan, billingCycle);
  const estimate = estimatePlanWorkload(includedCredits);
  const priceUsd = getPlanBillingPriceUsd(plan, billingCycle);
  const planActionKey = `plan:${plan.key}:${billingCycle}`;
  const paidPlanConfigured = Boolean(catalog?.configured && paidPriceId);
  const currentPaidPlan = current && plan.key !== 'FREE';

  return (
    <article
      className={`grid min-h-[500px] grid-rows-[auto_auto_minmax(0,1fr)_auto] rounded-[8px] border p-5 ${
        plan.highlighted
          ? 'border-[#8eb3ff]/40 bg-[#8eb3ff]/[0.055]'
          : 'border-white/[0.09] bg-white/[0.02]'
      }`}
    >
      <div className="flex min-h-7 items-start justify-between gap-3">
        <h3 className="text-[15px] font-bold text-zinc-100">{plan.name}</h3>
        {plan.highlighted ? (
          <span className="rounded-full bg-[#8eb3ff]/15 px-2 py-1 text-[9px] font-extrabold text-[#a9c5ff]">
            Most popular
          </span>
        ) : null}
      </div>

      <div className="mt-5">
        <span className="text-[30px] font-bold text-white">${priceUsd}</span>
        <span className="ml-1 text-[10px] text-zinc-600">
          {plan.key === 'FREE' ? '/ month' : billingCycle === 'yearly' ? '/ year' : '/ month'}
        </span>
        {plan.key !== 'FREE' && billingCycle === 'yearly' ? (
          <span className="mt-1 block text-[10px] font-semibold text-[#f9d997]">
            ${Math.round(priceUsd / 12)} / month equivalent
          </span>
        ) : null}
        <p className="mt-3 min-h-10 text-[11px] leading-5 text-zinc-500">{plan.description}</p>
      </div>

      <div className="mt-6 grid content-start gap-3 border-t border-white/[0.09] pt-5">
        <PlanFeature
          icon={Sparkles}
          text={plan.key === 'FREE'
            ? `${formatCredits(includedCredits)} welcome Credits, once`
            : `${formatCredits(includedCredits)} Credits ${billingCycle === 'yearly' ? 'each yearly billing period' : 'each billing period'}`}
        />
        <PlanFeature icon={CircleGauge} text={`${plan.concurrentTasks} concurrent task${plan.concurrentTasks === 1 ? '' : 's'}`} />
        <PlanFeature
          icon={Check}
          text={plan.modelTiers.includes('PRO') ? productBrand.modelLiteAndProLabel : productBrand.modelLiteOnlyLabel}
        />
        <PlanFeature icon={MessageCircle} text={`${estimate.discussions} discussions approximately`} />
        <PlanFeature icon={Search} text={`${estimate.researchTasks} research tasks approximately`} />
        <PlanFeature icon={Telescope} text={`${estimate.deepTasks} deep tasks approximately`} />
      </div>

      {variant === 'public' ? (
        <Link
          href={getStartedHref}
          className="mt-6 inline-flex min-h-10 items-center justify-center rounded-[7px] border border-white/[0.12] bg-white px-3 text-[11px] font-bold !text-zinc-950 hover:bg-zinc-200"
        >
          Get Started
        </Link>
      ) : current ? (
        <div className="mt-6 grid gap-2">
          <button
            type="button"
            disabled={!currentPaidPlan || billingAction !== null || !catalog?.configured}
            onClick={() => onOpenPortal?.()}
            className="min-h-10 rounded-[7px] border border-[#46d19a]/20 bg-[#46d19a]/[0.06] px-3 text-[11px] font-bold text-[#46d19a] disabled:cursor-default disabled:text-zinc-600"
          >
            {billingAction === 'portal' ? 'Opening...' : plan.key === 'FREE' ? 'Current plan' : 'Manage billing'}
          </button>
          {cancelAtPeriodEnd && currentPaidPlan ? (
            <span className="flex min-h-10 items-center justify-center rounded-[7px] border border-amber-300/20 bg-amber-300/[0.06] px-3 text-center text-[11px] font-bold text-amber-200">
              Cancellation scheduled
            </span>
          ) : currentPaidPlan ? (
            <button
              type="button"
              disabled={billingAction !== null || !catalog?.configured}
              onClick={() => onCancelSubscription?.()}
              className="min-h-10 rounded-[7px] border border-red-300/15 bg-red-300/[0.045] px-3 text-[11px] font-bold text-red-200 hover:border-red-300/25 hover:bg-red-300/[0.07] disabled:cursor-not-allowed disabled:text-zinc-600"
            >
              {billingAction === 'cancel' ? 'Opening...' : 'Cancel subscription'}
            </button>
          ) : null}
        </div>
      ) : plan.key === 'FREE' ? (
        <span className="mt-6 flex min-h-10 items-center justify-center rounded-[7px] border border-white/[0.09] px-3 text-[11px] font-bold text-zinc-600">
          Included at signup
        </span>
      ) : (
        <button
          type="button"
          title={downgradeBlocked
            ? 'Cancel your current subscription first. You can choose this plan after the billing period ends.'
            : cycleSwitchBlocked && currentBillingCycle
              ? `Choose ${formatBillingCycleLabel(currentBillingCycle)} billing to upgrade immediately. Billing cycle changes are available after cancellation.`
            : undefined}
          disabled={
            downgradeBlocked ||
            cycleSwitchBlocked ||
            billingAction !== null ||
            !paidPlanConfigured
          }
          onClick={() => onChoosePlan?.(plan.key, billingCycle)}
          className="mt-6 inline-flex min-h-10 items-center justify-center rounded-[7px] border border-white/[0.12] bg-white px-3 text-[11px] font-bold text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-white/[0.035] disabled:text-zinc-600"
        >
          {billingAction === planActionKey ? (
            <span className="inline-flex items-center gap-2">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Preparing...
            </span>
          ) : downgradeBlocked ? (
            'Available after cancellation'
          ) : cycleSwitchBlocked && currentBillingCycle ? (
            `Use ${formatBillingCycleLabel(currentBillingCycle)} billing`
          ) : paidPlanConfigured ? (
            `Choose ${plan.name}`
          ) : (
            'Billing setup pending'
          )}
        </button>
      )}
    </article>
  );
}

function configuredPriceId(
  catalog: BillingPlanCatalog | null | undefined,
  planKey: BillingPlanKey,
  billingCycle: BillingCycle,
) {
  if (planKey === 'FREE') return null;
  const entry = catalog?.plans?.[planKey];
  if (!entry) return null;
  if (billingCycle === 'yearly') return entry.yearlyPriceId || null;
  return entry.monthlyPriceId || entry.priceId || null;
}

function normalizePlanKey(value: string | null | undefined): BillingPlanKey {
  if (value === 'STARTER' || value === 'PRO' || value === 'SCALE') return value;
  return 'FREE';
}

function normalizeBillingCycle(value: string | null | undefined): BillingCycle | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'monthly' || normalized === 'yearly') return normalized;
  return null;
}

function formatBillingCycleLabel(value: BillingCycle) {
  return value === 'yearly' ? 'Yearly' : 'Monthly';
}

function PlanFeature({
  icon: Icon,
  text,
}: {
  icon: LucideIcon;
  text: string;
}) {
  return (
    <span className="flex items-center gap-2.5 text-[11px] text-zinc-400">
      <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
      {text}
    </span>
  );
}
