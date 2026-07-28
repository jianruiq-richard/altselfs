'use client';

import { useUser } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  LoaderCircle,
  Mail,
  Package,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { AstromarWorkspaceShell } from '@/components/astromar-workspace-shell';
import { BillingPlanGrid, type BillingPlanCatalog } from '@/components/billing-plan-grid';
import { BillingPlanOverview } from '@/components/billing-plan-overview';
import { PublicPricingPage } from '@/components/public-pricing-page';
import { type BillingCycle, formatCredits } from '@/lib/billing-plans';

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
    billingCycle: string | null;
  };
  capacity: {
    activeTaskCount: number;
    availableTaskSlots: number;
  };
};

type BillingCatalog = {
  configured: boolean;
  plans: BillingPlanCatalog['plans'];
  packs: Record<string, { priceId: string | null; credits: number; amountCents: number }>;
  refundPolicy: {
    contactEmail: string;
    usageLimitCredits: number;
    selfService: false;
  };
};

const workloadExamples = [
  { label: 'Quick discussions', capacity: 'about 28 per 1,000 credits', detail: 'Typical conversational agent turns' },
  { label: 'Standard research tasks', capacity: 'about 6 per 1,000 credits', detail: 'Agent research and tool execution' },
  { label: 'Deep research runs', capacity: 'about 2 per 1,000 credits', detail: 'Longer multi-step execution, files, or artifact work' },
];

export default function PricingPage() {
  const { isLoaded, isSignedIn } = useUser();
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
    if (!isLoaded || !isSignedIn) return;
    void loadSummary();
  }, [isLoaded, isSignedIn]);

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

  if (!isLoaded) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#090909] px-6 text-center text-zinc-400">
        <div>
          <p className="text-base font-semibold text-zinc-100">Loading pricing</p>
          <p className="mt-2 text-sm text-zinc-500">Please wait...</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <PublicPricingPage />;
  }

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

            <BillingPlanGrid
              billingAction={billingAction}
              cancelAtPeriodEnd={summary?.subscription.cancelAtPeriodEnd}
              catalog={catalog}
              className="py-8"
              currentBillingCycle={summary?.subscription.billingCycle}
              currentPlanKey={summary?.subscription.planKey}
              onCancelSubscription={() => void runBillingAction(
                'cancel',
                '/api/billing/change-plan',
                { planKey: 'FREE' },
              )}
              onChoosePlan={(planKey, billingCycle) => void runBillingAction(
                planActionKey(planKey, billingCycle),
                '/api/billing/change-plan',
                { planKey, billingCycle },
              )}
              onOpenPortal={() => void runBillingAction('portal', '/api/billing/portal')}
              variant="account"
            />

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

function planActionKey(planKey: string, billingCycle: BillingCycle) {
  return `plan:${planKey}:${billingCycle}`;
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
