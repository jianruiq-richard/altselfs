'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { accountHref } from '@/lib/account-navigation';
import { getBillingPlan } from '@/lib/billing-plans';
import styles from './minaco-account-page.module.css';
type Row = { id: string; title: string; status: string; planKey?: string; credits: number; amountCents: number | null; currency?: string; createdAt: string };
export function AccountBillingHistory({ refreshKey, onManage, managing, stripe }: { refreshKey: number; onManage: () => void; managing: boolean; stripe: boolean }) {
  const [kind, setKind] = useState('payments');
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const load = async (next?: string | null) => {
    const request = ++generation.current;
    setBusy(true); setError(null);
    if (!next) { setRows([]); setCursor(null); }
    try {
      const query = new URLSearchParams({ kind }); if (next) query.set('cursor', next);
      const res = await fetch(`/api/billing/history?${query}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Billing history is unavailable. Your records have not been lost.');
      const data = await res.json(); if (request !== generation.current) return;
      setRows(old => next ? [...old, ...data.items] : data.items); setCursor(data.nextCursor);
    } catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : 'Unable to load billing history.'); }
    finally { if (request === generation.current) setBusy(false); }
  };
  useEffect(() => { void load(); return () => { generation.current++; }; }, [kind, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return <section>
    <div className={styles.sectionIntro}><div><h2>Payments & balance changes</h2><p>Payments show purchases. Balance changes show credit grants, refunds and adjustments; they are another view of account activity, not additional charges.</p></div>{stripe ? <button className={styles.primary} onClick={onManage} disabled={managing}>{managing ? 'Opening…' : 'Manage billing'}</button> : <Link className={styles.secondary} href={accountHref('plan')}>Choose a plan</Link>}</div>
    <div className={styles.segment}>{['payments', 'adjustments'].map(value => <button key={value} aria-pressed={kind === value} className={kind === value ? styles.segmentActive : ''} onClick={() => setKind(value)}>{value === 'payments' ? 'Payments' : 'Balance changes'}</button>)}</div>
    {error ? <div className={styles.error} role="alert">{error}<button onClick={() => void load()}>Retry</button></div> : null}
    <div className={styles.billingTable} role="table" aria-label={kind === 'payments' ? 'Payments' : 'Balance changes'}>
      <div role="row"><span>Item</span><span>Status</span><span>Credits</span><span>Amount</span><span>Date</span></div>
      {rows.map(row => <div key={row.id} role="row"><span><strong>{row.title === 'SUBSCRIPTION' ? `${getBillingPlan(row.planKey).name} subscription` : row.title === 'CREDIT_PACK' ? 'Credit pack' : row.title}</strong><small>{new Date(row.createdAt).toLocaleString('en-US')}</small></span><span>{row.status.toLowerCase().replaceAll('_', ' ')}</span><span>{row.credits > 0 ? '+' : ''}{row.credits.toLocaleString('en-US')}</span><span>{row.amountCents === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: row.currency || 'USD' }).format(row.amountCents / 100)}</span><span>{new Date(row.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>)}
    </div>
    {!busy && !error && !rows.length ? <p className={styles.empty}>No {kind === 'payments' ? 'payments' : 'balance changes'} yet. Confirmed transactions will appear here.</p> : null}
    {busy ? <div className={styles.loadingLine} role="status">Loading billing history…</div> : null}
    {cursor && !busy ? <button className={styles.loadMore} onClick={() => void load(cursor)}>Load 20 more</button> : null}
  </section>;
}
