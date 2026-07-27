'use client';

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  CircleGauge,
  LoaderCircle,
  Mail,
  MessageCircle,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Telescope,
} from 'lucide-react';
import Link from 'next/link';
import { AstromarWorkspaceShell } from '@/components/astromar-workspace-shell';
import { BillingPlanOverview } from '@/components/billing-plan-overview';
import { BILLING_PLANS, formatCredits } from '@/lib/billing-plans';

type BillingSummary = {
  mode: 'observe' | 'enforce';
  account: {
    balanceCredits: number;
    reservedCredits: number;
    availableCredits: number;
  };
  subscription: {
    planKey: string;
    planName: string;
    status: string;
    monthlyCredits: number;
    concurrentTaskLimit: number;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  capacity: {
    activeTaskCount: number;
    availableTaskSlots: number;
  };
};

type BillingCatalog = {
  configured: boolean;
  plans: Record<string, { priceId: string | null }>;
  packs: Record<string, { priceId: string | null; credits: number; amountCents: number }>;
  refundPolicy: {
    contactEmail: string;
    usageLimitCredits: number;
    selfService: false;
  };
};

const WORKLOAD_BENCHMARKS = {
  quickDiscussionCredits: 35,
  standardResearchCredits: 150,
  deepResearchCredits: 370,
};

const workloadExamples = [
  { label: 'Quick discussions', capacity: 'about 28 per 1,000 credits', detail: 'Typical conversational agent turns' },
  { label: 'Standard research tasks', capacity: 'about 6 per 1,000 credits', detail: 'Agent research and tool execution' },
  { label: 'Deep research runs', capacity: 'about 2 per 1,000 credits', detail: 'Longer multi-step execution, files, or artifact work' },
];

export default function PricingPage() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [billingAction, setBillingAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResponse, catalogResponse] = await Promise.all([
        fetch('/api/billing/summary', { cache: 'no-store', credentials: 'same-origin' }),
        fetch('/api/billing/catalog', { cache: 'no-store', credentials: 'same-origin' }),
      ]);
      const data = (await summaryResponse.json().catch(() => ({}))) as BillingSummary & { error?: string };
      const catalogData = (await catalogResponse.json().catch(() => ({}))) as BillingCatalog & { error?: string };
      if (!summaryResponse.ok) throw new Error(data.error || 'Failed to load billing details');
      setSummary(data);
      if (catalogResponse.ok) setCatalog(catalogData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load billing details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSummary();
  }, []);

  const runBillingAction = async (
    actionKey: string,
    path: string,
    body?: Record<string, unknown>,
  ) => {
    setBillingAction(actionKey);
    setActionMessage(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Billing action failed.');
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      setActionMessage(data.message || 'Billing update submitted. Your account will refresh after payment confirmation.');
      await loadSummary();
    } catch (actionError) {
      setActionMessage(actionError instanceof Error ? actionError.message : 'Billing action failed.');
    } finally {
      setBillingAction(null);
    }
  };

  return (
    <AstromarWorkspaceShell mobileTitle="Pricing">
      <div className="grid h-full min-h-0 grid-rows-[64px_minmax(0,1fr)]">
        <header className="flex items-center justify-between border-b border-white/[0.09] px-4 sm:px-6">
          <div>
            <strong className="block text-[13px] text-zinc-100">Pricing</strong>
            <span className="mt-0.5 block text-[10px] text-zinc-600">Plans and credits</span>
          </div>
          <Link
            href="/profile"
            className="inline-flex min-h-9 items-center gap-2 rounded-[7px] px-3 text-[11px] font-semibold text-zinc-400 hover:bg-white/[0.045] hover:text-white"
          >
            Manage usage
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </header>

        <main className="astromar-scrollbar min-h-0 overflow-y-auto px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
          <div className="mx-auto w-full max-w-[1180px]">
            <section className="border-b border-white/[0.09] pb-8">
              {loading ? (
                <div className="flex min-h-[220px] items-center justify-center rounded-[8px] border border-white/[0.09] bg-white/[0.025] text-xs text-zinc-500">
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Loading current plan
                </div>
              ) : error || !summary ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[8px] border border-red-400/20 bg-red-400/[0.04] px-5 text-center">
                  <span className="text-xs text-red-200">{error || 'Current plan is unavailable.'}</span>
                  <button type="button" onClick={() => void loadSummary()} className="mt-3 inline-flex items-center gap-2 text-[11px] font-bold text-white hover:underline">
                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                  </button>
                </div>
              ) : (
                <BillingPlanOverview
                  subscription={summary.subscription}
                  availableCredits={summary.account.availableCredits}
                  reservedCredits={summary.account.reservedCredits}
                  capacity={summary.capacity}
                />
              )}
            </section>

            <section className="grid gap-3 py-8 sm:grid-cols-2 xl:grid-cols-4" aria-label="Available plans">
              {BILLING_PLANS.map((plan) => {
                const current = summary?.subscription.planKey === plan.key;
                const currentPlanIndex = BILLING_PLANS.findIndex(
                  (candidate) => candidate.key === summary?.subscription.planKey,
                );
                const planIndex = BILLING_PLANS.findIndex((candidate) => candidate.key === plan.key);
                const downgradeBlocked = (
                  plan.key !== 'FREE' &&
                  currentPlanIndex > 0 &&
                  planIndex < currentPlanIndex
                );
                const includedCredits = plan.key === 'FREE' ? 1_000 : plan.monthlyCredits;
                const estimate = estimatePlanWorkload(includedCredits);
                const cancellationScheduled = current && plan.key !== 'FREE' && summary?.subscription.cancelAtPeriodEnd;
                return (
                  <article
                    key={plan.key}
                    className={`grid min-h-[470px] grid-rows-[auto_auto_minmax(0,1fr)_auto] rounded-[8px] border p-5 ${
                      plan.highlighted
                        ? 'border-[#8eb3ff]/40 bg-[#8eb3ff]/[0.055]'
                        : 'border-white/[0.09] bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex min-h-7 items-start justify-between gap-3">
                      <h2 className="text-[15px] font-bold text-zinc-100">{plan.name}</h2>
                      {plan.highlighted ? (
                        <span className="rounded-full bg-[#8eb3ff]/15 px-2 py-1 text-[9px] font-extrabold text-[#a9c5ff]">Most popular</span>
                      ) : null}
                    </div>
                    <div className="mt-5">
                      <span className="text-[30px] font-bold text-white">${plan.priceUsd}</span>
                      <span className="ml-1 text-[10px] text-zinc-600">/ month</span>
                      <p className="mt-3 min-h-10 text-[11px] leading-5 text-zinc-500">{plan.description}</p>
                    </div>
                    <div className="mt-6 grid content-start gap-3 border-t border-white/[0.09] pt-5">
                      <PlanFeature
                        icon={Sparkles}
                        text={plan.key === 'FREE'
                          ? '1,000 welcome Credits, once'
                          : `${formatCredits(plan.monthlyCredits)} Credits each billing period`}
                      />
                      <PlanFeature icon={CircleGauge} text={`${plan.concurrentTasks} concurrent task${plan.concurrentTasks === 1 ? '' : 's'}`} />
                      <PlanFeature
                        icon={Check}
                        text={plan.modelTiers.includes('PRO') ? 'Altselfs Lite and Pro' : 'Altselfs Lite only'}
                      />
                      <PlanFeature icon={MessageCircle} text={`${estimate.discussions} discussions approximately`} />
                      <PlanFeature icon={Search} text={`${estimate.researchTasks} research tasks approximately`} />
                      <PlanFeature icon={Telescope} text={`${estimate.deepTasks} deep tasks approximately`} />
                    </div>
                    {current ? (
                      <div className="mt-6 grid gap-2">
                        <button
                          type="button"
                          disabled={plan.key === 'FREE' || billingAction !== null || !catalog?.configured}
                          onClick={() => void runBillingAction('portal', '/api/billing/portal')}
                          className="min-h-10 rounded-[7px] border border-[#46d19a]/20 bg-[#46d19a]/[0.06] px-3 text-[11px] font-bold text-[#46d19a] disabled:cursor-default"
                        >
                          {billingAction === 'portal' ? 'Opening...' : plan.key === 'FREE' ? 'Current plan' : 'Manage billing'}
                        </button>
                        {cancellationScheduled ? (
                          <span className="flex min-h-10 items-center justify-center rounded-[7px] border border-amber-300/20 bg-amber-300/[0.06] px-3 text-center text-[11px] font-bold text-amber-200">
                            Cancellation scheduled
                          </span>
                        ) : plan.key !== 'FREE' ? (
                          <button
                            type="button"
                            disabled={billingAction !== null || !catalog?.configured}
                            onClick={() => void runBillingAction(
                              'cancel',
                              '/api/billing/change-plan',
                              { planKey: 'FREE' },
                            )}
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
                          : undefined}
                        disabled={
                          downgradeBlocked ||
                          billingAction !== null ||
                          !catalog?.configured ||
                          !catalog.plans[plan.key]?.priceId
                        }
                        onClick={() => void runBillingAction(
                          `plan:${plan.key}`,
                          '/api/billing/change-plan',
                          { planKey: plan.key },
                        )}
                        className="mt-6 min-h-10 rounded-[7px] border border-white/[0.12] bg-white px-3 text-[11px] font-bold text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-white/[0.035] disabled:text-zinc-600"
                      >
                        {billingAction === `plan:${plan.key}`
                          ? 'Preparing...'
                          : downgradeBlocked
                            ? 'Available after cancellation'
                          : catalog?.configured
                            ? `Choose ${plan.name}`
                            : 'Billing setup pending'}
                      </button>
                    )}
                  </article>
                );
              })}
            </section>

            {actionMessage ? (
              <div className="mb-8 rounded-[7px] border border-[#8eb3ff]/25 bg-[#8eb3ff]/[0.06] px-4 py-3 text-[11px] text-[#b7cdf8]">
                {actionMessage}
              </div>
            ) : null}

            <section className="border-t border-white/[0.09] py-9">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-[#8eb3ff]">Permanent balance</span>
                  <h2 className="mt-2 text-[20px] font-bold text-zinc-100">Add Credits without changing your plan.</h2>
                  <p className="mt-2 text-[11px] text-zinc-500">Purchased Credits never expire and remain available across plan changes.</p>
                </div>
                <span className="text-[11px] font-semibold text-zinc-500">$1 = 1,000 Credits</span>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Object.entries(catalog?.packs || {
                  CREDITS_20000: { priceId: null, credits: 20_000, amountCents: 2_000 },
                  CREDITS_40000: { priceId: null, credits: 40_000, amountCents: 4_000 },
                  CREDITS_80000: { priceId: null, credits: 80_000, amountCents: 8_000 },
                  CREDITS_100000: { priceId: null, credits: 100_000, amountCents: 10_000 },
                }).map(([packKey, pack]) => (
                  <article key={packKey} className="grid min-h-[154px] grid-rows-[auto_1fr_auto] rounded-[8px] border border-white/[0.09] bg-white/[0.02] p-4">
                    <Package className="h-4 w-4 text-[#8eb3ff]" />
                    <span className="mt-4 grid">
                      <strong className="text-[18px] text-zinc-100">{formatCredits(pack.credits)} Credits</strong>
                      <span className="mt-1 text-[11px] text-zinc-600">${pack.amountCents / 100} one time</span>
                    </span>
                    <button
                      type="button"
                      disabled={billingAction !== null || !catalog?.configured || !pack.priceId}
                      onClick={() => void runBillingAction(
                        `pack:${packKey}`,
                        '/api/billing/checkout',
                        { purchaseKind: 'CREDIT_PACK', packKey },
                      )}
                      className="mt-4 min-h-9 rounded-[7px] border border-white/[0.1] bg-white/[0.04] px-3 text-[10px] font-bold text-zinc-300 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:text-zinc-700"
                    >
                      {billingAction === `pack:${packKey}` ? 'Preparing...' : 'Buy Credits'}
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <section className="grid gap-8 border-t border-white/[0.09] py-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <h2 className="text-[18px] font-bold text-zinc-100">How credits are used</h2>
                <p className="mt-2 max-w-[520px] text-[11px] leading-5 text-zinc-500">
                  A small concurrency hold is placed when a task starts. The final charge comes from measured agent usage.
                </p>
                <div className="mt-5 border-y border-white/[0.09]">
                  {workloadExamples.map((example) => (
                    <div key={example.label} className="grid min-h-[62px] grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b border-white/[0.09] last:border-b-0">
                      <span className="grid">
                        <strong className="text-xs text-zinc-200">{example.label}</strong>
                        <span className="mt-1 text-[10px] text-zinc-600">{example.detail}</span>
                      </span>
                      <strong className="text-right text-[11px] text-zinc-400">{example.capacity}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-[18px] font-bold text-zinc-100">Settlement policy</h2>
                <div className="mt-5 grid gap-4">
                  <PolicyRow number="01" title="Hold" text="A small 50-credit concurrency hold protects parallel task capacity without predicting the full task cost." />
                  <PolicyRow number="02" title="Measure" text="The backend agent reports token and model usage for the current run." />
                  <PolicyRow
                    number="03"
                    title="Settle"
                    text="Completed work is charged at actual usage. If the final action exceeds the balance, new tasks pause until the outstanding credits are restored."
                  />
                </div>
              </div>
            </section>

            <section className="grid gap-5 border-t border-white/[0.09] py-9 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#8eb3ff]" />
                <span>
                  <strong className="text-xs text-zinc-200">Credits do not expire</strong>
                  <p className="mt-1.5 text-[10px] leading-5 text-zinc-600">
                    Welcome, subscription, and purchased Credits remain on the account until used or reversed by an approved refund.
                  </p>
                </span>
              </div>
              <div className="flex gap-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#8eb3ff]" />
                <span>
                  <strong className="text-xs text-zinc-200">Manual refund review</strong>
                  <p className="mt-1.5 text-[10px] leading-5 text-zinc-600">
                    Contact {catalog?.refundPolicy.contactEmail || 'contact@astromar.org'}. For non-platform issues, a subscription invoice or Credit pack may be refunded when no more than {formatCredits(catalog?.refundPolicy.usageLimitCredits || 2_000)} Credits have been used from that Credit batch.
                  </p>
                </span>
              </div>
            </section>
          </div>
        </main>
      </div>
    </AstromarWorkspaceShell>
  );
}

function estimatePlanWorkload(monthlyCredits: number) {
  return {
    discussions: formatApproxCount(monthlyCredits / WORKLOAD_BENCHMARKS.quickDiscussionCredits),
    researchTasks: formatApproxCount(monthlyCredits / WORKLOAD_BENCHMARKS.standardResearchCredits),
    deepTasks: formatApproxCount(monthlyCredits / WORKLOAD_BENCHMARKS.deepResearchCredits),
  };
}

function formatApproxCount(value: number) {
  const safeValue = Math.max(1, Math.floor(value));
  const rounded = safeValue >= 1_000
    ? Math.round(safeValue / 100) * 100
    : safeValue >= 100
      ? Math.round(safeValue / 10) * 10
      : safeValue;
  return new Intl.NumberFormat('en-US').format(rounded);
}

function PlanFeature({
  icon: Icon,
  text,
}: {
  icon: typeof Check;
  text: string;
}) {
  return (
    <span className="flex items-center gap-2.5 text-[11px] text-zinc-400">
      <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
      {text}
    </span>
  );
}

function PolicyRow({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-3">
      <span className="pt-0.5 text-[10px] font-extrabold text-[#8eb3ff]">{number}</span>
      <span className="grid border-b border-white/[0.09] pb-4">
        <strong className="text-xs text-zinc-200">{title}</strong>
        <span className="mt-1.5 text-[10px] leading-5 text-zinc-600">{text}</span>
      </span>
    </div>
  );
}
