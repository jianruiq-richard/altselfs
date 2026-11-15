'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { MinacoBrandMark } from '@/components/minaco-brand-mark';
import { PublicAccountActions } from '@/components/public-account-actions';
import {
  BILLING_PLANS,
  type BillingCycle,
  getPlanBillingCredits,
  getPlanBillingPriceUsd,
} from '@/lib/billing-plans';
import type { MinacoProductCatalog, PublicModelRate } from '@/lib/minaco-product-catalog';
import { cacheWriteRateCaption, formatCacheWriteRate, modelRateRows } from '@/lib/model-rate-display';
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
    }).flatMap(modelRateRows);
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
      <nav><Link href="/agents">Agents</Link><Link href="/models">Models</Link><Link href="/guidance">Guidance</Link><Link href="/download">Download</Link></nav>
      <PublicAccountActions signUpClassName={styles.navAction} />
    </header>

    <section className={styles.intro}>
      <div>
        <h1>Pricing.</h1>
        <p>Use one Minaco plan across supported native agents, or connect an eligible personal provider account and use its subscription without spending Minaco Credits.</p>
      </div>
      <div className={styles.cycleControl} aria-label="Billing cycle">
        {(['monthly', 'yearly'] as BillingCycle[]).map((value) => <button key={value} className={cycle === value ? styles.cycleActive : ''} onClick={() => setCycle(value)}>{value === 'monthly' ? 'Monthly' : 'Annual · 20% less'}</button>)}
      </div>
    </section>

    <section className={styles.planTable} aria-label="Minaco plans">
      {BILLING_PLANS.map((plan) => {
        const price = getPlanBillingPriceUsd(plan, cycle);
        const credits = getPlanBillingCredits(plan, cycle);
        return <article key={plan.key} className={plan.highlighted ? styles.planFeatured : ''}>
          <header><div><h2>{plan.name}</h2>{plan.highlighted ? <span>Most popular</span> : null}</div><strong>${price}<small>/{cycle === 'yearly' && plan.key !== 'FREE' ? 'year' : 'month'}</small></strong>{cycle === 'yearly' && plan.key !== 'FREE' ? <em>${Math.round(price / 12)}/month equivalent</em> : null}</header>
          <p>{plan.description}</p>
          <dl>
            <div><dt>Credits</dt><dd>{credits.toLocaleString('en-US')}{plan.key === 'FREE' ? ' once' : cycle === 'yearly' ? ' per year' : ' per month'}</dd></div>
            <div><dt>Concurrent tasks</dt><dd>{plan.concurrentTasks}</dd></div>
            <div><dt>Scheduled tasks</dt><dd>{plan.scheduledTasks}</dd></div>
            <div><dt>Model access</dt><dd>{plan.modelTiers.join(' + ')}</dd></div>
            <div><dt>Workspace</dt><dd>Minaco Desktop</dd></div>
          </dl>
          <Link href={planHref(plan.key, cycle)} data-analytics-cta={`pricing_plan_${plan.key.toLowerCase()}`} data-analytics-location="pricing_table">{plan.key === 'FREE' ? 'Start free' : `Choose ${plan.name}`}<ArrowRight size={16} /></Link>
        </article>;
      })}
    </section>

    <section className={styles.rateSection} id="model-rates">
      <div className={styles.rateIntro}>
        <h2>Model rates,<br />without surprises.</h2>
        <p>Compare live rates across agents and models. Figures are Minaco Credits per one million tokens.</p>
        <Link href="/download"><Download size={17} /> Download Minaco</Link>
      </div>
      <div className={styles.rateBrowser}>
        <div className={styles.rateTools}>
          <label><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search models" aria-label="Search models" /></label>
          <select value={agent} onChange={(event) => { setAgent(event.target.value); setPage(0); }} aria-label="Filter by Agent"><option value="all">All Agents</option>{agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        </div>
        {visibleModels.length ? <div className={styles.rateRows}>
          <div className={styles.rateHeader}><span>Model</span><span>Input</span><span>Cached</span><span>Cache write</span><span>Output</span></div>
          {visibleModels.map((model) => <ModelRateRow key={`${model.provider}:${model.model}:${model.label}`} model={model} />)}
        </div> : <p className={styles.emptyRates}>{catalog ? 'No models match this filter.' : 'Live model rates are temporarily unavailable.'}</p>}
        <div className={styles.pagination}>
          <span>{models.length ? `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, models.length)} of ${models.length}` : '0 models'}</span>
          <div><button aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))}><ChevronLeft size={17} /></button><button aria-label="Next page" disabled={safePage >= pageCount - 1} onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}><ChevronRight size={17} /></button></div>
        </div>
      </div>
    </section>

    <section className={styles.explainer}>
      <h2>Two ways<br />to keep working.</h2>
      <div><p><strong>Use Minaco Credits</strong>Choose a funded model available to your plan. Eligible turns are deducted from one Credit balance across supported agents.</p><p><strong>Connect your provider account</strong>Use an eligible personal provider subscription where supported. Those turns follow the provider’s quotas and do not use Minaco Credits.</p><p><strong>Add Credits when needed</strong>Purchased Credit packs stay on your account when you change plans.</p></div>
    </section>

    <footer className={styles.footer}><span>Minaco pricing</span><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/contact">Contact</Link></div><Link href="/download">Download for macOS</Link></footer>
  </main>;
}

function ModelRateRow({ model }: { model: PublicModelRate }) {
  return <div className={styles.rateRow}>
    <span><strong>{model.label}</strong><small>{model.engines.join(', ') || 'Minaco'}</small>{model.pricingNote ? <small>{model.pricingNote}</small> : null}</span>
    <RateValue label="Input" value={formatRate(model.input)} />
    <RateValue label="Cached" value={formatRate(model.cachedInput)} />
    <RateValue label="Cache write" value={formatCacheWriteRate(model)} note={cacheWriteRateCaption(model)} />
    <RateValue label="Output" value={formatRate(model.output)} />
  </div>;
}

function RateValue({ label, value, note }: { label: string; value: string; note?: string }) {
  return <span data-label={label}><span>{value}</span>{note ? <small>{note}</small> : null}</span>;
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
