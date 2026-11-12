'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Download,
  Gauge,
  LoaderCircle,
  ReceiptText,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MinacoBrandMark } from '@/components/minaco-brand-mark';
import type { MinacoProductCatalog, PublicModelRate } from '@/lib/minaco-product-catalog';
import { modelRateRows, cacheWriteNote } from '@/lib/model-rate-display';
import styles from './minaco-account-page.module.css';
import { useRouter, useSearchParams } from 'next/navigation';
import { accountView, accountHref, accountSignInHref, type AccountView } from '@/lib/account-navigation';
import { AccountPlanPanel } from './account-plan-panel';
import { AccountBillingHistory } from './account-billing-history';

type ActivitySource = 'all' | 'desktop' | 'intelligence';

type BillingOverview = {
  account: {
    availableCredits: number;
    reservedCredits: number;
    lifetimeGrantedCredits: number;
    lifetimeSpentCredits: number;
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
    scheduledPlanKey: string | null;
    provider: string | null;
    billingCycle: string | null;
  };
  capacity: { activeTaskCount: number; availableTaskSlots: number };
};

type UsageComponent = {
  agent: string;
  provider: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  credits: number;
};

type ActivityItem = {
  id: string;
  source: 'desktop' | 'intelligence';
  component: 'agent_turn' | 'memory_review';
  status: string;
  runId: string;
  threadId: string | null;
  threadTitle: string | null;
  taskLabel: string | null;
  billedCredits: number;
  computedCredits: number;
  pricingVersion: string | null;
  totals: Omit<UsageComponent, 'agent' | 'provider' | 'model' | 'credits'>;
  components: UsageComponent[];
  createdAt: string;
  settledAt: string | null;
};

type ActivityResponse = {
  items: ActivityItem[];
  nextCursor: string | null;
};

type ProfileResponse = {
  user?: { name: string | null; nickname: string | null; email: string };
};

const views: Array<{ key: AccountView; label: string; detail: string }> = [
  { key: 'overview', label: 'Overview', detail: 'Plan and balance' },
  { key: 'plan', label: 'Plan & Credits', detail: 'Subscription and top-ups' },
  { key: 'usage', label: 'Usage', detail: 'Every billed turn' },
  { key: 'billing', label: 'Billing', detail: 'Payments and Credits' },
  { key: 'rates', label: 'Model rates', detail: 'Current live prices' },
];

const ratePageSize = 8;

export function MinacoAccountPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const { signOut } = useClerk();
  const query = params.toString();
  const view = params.get('intent') === 'cancel' ? 'plan' : accountView(params.get('view'));
  const [monthly, setMonthly] = useState<{ credits: number; turns: number } | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const activityRequest = useRef(0);
  const filters = new URLSearchParams();
  for (const key of ['from', 'to', 'agent', 'model']) if (params.get(key)) filters.set(key, params.get(key)!);
  const filterQuery = filters.toString();

  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [profile, setProfile] = useState<ProfileResponse['user'] | null>(null);
  const [catalog, setCatalog] = useState<MinacoProductCatalog | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const source: ActivitySource = params.get('source') === 'desktop' ? 'desktop' : params.get('source') === 'intelligence' ? 'intelligence' : 'all';
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingAction, setBillingAction] = useState(false);
  const [rateQuery, setRateQuery] = useState('');
  const [rateAgent, setRateAgent] = useState('all');
  const [ratePage, setRatePage] = useState(0);

  const loadActivity = useCallback(async (nextSource: ActivitySource, cursor?: string | null) => {
    const request = ++activityRequest.current;
    setActivityLoading(true); setActivityError(null);
    if (!cursor) { setActivity([]); setActivityCursor(null); }
    try {
      const query = new URLSearchParams(filterQuery);
      query.set('source', nextSource); query.set('limit', '20');
      if (cursor) query.set('cursor', cursor);
      const response = await fetch(`/api/billing/activity?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => ({})) as ActivityResponse & { error?: string; monthly?: { credits: number; turns: number } };
      if (!response.ok) throw new Error(data.error || 'Usage history is unavailable.');
      if (request !== activityRequest.current) return;
      setMonthly(data.monthly || null);
      setActivity((current) => cursor ? [...current, ...data.items] : data.items);
      setActivityCursor(data.nextCursor);
    } catch (loadError) {
      if (request === activityRequest.current) setActivityError(loadError instanceof Error ? loadError.message : 'Usage history is unavailable.');
    } finally {
      if (request === activityRequest.current) setActivityLoading(false);
    }
  }, [filterQuery]);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    setError(null); setCatalogError(null);
    try {
      const [overviewResponse, profileResponse, catalogResponse] = await Promise.all([
        fetch('/api/billing/summary?section=overview', { cache: 'no-store', credentials: 'same-origin' }),
        fetch('/api/user/profile', { cache: 'no-store', credentials: 'same-origin' }),
        fetch('/api/public/product-catalog', { cache: 'no-store' }),
      ]);
      const overviewData = await overviewResponse.json().catch(() => ({})) as BillingOverview & { error?: string };
      if (!overviewResponse.ok) throw new Error(overviewData.error || 'Account details are unavailable.');
      setOverview(overviewData);
      if (profileResponse.ok) setProfile(((await profileResponse.json()) as ProfileResponse).user || null);
      if (catalogResponse.ok) setCatalog(await catalogResponse.json() as MinacoProductCatalog);
      else { setCatalog(null); setCatalogError('Model rates are temporarily unavailable. Use Refresh to retry.'); }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Account details are unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) void loadAccount();
  }, [isLoaded, isSignedIn, loadAccount]);

  useEffect(() => {
    if (isLoaded && isSignedIn) void loadActivity(source);
  }, [isLoaded, isSignedIn, loadActivity, source]);

  const changeSource = (next: ActivitySource) => {
    const nextQuery = new URLSearchParams(query); nextQuery.set('view', 'usage'); nextQuery.set('source', next);
    router.push(`/account?${nextQuery}`, { scroll: false });
    setActivity([]);
    setActivityCursor(null);
    setExpanded(null);
  };

  const openBillingPortal = async () => {
    setBillingAction(true);
    setError(null);
    try {
      const response = await fetch('/api/billing/portal', { method: 'POST', credentials: 'same-origin' });
      const data = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || 'Billing management is unavailable.');
      window.location.assign(data.url);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Billing management is unavailable.');
      setBillingAction(false);
    }
  };

  const models = useMemo(() => distinctModels(catalog?.models || []).filter((model) => {
    if (rateAgent !== 'all' && !model.engines.includes(rateAgent)) return false;
    const query = rateQuery.trim().toLowerCase();
    return !query || `${model.label} ${model.provider} ${model.model}`.toLowerCase().includes(query);
  }), [catalog, rateAgent, rateQuery]);
  const ratePageCount = Math.max(1, Math.ceil(models.length / ratePageSize));
  const safeRatePage = Math.min(ratePage, ratePageCount - 1);
  const visibleModels = models.slice(safeRatePage * ratePageSize, (safeRatePage + 1) * ratePageSize);
  const agents = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of catalog?.models || []) {
      for (const engine of model.engines) map.set(engine, catalog?.agents.find((agent) => agent.id === engine)?.name || engine);
    }
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [catalog]);

  if (!isLoaded || (isSignedIn && loading && !overview)) return <AccountLoading />;
  if (!isSignedIn) return <AccountSignIn query={query} />;

  const name = profile?.nickname || profile?.name || user?.fullName || 'Minaco account';
  const email = profile?.email || user?.primaryEmailAddress?.emailAddress || '';

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.wordmark} href="/">
        <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandImage} />
        <span>Minaco</span>
      </Link>
      <nav><Link href="/download"><Download size={15} /> Download</Link><Link href="/agent">Web Agent</Link><Link href="/pricing">Pricing</Link></nav>
      <div className={styles.identity}><span>{name}</span><small>{email}</small><button className={styles.switchAccount} onClick={() => void signOut({ redirectUrl: accountSignInHref(query) })}>Switch account</button></div>
    </header>

    <div className={styles.shell}>
      <aside className={styles.rail}>
        {views.map((item) => <a key={item.key} href={accountHref(item.key)} aria-current={view === item.key ? "page" : undefined} className={view === item.key ? styles.railActive : ''}><strong>{item.label}</strong><span>{item.detail}</span></a>)}
        <div className={styles.railFoot}><Sparkles size={16} /><span>One account across Desktop and Web.</span></div>
      </aside>

      <section className={styles.content}>
        <div className={styles.contentHead}>
          <div><h1>{views.find((item) => item.key === view)?.label}</h1></div>
          <button className={styles.refresh} onClick={() => { void loadAccount(); void loadActivity(source); setRefreshKey(value => value + 1); }} disabled={loading || activityLoading}><RefreshCw className={loading ? styles.spin : ''} size={15} /> Refresh</button>
        </div>
        {error ? <div className={styles.error}>{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
        {params.get('billing') ? <p className={styles.notice} role="status">{params.get('billing') === 'checkout-cancelled' ? 'Checkout closed. No purchase was confirmed here.' : 'You’re back from billing. The details below reflect confirmed updates; refresh if a payment is still processing.'}</p> : null}
        {overview ? <>
          {view === 'overview' ? <Overview overview={overview} onManage={openBillingPortal} managing={billingAction} /> : null}
          {view === 'plan' ? <AccountPlanPanel subscription={overview.subscription} refresh={loadAccount} /> : null}
          {view === 'usage' ? <><UsageFilters query={query} monthly={monthly} />{activityError ? <div className={styles.error} role="alert">{activityError}<button onClick={() => void loadActivity(source)}>Retry usage</button></div> : null}<UsageView activity={activity} cursor={activityCursor} expanded={expanded} loading={activityLoading} onExpand={setExpanded} onLoadMore={() => void loadActivity(source, activityCursor)} onSource={changeSource} source={source} error={activityError} /></> : null}
          {view === 'billing' ? <AccountBillingHistory refreshKey={refreshKey} onManage={openBillingPortal} managing={billingAction} stripe={overview.subscription.provider?.toLowerCase() === 'stripe'} /> : null}
          {view === 'rates' ? <>{catalogError ? <div role="alert" className={styles.error}>{catalogError}</div> : null}<RatesView agents={agents} agent={rateAgent} models={models} page={safeRatePage} pageCount={ratePageCount} query={rateQuery} visible={visibleModels} onAgent={(value) => { setRateAgent(value); setRatePage(0); }} onPage={setRatePage} onQuery={(value) => { setRateQuery(value); setRatePage(0); }} /></> : null}
        </> : <div className={styles.empty}>Account details are unavailable.</div>}
      </section>
    </div>
  </main>;
}

function Overview({ overview, onManage, managing }: { overview: BillingOverview; onManage: () => void; managing: boolean }) {
  const renewal = overview.subscription.currentPeriodEnd ? formatDate(overview.subscription.currentPeriodEnd) : 'No renewal date';
  const isStripe = overview.subscription.provider?.toLowerCase() === 'stripe';
  return <div className={styles.overview}>
    <section className={styles.planHero}>
      <div><div className={styles.planTitle}><h2>{overview.subscription.planName}</h2><Status value={overview.subscription.cancelAtPeriodEnd ? 'Ends this period' : overview.subscription.status} /></div><p>{overview.subscription.cancelAtPeriodEnd ? `Access continues through ${renewal}.` : `${overview.subscription.billingCycle === 'yearly' ? 'Annual' : 'Monthly'} plan · renews ${renewal}.`}</p></div>
      <div className={styles.planActions}><Link className={styles.secondary} href={accountHref('plan')}>Change plan</Link><Link className={styles.secondary} href={accountHref('plan') + '#credits'}>Add Credits</Link>{isStripe ? <button className={styles.primary} onClick={onManage} disabled={managing}>{managing ? <LoaderCircle className={styles.spin} size={16} /> : <CreditCard size={16} />} Manage subscription</button> : <><span>Managed by Minaco</span><Link href="/contact">Contact support <ArrowUpRight size={14} /></Link></>}</div>
    </section>
    <section className={styles.metrics}>
      <Metric icon={<CircleDollarSign />} label="Available" value={`${formatNumber(overview.account.availableCredits)} Credits`} detail={`${formatNumber(overview.account.reservedCredits)} reserved`} />
      <Metric icon={<Gauge />} label="This plan" value={`${formatNumber(overview.subscription.monthlyCredits)} Credits`} detail={`${overview.subscription.concurrentTaskLimit} concurrent tasks`} />
      <Metric icon={<Clock3 />} label="Lifetime usage" value={`${formatNumber(overview.account.lifetimeSpentCredits)} Credits`} detail={`${formatNumber(overview.account.lifetimeGrantedCredits)} granted`} />
    </section>
    <section className={styles.productAccess}><div><h2>Your account follows the work.</h2><p>The same plan and Credit balance apply to supported Minaco-credit Agents on Desktop and Minaco Intelligence on the web.</p></div><div><Link href="/download">Open Desktop download <ArrowUpRight size={15} /></Link><Link href="/agent">Open Web Agent <ArrowUpRight size={15} /></Link></div></section>
  </div>;
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <article className={styles.metric}><span>{icon}</span><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>;
}

function UsageView(props: { activity: ActivityItem[]; cursor: string | null; expanded: string | null; loading: boolean; error: string | null; source: ActivitySource; onExpand: (id: string | null) => void; onLoadMore: () => void; onSource: (source: ActivitySource) => void }) {
  return <div className={styles.usageView}>
    <div className={styles.sectionIntro}><div><h2>One row for every settled turn</h2><p>Desktop Agents and Minaco Intelligence use the same Credit ledger. Expand a row for the model and token snapshot captured at settlement.</p></div><div className={styles.segment}>{(['all', 'desktop', 'intelligence'] as ActivitySource[]).map((value) => <button key={value} className={props.source === value ? styles.segmentActive : ''} onClick={() => props.onSource(value)}>{value === 'all' ? 'All' : value === 'desktop' ? 'Desktop' : 'Intelligence'}</button>)}</div></div>
    <div className={styles.activityTable}>
      <div className={styles.activityHeader}><span>Conversation</span><span>Source</span><span>Tokens</span><span>Credits</span><span>Date</span><span /></div>
      {props.activity.map((item) => {
        const open = props.expanded === item.id;
        return <article className={styles.activityItem} key={`${item.source}:${item.id}`}>
          <button className={styles.activityRow} onClick={() => props.onExpand(open ? null : item.id)} aria-expanded={open} aria-label={`Usage details: ${item.threadTitle || item.taskLabel || item.runId}`}>
            <span><strong>{item.taskLabel || item.threadTitle || (item.source === 'desktop' ? 'Desktop conversation' : 'Intelligence discussion')}</strong><small>{item.component === 'memory_review' ? 'Memory review' : item.components.map((component) => component.model).join(' + ') || shortId(item.runId)}</small></span>
            <span><SourceBadge source={item.source} /></span>
            <span>{formatCompact(totalBillableTokens(item))}</span>
            <span><strong>{formatNumber(item.billedCredits)}</strong></span>
            <span>{formatDate(item.settledAt || item.createdAt)}</span>
            <ChevronDown className={open ? styles.chevronOpen : ''} size={17} />
          </button>
          {open ? <div className={styles.activityDetail}>
            {item.components.map((component, index) => <div className={styles.componentBreakdown} key={`${component.provider}:${component.model}:${index}`}><div><strong>{component.model}</strong><span>{component.agent} · {component.provider}</span></div><Token label="Input" value={component.inputTokens} /><Token label="Cached" value={component.cachedInputTokens} /><Token label="Cache write" value={component.cacheWriteTokens} /><Token label="Output" value={component.outputTokens} /><Token label="Reasoning" value={component.reasoningTokens} /><Token label="Credits" value={component.credits} credits /></div>)}
            <footer><span>Settlement rate: {item.pricingVersion || 'Recorded snapshot'}</span><span>Run {shortId(item.runId)}</span></footer>
          </div> : null}
        </article>;
      })}
      {!props.activity.length && !props.loading && !props.error ? <div className={styles.empty}>No usage matches these filters. Try a wider date range or a different source.</div> : null}
    </div>
    {props.loading ? <div className={styles.loadingLine}><LoaderCircle className={styles.spin} size={16} /> Loading usage</div> : null}
    {props.cursor && !props.loading ? <button className={styles.loadMore} onClick={props.onLoadMore}>Load 20 more</button> : null}
  </div>;
}

function RatesView(props: { agents: Array<[string, string]>; agent: string; models: PublicModelRate[]; page: number; pageCount: number; query: string; visible: PublicModelRate[]; onAgent: (value: string) => void; onPage: (value: number) => void; onQuery: (value: string) => void }) {
  return <div className={styles.ratesView}>
    <div className={styles.sectionIntro}><div><h2>Current model rates</h2><p>Compare current model prices. Past turns keep the rates used when they were billed.</p></div><Link className={styles.secondary} href="/pricing">Compare plans <ArrowUpRight size={14} /></Link></div>
    <div className={styles.rateTools}><label><Search size={16} /><input value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="Search models" /></label><select value={props.agent} onChange={(event) => props.onAgent(event.target.value)}><option value="all">All Agents</option>{props.agents.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></div>
    <div className={styles.rateTable}>
      <div><span>Model</span><span>Input</span><span>Cached</span><span>Output</span></div>
      {props.visible.flatMap(modelRateRows).map((model) => <div key={`${model.provider}:${model.model}:${model.label}`}><span><strong>{model.label}</strong><small>{model.engines.join(', ') || 'Minaco'}</small>{model.pricingNote ? <small>{model.pricingNote}</small> : null}{cacheWriteNote(model) ? <small>{cacheWriteNote(model)}</small> : null}</span><span>{formatRate(model.input)}</span><span>{formatRate(model.cachedInput)}</span><span>{formatRate(model.output)}</span></div>)}
      {!props.visible.length ? <div className={styles.empty}>No current models match this filter.</div> : null}
    </div>
    <Pagination count={props.models.length} page={props.page} pageCount={props.pageCount} pageSize={ratePageSize} onPage={props.onPage} />
    <p className={styles.rateNote}>Credits per 1 million tokens. A completed turn can include more than one model component.</p>
  </div>;
}

function Pagination({ count, page, pageCount, pageSize, onPage }: { count: number; page: number; pageCount: number; pageSize: number; onPage: (page: number) => void }) {
  return <div className={styles.pagination}><span>{count ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, count)} of ${count}` : '0 items'}</span><div><button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0}><ChevronLeft size={17} /></button><button onClick={() => onPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}><ChevronRight size={17} /></button></div></div>;
}

function Token({ label, value, credits = false }: { label: string; value: number; credits?: boolean }) { return <span><small>{label}</small><strong>{credits ? formatNumber(value) : formatCompact(value)}</strong></span>; }
function SourceBadge({ source }: { source: ActivityItem['source'] }) { return <span className={source === 'desktop' ? styles.desktopBadge : styles.intelligenceBadge}>{source === 'desktop' ? 'Desktop' : 'Intelligence'}</span>; }
function Status({ value }: { value: string }) { const normalized = value.toLowerCase(); return <span className={normalized.includes('active') || normalized.includes('paid') || normalized.includes('captured') ? styles.statusGood : styles.statusNeutral}>{humanize(value)}</span>; }

function AccountLoading() { return <main className={styles.center}><LoaderCircle className={styles.spin} size={24} /><span>Loading your Minaco account</span></main>; }
function AccountSignIn({ query }: { query: string }) { return <main className={styles.center}><MinacoBrandMark className={styles.signInMark} imageClassName={styles.brandImage} /><h1>Your Minaco account</h1><p>Sign in to see the plan, Credits, Desktop usage, Intelligence usage, and billing history shared by your products.</p><Link className={styles.primary} href={accountSignInHref(query)}>Log in to Minaco</Link></main>; }

function distinctModels(models: PublicModelRate[]) { const seen = new Set<string>(); return models.filter((model) => !seen.has(model.model) && !!seen.add(model.model)); }
function totalBillableTokens(item: ActivityItem) { return item.totals.inputTokens + item.totals.cachedInputTokens + item.totals.outputTokens + item.totals.cacheWriteTokens; }
function shortId(value: string) { return value.length > 20 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value; }
function formatNumber(value: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0); }
function formatCompact(value: number) { return new Intl.NumberFormat('en-US', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value || 0); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function formatMoney(cents: number, currency: string) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(cents / 100); }
function formatRate(value: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value); }
function humanize(value: string) { return value.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (match) => match.toUpperCase()); }

function UsageFilters({ query, monthly }: { query: string; monthly: { credits: number; turns: number } | null }) {
  const params = new URLSearchParams(query);
  const router = useRouter();
  return <section className={styles.usageFilters}>
    <p className={styles.monthly}>{monthly ? <><strong>{formatNumber(monthly.credits)} Credits</strong> used this month · {formatNumber(monthly.turns)} turns across all products · UTC</> : 'Monthly usage will appear once the history is loaded.'}</p>
    <form key={query} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const next = new URLSearchParams({ view: 'usage', source: params.get('source') || 'all' }); for (const key of ['from', 'to', 'agent', 'model']) { const value = String(data.get(key) || '').trim(); if (value) next.set(key, value); } router.push(`/account?${next}`, { scroll: false }); }}>
      <label>From (UTC)<input name="from" type="date" defaultValue={params.get('from') || ''} max={params.get('to') || undefined} /></label>
      <label>Through (UTC)<input name="to" type="date" defaultValue={params.get('to') || ''} min={params.get('from') || undefined} /></label>
      <label>Agent<input name="agent" placeholder="All agents" defaultValue={params.get('agent') || ''} /></label>
      <label>Model<input name="model" placeholder="All models" defaultValue={params.get('model') || ''} /></label>
      <button className={styles.secondary} type="submit">Apply filters</button><Link href={accountHref('usage')}>Reset</Link>
    </form>
  </section>;
}
