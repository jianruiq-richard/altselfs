'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { MinacoBrandMark } from '@/components/minaco-brand-mark';
import {
  BILLING_PLANS,
  type BillingCycle,
  getPlanBillingCredits,
  getPlanBillingPriceUsd,
} from '@/lib/billing-plans';
import type { MinacoProductCatalog, PublicModelRate } from '@/lib/minaco-product-catalog';
import styles from './public-pricing-page.module.css';

import { planHref } from '@/lib/account-navigation';
const pageSize = 8;

export function PublicPricingPage() {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [catalog, setCatalog] = useState<MinacoProductCatalog | null>(null);
  const [query, setQuery] = useState('');
  const [agent, setAgent] = useState('all');
  const [page, setPage] = useState(0);

  useEffect(() => {
    let alive = true;
    void fetch('/api/public/product-catalog', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Catalog unavailable')))
      .then((value: MinacoProductCatalog) => { if (alive) setCatalog(value); })
      .catch(() => { if (alive) setCatalog(null); });
    return () => { alive = false; };
  }, []);

  const agents = useMemo(() => {
    const values = new Map<string, string>();
    for (const model of catalog?.models || []) for (const engine of model.engines) values.set(engine, engineName(catalog, engine));
    return [...values].sort((a, b) => a[1].localeCompare(b[1]));
  }, [catalog]);

  const models = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return distinctModels(catalog?.models || []).filter((model) => {
      if (agent !== 'all' && !model.engines.includes(agent)) return false;
      return !normalized || `${model.label} ${model.provider} ${model.model}`.toLowerCase().includes(normalized);
    });
  }, [agent, catalog, query]);

  const pageCount = Math.max(1, Math.ceil(models.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleModels = models.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.wordmark} href="/">
        <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandImage} />
        <span>Minaco</span>
      </Link>
      <nav><Link href="/#agents">Agents</Link><Link href="/download">Download</Link><Link href="/agent">Web Agent</Link></nav>
      <div><Link href="/sign-in">Log in</Link><Link className={styles.navAction} href="/sign-up">Create account</Link></div>
    </header>

    <section className={styles.intro}>
      <div>
        <h1>One plan.<br />Desktop + Web.</h1>
        <p>Your subscription, Credits, and account work across supported Minaco-credit Agents and the original browser-based Minaco Agent.</p>
      </div>
      <div className={styles.cycleControl} aria-label="Billing cycle">
        {(['monthly', 'yearly'] as BillingCycle[]).map((value) => <button key={value} className={cycle === value ? styles.cycleActive : ''} onClick={() => setCycle(value)}>{value === 'monthly' ? 'Monthly' : 'Annual · 20% less'}</button>)}
      </div>
    </section>

    <section className={styles.planTable} aria-label="Minaco plans">
      <div className={styles.planLabels}>
        <strong>Plans</strong><span>Credits</span><span>Concurrent tasks</span><span>Scheduled tasks</span><span>Model access</span><span>Products</span><span />
      </div>
      {BILLING_PLANS.map((plan) => {
        const price = getPlanBillingPriceUsd(plan, cycle);
        const credits = getPlanBillingCredits(plan, cycle);
        return <article key={plan.key} className={plan.highlighted ? styles.planFeatured : ''}>
          <header><h2>{plan.name}</h2><strong>${price}<small>/{cycle === 'yearly' && plan.key !== 'FREE' ? 'year' : 'month'}</small></strong></header>
          <p>{plan.description}</p>
          <dl>
            <div><dt>Credits</dt><dd>{credits.toLocaleString('en-US')}{plan.key === 'FREE' ? ' once' : cycle === 'yearly' ? ' per year' : ' per month'}</dd></div>
            <div><dt>Concurrent tasks</dt><dd>{plan.concurrentTasks}</dd></div>
            <div><dt>Scheduled tasks</dt><dd>{plan.scheduledTasks}</dd></div>
            <div><dt>Model access</dt><dd>{plan.modelTiers.join(' + ')}</dd></div>
            <div><dt>Products</dt><dd>Desktop + Web Agent</dd></div>
          </dl>
          <Link href={planHref(plan.key, cycle)} data-analytics-cta={`pricing_plan_${plan.key.toLowerCase()}`} data-analytics-location="pricing_table">Choose {plan.name}<ArrowRight size={16} /></Link>
        </article>;
      })}
    </section>

    <section className={styles.rateSection} id="model-rates">
      <div className={styles.rateIntro}>
        <h2>Know the cost before the turn</h2>
        <p>These live rates come from the Desktop API. Figures are Minaco Credits per one million tokens.</p>
        <Link href="/download"><Download size={17} /> Download Minaco</Link>
      </div>
      <div className={styles.rateBrowser} data-ui>
        <div className={styles.rateTools}>
          <label><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search models" aria-label="Search models" /></label>
          <select value={agent} onChange={(event) => { setAgent(event.target.value); setPage(0); }} aria-label="Filter by Agent"><option value="all">All Agents</option>{agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        </div>
        {visibleModels.length ? <div className={styles.rateRows}>
          <div className={styles.rateHeader}><span>Model</span><span>Input</span><span>Cached</span><span>Output</span></div>
          {visibleModels.map((model) => <ModelRow key={`${model.provider}:${model.model}`} model={model} />)}
        </div> : <p className={styles.emptyRates}>{catalog ? 'No models match this filter.' : 'Live model rates are temporarily unavailable.'}</p>}
        <div className={styles.pagination}>
          <span>{models.length ? `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, models.length)} of ${models.length}` : '0 models'}</span>
          <div><button aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))}><ChevronLeft size={17} /></button><button aria-label="Next page" disabled={safePage >= pageCount - 1} onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}><ChevronRight size={17} /></button></div>
        </div>
      </div>
    </section>

    <section className={styles.explainer}>
      <h2>Credits follow the work</h2>
      <div><p><strong>Minaco-credit mode</strong>Each completed turn shows input, cached input, output, and Credits together.</p><p><strong>Personal-account mode</strong>Usage stays with the provider account you explicitly connect for that Agent.</p><p><strong>Purchased Credits</strong>Credit packs remain on your account when you change plans.</p></div>
    </section>

    <footer className={styles.footer}><span>Minaco pricing</span><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/contact">Contact</Link></div><Link href="/download">Download for macOS</Link></footer>
  </main>;
}

function ModelRow({ model }: { model: PublicModelRate }) {
  return <div className={styles.rateRow}>
    <span><strong>{model.label}</strong><small>{model.engines.join(', ') || 'Minaco'}</small></span>
    <span data-label="Input">{formatRate(model.input)}</span>
    <span data-label="Cached">{formatRate(model.cachedInput)}</span>
    <span data-label="Output">{formatRate(model.output)}</span>
  </div>;
}

function distinctModels(models: PublicModelRate[]) {
  const seen = new Set<string>();
  return models.filter((model) => !seen.has(model.model) && !!seen.add(model.model));
}

function engineName(catalog: MinacoProductCatalog | null, id: string) {
  return catalog?.agents.find((candidate) => candidate.id === id)?.name || id;
}

function formatRate(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
}
