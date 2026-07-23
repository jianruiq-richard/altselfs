'use client';

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  CircleGauge,
  Clock3,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { AstromarWorkspaceShell } from '@/components/astromar-workspace-shell';
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
  };
};

const workloadExamples = [
  { label: 'Short conversation', range: '5–15 credits', detail: 'Direct Hermes response' },
  { label: 'Standard research', range: '100–200 credits', detail: 'Hermes with Codex execution' },
  { label: 'Deep analysis', range: '330–800 credits', detail: 'Claude with extended execution' },
];

export default function PricingPage() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/billing/summary', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = (await response.json().catch(() => ({}))) as BillingSummary & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Failed to load billing details');
      setSummary(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load billing details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSummary();
  }, []);

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
            <section className="grid items-end gap-6 border-b border-white/[0.09] pb-8 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="max-w-[700px]">
                <span className="text-[10px] font-extrabold uppercase text-[#8eb3ff]">Simple usage pricing</span>
                <h1 className="mt-3 text-[32px] font-bold leading-[1.08] text-zinc-50 sm:text-[40px]">
                  Plans built around actual agent work.
                </h1>
                <p className="mt-4 max-w-[620px] text-[13px] leading-6 text-zinc-400">
                  Every dollar includes 1,000 credits. Tasks are metered from the models and execution they actually use.
                </p>
              </div>

              <div className="grid min-h-[116px] grid-cols-[minmax(0,1fr)_auto] items-center gap-5 rounded-[8px] border border-white/[0.09] bg-white/[0.025] p-5">
                <span className="grid min-w-0">
                  <span className="text-[10px] font-bold uppercase text-zinc-600">Available now</span>
                  {loading ? (
                    <span className="mt-3 inline-flex items-center gap-2 text-xs text-zinc-500">
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Loading balance
                    </span>
                  ) : error ? (
                    <button type="button" onClick={() => void loadSummary()} className="mt-3 inline-flex items-center gap-2 text-left text-[11px] text-red-300 hover:text-red-200">
                      <RefreshCw className="h-3.5 w-3.5" /> Retry
                    </button>
                  ) : (
                    <>
                      <strong className="mt-2 text-[24px] text-zinc-50">{formatCredits(summary?.account.availableCredits || 0)}</strong>
                      <span className="text-[10px] text-zinc-500">
                        credits available
                        {(summary?.account.reservedCredits || 0) > 0
                          ? ` · ${formatCredits(summary?.account.reservedCredits || 0)} reserved`
                          : ''}
                        {(summary?.account.balanceCredits || 0) < 0
                          ? ` · ${formatCredits(Math.abs(summary?.account.balanceCredits || 0))} outstanding`
                          : ''}
                      </span>
                    </>
                  )}
                </span>
                <span className="grid h-11 w-11 place-items-center rounded-[8px] border border-white/[0.09] bg-white/[0.04] text-[#8eb3ff]">
                  <WalletCards className="h-5 w-5" />
                </span>
              </div>
            </section>

            <section className="grid gap-3 py-8 sm:grid-cols-2 xl:grid-cols-4" aria-label="Available plans">
              {BILLING_PLANS.map((plan) => {
                const current = summary?.subscription.planKey === plan.key;
                return (
                  <article
                    key={plan.key}
                    className={`grid min-h-[390px] grid-rows-[auto_auto_minmax(0,1fr)_auto] rounded-[8px] border p-5 ${
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
                      <PlanFeature icon={Sparkles} text={`${formatCredits(plan.monthlyCredits)} credits`} />
                      <PlanFeature icon={CircleGauge} text={`${plan.concurrentTasks} concurrent task${plan.concurrentTasks === 1 ? '' : 's'}`} />
                      <PlanFeature icon={Clock3} text={plan.scheduledTasks > 0 ? `${plan.scheduledTasks} scheduled tasks` : 'Manual tasks'} />
                      <PlanFeature icon={Check} text="Hermes and Codex execution" />
                    </div>
                    {current ? (
                      <button type="button" disabled className="mt-6 min-h-10 rounded-[7px] border border-[#46d19a]/20 bg-[#46d19a]/[0.06] px-3 text-[11px] font-bold text-[#46d19a]">
                        Current plan
                      </button>
                    ) : (
                      <button type="button" disabled className="mt-6 min-h-10 cursor-not-allowed rounded-[7px] border border-white/[0.09] bg-white/[0.035] px-3 text-[11px] font-bold text-zinc-500">
                        Available soon
                      </button>
                    )}
                  </article>
                );
              })}
            </section>

            <section className="grid gap-8 border-t border-white/[0.09] py-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <h2 className="text-[18px] font-bold text-zinc-100">How credits are used</h2>
                <p className="mt-2 max-w-[520px] text-[11px] leading-5 text-zinc-500">
                  A small concurrency hold is placed when a task starts. The final charge comes from measured Hermes and Codex usage.
                </p>
                <div className="mt-5 border-y border-white/[0.09]">
                  {workloadExamples.map((example) => (
                    <div key={example.label} className="grid min-h-[62px] grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b border-white/[0.09] last:border-b-0">
                      <span className="grid">
                        <strong className="text-xs text-zinc-200">{example.label}</strong>
                        <span className="mt-1 text-[10px] text-zinc-600">{example.detail}</span>
                      </span>
                      <strong className="text-[11px] text-zinc-400">{example.range}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-[18px] font-bold text-zinc-100">Settlement policy</h2>
                <div className="mt-5 grid gap-4">
                  <PolicyRow number="01" title="Hold" text="A small 50-credit concurrency hold protects parallel task capacity without predicting the full task cost." />
                  <PolicyRow number="02" title="Measure" text="Hermes and Codex report token and model usage for the current run." />
                  <PolicyRow
                    number="03"
                    title="Settle"
                    text="Completed work is charged at actual usage. If the final action exceeds the balance, new tasks pause until the outstanding credits are restored."
                  />
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </AstromarWorkspaceShell>
  );
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
