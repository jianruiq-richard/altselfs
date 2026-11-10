'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BILLING_PLANS, getPlanBillingCredits, getPlanBillingPriceUsd, type BillingCycle } from '@/lib/billing-plans';
import { getAnalyticsSessionContext } from '@/lib/analytics/client';
import styles from './minaco-account-page.module.css';

type Catalog = { configured?: boolean; plans?: Record<string, { monthlyPriceId?: string | null; yearlyPriceId?: string | null }>; packs?: Record<string, { priceId?: string | null; credits: number; amountCents: number }> };
export function AccountPlanPanel({ subscription, refresh }: { subscription: { planKey: string; planName: string; provider: string | null; billingCycle: string | null; cancelAtPeriodEnd: boolean }; refresh: () => Promise<void> }) {
  const params = useSearchParams();
  const requestedCycle = params.get('cycle');
  const [cycle, setCycle] = useState<BillingCycle>(requestedCycle === 'yearly' ? 'yearly' : subscription.billingCycle === 'yearly' ? 'yearly' : 'monthly');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cancel, setCancel] = useState(params.get('intent') === 'cancel');
  useEffect(() => { if (requestedCycle) setCycle(requestedCycle === 'yearly' ? 'yearly' : 'monthly'); }, [requestedCycle]);
  const load = async () => {
    setError(null);
    try { const res = await fetch('/api/billing/catalog', { cache: 'no-store' }); if (!res.ok) throw new Error('Payment options are unavailable.'); setCatalog(await res.json()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Payment options are unavailable.'); }
  };
  useEffect(() => { void load(); }, []);
  const run = async (key: string, path: string, body?: Record<string, unknown>) => {
    if (busy) return;
    setBusy(key); setError(null); setMessage(null);
    try {
      const analytics = await getAnalyticsSessionContext();
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify({ ...body, analytics }) : undefined });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to open payment confirmation.');
      if (data.url) { window.location.assign(data.url); return; }
      setMessage(data.message || 'Request received. Your account reflects confirmed billing updates.');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Billing is unavailable.'); }
    finally { setBusy(null); }
  };
  const current = BILLING_PLANS.findIndex(p => p.key === subscription.planKey.toUpperCase());
  const stripe = subscription.provider?.toLowerCase() === 'stripe';
  return <div className={styles.planPanel}>
    <div className={styles.sectionIntro}><div><h2>Available plans</h2><p>Current plan: {subscription.planName}. Purchases and subscription changes are confirmed securely before they take effect.</p></div><div className={styles.segment}>{(['monthly', 'yearly'] as const).map(value => <button key={value} aria-pressed={cycle === value} className={cycle === value ? styles.segmentActive : ''} onClick={() => { setCycle(value); const url = new URL(window.location.href); url.searchParams.set('cycle', value); window.history.replaceState(null, '', url); }}>{value === 'monthly' ? 'Monthly' : 'Annual · 20% less'}</button>)}</div></div>
    {error ? <div role="alert" className={styles.error}>{error}<button onClick={() => void load()}>Retry payment options</button></div> : null}
    {message ? <p role="status" className={styles.notice}>{message}</p> : null}
    {!catalog && !error ? <p role="status">Loading payment options…</p> : null}
    <div className={styles.planGrid}>{BILLING_PLANS.map((plan, index) => {
      const isCurrent = current === index;
      const lower = current > 0 && index < current;
      const cycleBlocked = current > 0 && !isCurrent && subscription.billingCycle !== cycle;
      const available = catalog?.configured && (cycle === 'yearly' ? catalog.plans?.[plan.key]?.yearlyPriceId : catalog.plans?.[plan.key]?.monthlyPriceId);
      return <article key={plan.key} className={params.get('plan')?.toUpperCase() === plan.key ? styles.selectedPlan : ''}>
        <h3>{plan.name}{isCurrent ? <small>Current · {subscription.billingCycle === 'yearly' ? 'annual' : 'monthly'}</small> : null}</h3><strong>${getPlanBillingPriceUsd(plan, cycle)} <small>/{cycle === 'yearly' && plan.key !== 'FREE' ? 'year' : 'month'}</small></strong>
        <p>{getPlanBillingCredits(plan, cycle).toLocaleString('en-US')} Credits {plan.key === 'FREE' ? 'at signup' : cycle === 'yearly' ? '/ year' : '/ month'}</p><p>{plan.concurrentTasks} concurrent tasks</p>
        <button className={styles.secondary} disabled={!!busy || (isCurrent ? !stripe : plan.key === 'FREE' || lower || cycleBlocked || !available)} onClick={() => void run(isCurrent ? 'portal' : plan.key, isCurrent ? '/api/billing/portal' : '/api/billing/change-plan', isCurrent ? undefined : { planKey: plan.key, billingCycle: cycle })}>{busy === plan.key || (isCurrent && busy === 'portal') ? 'Opening…' : isCurrent ? stripe ? 'Manage subscription' : 'Current plan' : plan.key === 'FREE' ? 'Included at signup' : lower ? 'Downgrade unavailable' : cycleBlocked ? 'Keep current billing cycle' : `Choose ${plan.name}`}</button>
      </article>;
    })}</div>
    {stripe && current > 0 ? <div className={styles.cancelPanel}>
      {subscription.cancelAtPeriodEnd ? <p>Your subscription ends after the current billing period. <button className={styles.secondary} disabled={!!busy} onClick={() => void run('portal', '/api/billing/portal')}>Manage renewal</button></p> : cancel ? <><h3>Cancel renewal?</h3><p>Your plan remains available through the current paid period. Continue to Stripe to review and confirm cancellation.</p><button className={styles.secondary} disabled={!!busy} onClick={() => setCancel(false)}>Keep subscription</button> <button className={styles.secondary} disabled={!!busy} onClick={() => void run('cancel', '/api/billing/change-plan', { planKey: 'FREE' })}>{busy === 'cancel' ? 'Opening…' : 'Review cancellation'}</button></> : <button className={styles.secondary} onClick={() => setCancel(true)}>Cancel renewal</button>}
    </div> : null}
    <section id="credits"><h2>Add Credits</h2><p>Keep your plan. Purchased Credits never expire.</p><div className={styles.planGrid}>{Object.entries(catalog?.packs || {}).map(([key, pack]) => <article key={key}><h3>{pack.credits.toLocaleString('en-US')} Credits</h3><p>${pack.amountCents / 100} · one time</p><button className={styles.secondary} disabled={!!busy || !catalog?.configured || !pack.priceId} onClick={() => void run(key, '/api/billing/checkout', { purchaseKind: 'CREDIT_PACK', packKey: key })}>{busy === key ? 'Opening…' : 'Buy Credits'}</button></article>)}</div></section>
  </div>;
}
