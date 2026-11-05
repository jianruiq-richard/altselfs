'use client';

import { useUser } from '@clerk/nextjs';
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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MinacoBrandMark } from '@/components/minaco-brand-mark';
import type { MinacoProductCatalog, PublicModelRate } from '@/lib/minaco-product-catalog';
import styles from './minaco-account-page.module.css';

type AccountView = 'overview' | 'usage' | 'billing' | 'rates';
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

type BillingDetails = {
  recentLedger: Array<{
    id: string;
    type: string;
    amountCredits: number;
    description: string;
    threadTitle: string | null;
    createdAt: string;
  }>;
  recentPayments: Array<{
    id: string;
    kind: string;
    status: string;
    planKey: string | null;
    packKey: string | null;
    creditsGranted: number;
    amountTotalCents: number;
    refundedAmountCents: number;
    currency: string;
    paidAt: string | null;
    createdAt: string;
  }>;
  refundPolicy: { contactEmail: string };
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
  { key: 'usage', label: 'Usage', detail: 'Every billed turn' },
  { key: 'billing', label: 'Billing', detail: 'Payments and Credits' },
  { key: 'rates', label: 'Model rates', detail: 'Current live prices' },
];

const ratePageSize = 8;

export function MinacoAccountPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const [view, setView] = useState<AccountView>('overview');
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [details, setDetails] = useState<BillingDetails | null>(null);
  const [profile, setProfile] = useState<ProfileResponse['user'] | null>(null);
  const [catalog, setCatalog] = useState<MinacoProductCatalog | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [source, setSource] = useState<ActivitySource>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingAction, setBillingAction] = useState(false);
  const [rateQuery, setRateQuery] = useState('');
  const [rateAgent, setRateAgent] = useState('all');
  const [ratePage, setRatePage] = useState(0);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('view');
    if (requested === 'overview' || requested === 'usage' || requested === 'billing' || requested === 'rates') {
      setView(requested);
    }
  }, []);

  const loadActivity = useCallback(async (nextSource: ActivitySource, cursor?: string | null) => {
    setActivityLoading(true);
    try {
      const query = new URLSearchParams({ source: nextSource, limit: '20' });
      if (cursor) query.set('cursor', cursor);
      const response = await fetch(`/api/billing/activity?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => ({})) as ActivityResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Usage history is unavailable.');
      setActivity((current) => cursor ? [...current, ...data.items] : data.items);
      setActivityCursor(data.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Usage history is unavailable.');
    } finally {
      setActivityLoading(false);
    }
  }, []);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewResponse, detailsResponse, profileResponse, catalogResponse] = await Promise.all([
        fetch('/api/billing/summary?section=overview', { cache: 'no-store', credentials: 'same-origin' }),
        fetch('/api/billing/summary?section=details', { cache: 'no-store', credentials: 'same-origin' }),
        fetch('/api/user/profile', { cache: 'no-store', credentials: 'same-origin' }),
        fetch('/api/public/product-catalog', { cache: 'no-store' }),
      ]);
      const overviewData = await overviewResponse.json().catch(() => ({})) as BillingOverview & { error?: string };
      if (!overviewResponse.ok) throw new Error(overviewData.error || 'Account details are unavailable.');
      setOverview(overviewData);
      if (detailsResponse.ok) setDetails(await detailsResponse.json() as BillingDetails);
      if (profileResponse.ok) setProfile(((await profileResponse.json()) as ProfileResponse).user || null);
      if (catalogResponse.ok) setCatalog(await catalogResponse.json() as MinacoProductCatalog);
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
    setSource(next);
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
  if (!isSignedIn) return <AccountSignIn />;

  const name = profile?.nickname || profile?.name || user?.fullName || 'Minaco account';
  const email = profile?.email || user?.primaryEmailAddress?.emailAddress || '';

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.wordmark} href="/">
        <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandImage} />
        <span>Minaco</span>
      </Link>
      <nav><Link href="/download"><Download size={15} /> Download</Link><Link href="/agent">Web Agent</Link><Link href="/pricing">Pricing</Link></nav>
      <div className={styles.identity}><span>{name}</span><small>{email}</small></div>
    </header>

    <div className={styles.shell}>
      <aside className={styles.rail}>
        <p>Account</p>
        {views.map((item) => <button key={item.key} className={view === item.key ? styles.railActive : ''} onClick={() => setView(item.key)}><strong>{item.label}</strong><span>{item.detail}</span></button>)}
        <div className={styles.railFoot}><Sparkles size={16} /><span>One account across Desktop and Web.</span></div>
      </aside>

      <section className={styles.content}>
        <div className={styles.contentHead}>
          <div><p>Minaco account</p><h1>{views.find((item) => item.key === view)?.label}</h1></div>
          <button className={styles.refresh} onClick={() => void loadAccount()} disabled={loading}><RefreshCw className={loading ? styles.spin : ''} size={15} /> Refresh</button>
        </div>
        {error ? <div className={styles.error}>{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
        {overview ? <>
          {view === 'overview' ? <Overview overview={overview} onManage={openBillingPortal} managing={billingAction} /> : null}
          {view === 'usage' ? <UsageView activity={activity} cursor={activityCursor} expanded={expanded} loading={activityLoading} onExpand={setExpanded} onLoadMore={() => void loadActivity(source, activityCursor)} onSource={changeSource} source={source} /> : null}
          {view === 'billing' ? <BillingView details={details} overview={overview} onManage={openBillingPortal} managing={billingAction} /> : null}
          {view === 'rates' ? <RatesView agents={agents} agent={rateAgent} models={models} page={safeRatePage} pageCount={ratePageCount} query={rateQuery} visible={visibleModels} onAgent={(value) => { setRateAgent(value); setRatePage(0); }} onPage={setRatePage} onQuery={(value) => { setRateQuery(value); setRatePage(0); }} /> : null}
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
      <div><span className={styles.eyebrow}>Current subscription</span><div className={styles.planTitle}><h2>{overview.subscription.planName}</h2><Status value={overview.subscription.cancelAtPeriodEnd ? 'Ends this period' : overview.subscription.status} /></div><p>{overview.subscription.cancelAtPeriodEnd ? `Access continues through ${renewal}.` : `${overview.subscription.billingCycle === 'yearly' ? 'Annual' : 'Monthly'} plan · renews ${renewal}.`}</p></div>
      <div className={styles.planActions}>{isStripe ? <button className={styles.primary} onClick={onManage} disabled={managing}>{managing ? <LoaderCircle className={styles.spin} size={16} /> : <CreditCard size={16} />} Manage subscription</button> : <><span>Managed by Minaco</span><Link href="/contact">Contact support <ArrowUpRight size={14} /></Link></>}</div>
    </section>
    <section className={styles.metrics}>
      <Metric icon={<CircleDollarSign />} label="Available" value={`${formatNumber(overview.account.availableCredits)} Credits`} detail={`${formatNumber(overview.account.reservedCredits)} reserved`} />
      <Metric icon={<Gauge />} label="This plan" value={`${formatNumber(overview.subscription.monthlyCredits)} Credits`} detail={`${overview.subscription.concurrentTaskLimit} concurrent tasks`} />
      <Metric icon={<Clock3 />} label="Lifetime usage" value={`${formatNumber(overview.account.lifetimeSpentCredits)} Credits`} detail={`${formatNumber(overview.account.lifetimeGrantedCredits)} granted`} />
    </section>
    <section className={styles.productAccess}><div><span className={styles.eyebrow}>Included products</span><h2>Your account follows the work.</h2><p>The same plan and Credit balance apply to supported Minaco-credit Agents on Desktop and Minaco Intelligence on the web.</p></div><div><Link href="/download">Open Desktop download <ArrowUpRight size={15} /></Link><Link href="/agent">Open Web Agent <ArrowUpRight size={15} /></Link></div></section>
  </div>;
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <article className={styles.metric}><span>{icon}</span><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>;
}

function UsageView(props: { activity: ActivityItem[]; cursor: string | null; expanded: string | null; loading: boolean; source: ActivitySource; onExpand: (id: string | null) => void; onLoadMore: () => void; onSource: (source: ActivitySource) => void }) {
  return <div className={styles.usageView}>
    <div className={styles.sectionIntro}><div><span className={styles.eyebrow}>Unified activity</span><h2>One row for every settled turn</h2><p>Desktop Agents and Minaco Intelligence use the same Credit ledger. Expand a row for the model and token snapshot captured at settlement.</p></div><div className={styles.segment}>{(['all', 'desktop', 'intelligence'] as ActivitySource[]).map((value) => <button key={value} className={props.source === value ? styles.segmentActive : ''} onClick={() => props.onSource(value)}>{value === 'all' ? 'All' : value === 'desktop' ? 'Desktop' : 'Intelligence'}</button>)}</div></div>
    <div className={styles.activityTable}>
      <div className={styles.activityHeader}><span>Conversation</span><span>Source</span><span>Tokens</span><span>Credits</span><span>Date</span><span /></div>
      {props.activity.map((item) => {
        const open = props.expanded === item.id;
        return <article className={styles.activityItem} key={`${item.source}:${item.id}`}>
          <button className={styles.activityRow} onClick={() => props.onExpand(open ? null : item.id)} aria-expanded={open}>
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
      {!props.activity.length && !props.loading ? <div className={styles.empty}>No settled usage in this view.</div> : null}
    </div>
    {props.loading ? <div className={styles.loadingLine}><LoaderCircle className={styles.spin} size={16} /> Loading usage</div> : null}
    {props.cursor && !props.loading ? <button className={styles.loadMore} onClick={props.onLoadMore}>Load 20 more</button> : null}
  </div>;
}

function BillingView({ details, overview, onManage, managing }: { details: BillingDetails | null; overview: BillingOverview; onManage: () => void; managing: boolean }) {
  const [page, setPage] = useState(0);
  const rows = details?.recentPayments.length ? details.recentPayments.map((payment) => ({
    id: payment.id,
    title: payment.kind === 'CREDIT_PACK' ? `${formatNumber(payment.creditsGranted)} Credit pack` : `${overview.subscription.planName} subscription`,
    status: payment.status,
    amount: payment.amountTotalCents ? formatMoney(payment.amountTotalCents - payment.refundedAmountCents, payment.currency) : 'Admin grant',
    credits: payment.creditsGranted,
    createdAt: payment.paidAt || payment.createdAt,
  })) : (details?.recentLedger || []).filter((entry) => entry.amountCredits !== 0).map((entry) => ({ id: entry.id, title: entry.description, status: entry.type, amount: '—', credits: entry.amountCredits, createdAt: entry.createdAt }));
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * pageSize, (safePage + 1) * pageSize);
  return <div className={styles.billingView}>
    <div className={styles.sectionIntro}><div><span className={styles.eyebrow}>Billing history</span><h2>Payments, grants, and plan management</h2><p>Credit usage is listed separately under Usage; this view records how Credits entered or were adjusted on your account.</p></div>{overview.subscription.provider?.toLowerCase() === 'stripe' ? <button className={styles.primary} onClick={onManage} disabled={managing}>{managing ? <LoaderCircle className={styles.spin} size={16} /> : <ReceiptText size={16} />} Manage billing</button> : <Link className={styles.secondary} href="/contact">Contact billing support</Link>}</div>
    <div className={styles.billingTable}>
      <div><span>Item</span><span>Status</span><span>Credits</span><span>Amount</span><span>Date</span></div>
      {visible.map((row) => <div key={row.id}><span><strong>{row.title}</strong><small>{shortId(row.id)}</small></span><span><Status value={row.status} /></span><span className={row.credits < 0 ? styles.negative : ''}>{row.credits > 0 ? '+' : ''}{formatNumber(row.credits)}</span><span>{row.amount}</span><span>{formatDate(row.createdAt)}</span></div>)}
      {!visible.length ? <div className={styles.empty}>No billing events yet.</div> : null}
    </div>
    <Pagination count={rows.length} page={safePage} pageCount={pageCount} pageSize={pageSize} onPage={setPage} />
  </div>;
}

function RatesView(props: { agents: Array<[string, string]>; agent: string; models: PublicModelRate[]; page: number; pageCount: number; query: string; visible: PublicModelRate[]; onAgent: (value: string) => void; onPage: (value: number) => void; onQuery: (value: string) => void }) {
  return <div className={styles.ratesView}>
    <div className={styles.sectionIntro}><div><span className={styles.eyebrow}>Live rate card</span><h2>Current model rates</h2><p>Rates come from the Desktop API. Historical usage keeps the pricing version captured when the turn settled.</p></div><Link className={styles.secondary} href="/pricing">Compare plans <ArrowUpRight size={14} /></Link></div>
    <div className={styles.rateTools}><label><Search size={16} /><input value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="Search models" /></label><select value={props.agent} onChange={(event) => props.onAgent(event.target.value)}><option value="all">All Agents</option>{props.agents.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></div>
    <div className={styles.rateTable}>
      <div><span>Model</span><span>Provider</span><span>Input</span><span>Cached</span><span>Output</span></div>
      {props.visible.map((model) => <div key={`${model.provider}:${model.model}`}><span><strong>{model.label}</strong><small>{model.engines.join(', ') || 'Minaco'}</small></span><span>{model.provider}</span><span>{formatRate(model.input)}</span><span>{formatRate(model.cachedInput)}</span><span>{formatRate(model.output)}</span></div>)}
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
function AccountSignIn() { return <main className={styles.center}><MinacoBrandMark className={styles.signInMark} imageClassName={styles.brandImage} /><h1>Your Minaco account</h1><p>Sign in to see the plan, Credits, Desktop usage, Intelligence usage, and billing history shared by your products.</p><Link className={styles.primary} href="/sign-in?redirect_url=/account">Log in to Minaco</Link></main>; }

function distinctModels(models: PublicModelRate[]) { const seen = new Set<string>(); return models.filter((model) => !seen.has(model.model) && !!seen.add(model.model)); }
function totalBillableTokens(item: ActivityItem) { return item.totals.inputTokens + item.totals.cachedInputTokens + item.totals.outputTokens + item.totals.cacheWriteTokens; }
function shortId(value: string) { return value.length > 20 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value; }
function formatNumber(value: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0); }
function formatCompact(value: number) { return new Intl.NumberFormat('en-US', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value || 0); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function formatMoney(cents: number, currency: string) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(cents / 100); }
function formatRate(value: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value); }
function humanize(value: string) { return value.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (match) => match.toUpperCase()); }
