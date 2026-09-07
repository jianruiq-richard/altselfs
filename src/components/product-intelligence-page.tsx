'use client';

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Bookmark,
  CalendarDays,
  ChevronDown,
  ExternalLink,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { fetchWorkspaceJson, WORKSPACE_CACHE_KEYS } from '@/lib/workspace-client-cache';

const PAGE_SIZE = 50;

type MetricValue = {
  value: number | null;
  low: number | null;
  high: number | null;
  period: string | null;
  source: string | null;
};

type MarketProductApiRecord = {
  id: string;
  rank: number;
  name: string;
  domain: string;
  websiteUrl: string | null;
  productHuntUrl: string | null;
  logoUrl: string | null;
  launchedAt: string;
  category: string;
  topics: string[];
  productTypes: string[];
  platforms: string[];
  isNativeApp: boolean;
  tagline: string;
  description: string;
  lastMonthAudience: MetricValue & {
    kind: 'registered_users_estimate' | 'app_downloads' | null;
  };
  lastMonthRevenue: MetricValue;
  trafficGrowthPct: number | null;
  trafficTrend: Array<{
    month: string;
    value: number | null;
    source: string | null;
    confidence: string;
  }>;
  confidence: string;
  isMock: boolean;
  metricsUpdatedAt: string;
  estimateMethodVersion: string | null;
};

type FilterOption = { value: string; count: number };

type MarketProductApiResponse = {
  products: MarketProductApiRecord[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  generatedAt: string;
  source: string;
  dataset: string;
  mock: boolean;
  filterOptions: {
    topics: FilterOption[];
    productTypes: FilterOption[];
  };
};

type FilterState = {
  query: string;
  category: string;
  productType: string;
  sort: 'rank' | 'audience' | 'trend' | 'revenue' | 'newest';
};

const initialFilters: FilterState = {
  query: '',
  category: 'all',
  productType: 'all',
  sort: 'rank',
};

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const fullNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function formatLaunchDate(value: string) {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

function formatMetric(value: number | null, currency = false) {
  if (value === null || !Number.isFinite(value)) return 'Not available';
  return `${currency ? '$' : ''}${compactNumber.format(value)}`;
}

function formatPeriod(value: string | null) {
  if (!value) return '';
  if (value === 'rolling-30d') return 'last 30D';
  const parsed = new Date(`${value}-01T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(parsed);
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#fffaf0]/45">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full appearance-none rounded-[8px] border border-[#fffaf0]/10 bg-[#0b0c0c] px-3 pr-9 text-[12px] font-medium text-[#fffaf0]/82 outline-none transition hover:border-[#fffaf0]/18 focus:border-[#f2c36b]/55 focus:ring-2 focus:ring-[#f2c36b]/10"
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#fffaf0]/35" />
      </span>
    </label>
  );
}

function ProductLogo({ product }: { product: MarketProductApiRecord }) {
  const [failed, setFailed] = useState(false);
  const fallback = product.name.slice(0, 1).toUpperCase() || '?';

  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-[#fffaf0]/12 bg-[#181916] text-[14px] font-black text-[#f2c36b] shadow-[0_7px_20px_rgba(0,0,0,.18)]">
      {product.logoUrl && !failed ? (
        // Product Hunt CDN URLs are dynamic and intentionally use a plain image here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.logoUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : fallback}
    </span>
  );
}

function metricTitle(metric: MetricValue) {
  if (metric.value === null) return 'No estimate is available yet.';
  const range = metric.low !== null && metric.high !== null
    ? ` Estimated range: ${fullNumber.format(metric.low)}–${fullNumber.format(metric.high)}.`
    : '';
  return `${metric.source || 'Estimated data'}.${range}`;
}

function LastMonthMetric({ product }: { product: MarketProductApiRecord }) {
  const audienceLabel = product.lastMonthAudience.kind === 'app_downloads' ? 'APP downloads' : 'Registered users';
  const usesPaymentTraffic = product.lastMonthRevenue.source?.includes('Semrush payment traffic') ?? false;
  return (
    <div className="grid min-w-[205px] overflow-hidden rounded-[8px] border border-[#fffaf0]/9 bg-[#080909]">
      <div className="flex min-h-[39px] items-center justify-between gap-3 border-b border-[#fffaf0]/8 bg-[#78c889]/[0.055] px-3" title={metricTitle(product.lastMonthAudience)}>
        <span className="grid gap-0.5">
          <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[#78c889]/75">{audienceLabel}</span>
          <span className="text-[8px] text-[#fffaf0]/28">{formatPeriod(product.lastMonthAudience.period) || 'No period'}</span>
        </span>
        <strong className={`text-[13px] font-semibold tabular-nums ${product.lastMonthAudience.value === null ? 'text-[#fffaf0]/28' : 'text-[#8bd09a]'}`}>
          {formatMetric(product.lastMonthAudience.value)}
        </strong>
      </div>
      <div className="flex min-h-[39px] items-center justify-between gap-3 bg-[#f2c36b]/[0.055] px-3" title={metricTitle(product.lastMonthRevenue)}>
        <span className="grid gap-0.5">
          <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[#f2c36b]/78">Last month revenue</span>
          <span className="text-[8px] text-[#fffaf0]/28">{formatPeriod(product.lastMonthRevenue.period) || 'No period'}</span>
        </span>
        <strong className={`text-[13px] font-semibold tabular-nums ${product.lastMonthRevenue.value === null ? 'text-[#fffaf0]/28' : 'text-[#f2c36b]'}`}>
          {formatMetric(product.lastMonthRevenue.value, true)}
          {usesPaymentTraffic ? <sup className="ml-0.5 text-[7px] font-black text-[#f8dfaa]" aria-label="Estimated using payment-platform traffic">*</sup> : null}
        </strong>
      </div>
    </div>
  );
}

function TrafficTrend({ product }: { product: MarketProductApiRecord }) {
  const metrics = product.trafficTrend.filter((metric) => metric.value !== null);
  if (metrics.length < 2) {
    return <span className="text-[10px] font-medium text-[#fffaf0]/28">Not available</span>;
  }

  const width = 150;
  const height = 48;
  const inset = 4;
  const values = metrics.map((metric) => metric.value as number);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || Math.max(maximum, 1);
  const points = values.map((value, index) => ({
    x: inset + (index / (values.length - 1)) * (width - inset * 2),
    y: maximum === minimum
      ? height / 2
      : height - inset - ((value - minimum) / range) * (height - inset * 2),
  }));
  const pointString = points.map((point) => `${point.x},${point.y}`).join(' ');
  const rising = values.at(-1)! >= values[0];
  const color = rising ? '#78c889' : '#e86f61';

  return (
    <div className="grid min-w-[168px] gap-1.5" title="Similarweb monthly website traffic trend">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[48px] w-[150px] overflow-visible" role="img" aria-label="Three month Similarweb traffic trend">
        <line x1="0" x2={width} y1={height - 4} y2={height - 4} stroke="rgba(255,250,240,.08)" />
        <polyline points={pointString} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        {points.map((point, index) => (
          <circle key={`${product.id}-trend-${index}`} cx={point.x} cy={point.y} r={index === points.length - 1 ? 2.8 : 1.7} fill="#0b0c0c" stroke={color} strokeWidth="1.5" />
        ))}
      </svg>
      <span className="flex w-[150px] justify-between font-mono text-[8px] uppercase text-[#fffaf0]/27">
        {metrics.map((metric) => <span key={metric.month}>{metric.month.slice(5)}</span>)}
      </span>
    </div>
  );
}

function TagList({ values, tone = 'neutral' }: { values: string[]; tone?: 'neutral' | 'gold' }) {
  if (values.length === 0) return <span className="text-[10px] text-[#fffaf0]/28">Not available</span>;
  const shown = values.slice(0, 3);
  return (
    <div className="flex max-w-full flex-wrap gap-1.5">
      {shown.map((value) => (
        <span
          key={value}
          className={`inline-flex max-w-full truncate rounded-full border px-2 py-1 text-[8px] font-semibold ${tone === 'gold' ? 'border-[#f2c36b]/18 bg-[#f2c36b]/[0.055] text-[#f2c36b]/78' : 'border-[#fffaf0]/9 bg-[#fffaf0]/[0.035] text-[#fffaf0]/52'}`}
        >
          {value}
        </span>
      ))}
      {values.length > shown.length ? (
        <span className="inline-flex rounded-full border border-[#fffaf0]/8 px-2 py-1 text-[8px] font-semibold text-[#fffaf0]/30">+{values.length - shown.length}</span>
      ) : null}
    </div>
  );
}

export function ProductIntelligencePage() {
  const pathname = usePathname();
  const isDevelopmentPreview = pathname === '/product-intelligence-preview';
  const [draftFilters, setDraftFilters] = useState<FilterState>(initialFilters);
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [page, setPage] = useState(0);
  const [productRows, setProductRows] = useState<MarketProductApiRecord[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [filterOptions, setFilterOptions] = useState<MarketProductApiResponse['filterOptions']>({ topics: [], productTypes: [] });
  const [datasetStatus, setDatasetStatus] = useState<'loading' | 'rds' | 'error'>('loading');
  const [watchlisted, setWatchlisted] = useState(() => new Set<string>());

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({
      dataset: 'actual',
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      sort: filters.sort,
    });
    if (filters.query.trim()) query.set('q', filters.query.trim());
    if (filters.category !== 'all') query.set('category', filters.category);
    if (filters.productType !== 'all') query.set('productType', filters.productType);
    if (isDevelopmentPreview) query.set('preview', '1');
    const url = `/api/product-intelligence/products?${query.toString()}`;
    const cacheKey = `${WORKSPACE_CACHE_KEYS.productIntelligence}:${query.toString()}`;

    fetchWorkspaceJson<MarketProductApiResponse>(cacheKey, url, {}, { ttlMs: 30_000 })
      .then((payload) => {
        if (!active || !Array.isArray(payload.products)) return;
        setProductRows(payload.products);
        setTotalProducts(Number(payload.total) || 0);
        setFilterOptions(payload.filterOptions || { topics: [], productTypes: [] });
        setDatasetStatus('rds');
      })
      .catch((error) => {
        console.error('Failed to load product intelligence:', error);
        if (active) {
          setProductRows([]);
          setDatasetStatus('error');
        }
      });

    return () => {
      active = false;
    };
  }, [filters, isDevelopmentPreview, page]);

  const activeFilterCount = [filters.query, filters.category !== 'all', filters.productType !== 'all'].filter(Boolean).length;
  const startRow = totalProducts === 0 ? 0 : page * PAGE_SIZE + 1;
  const endRow = Math.min(totalProducts, page * PAGE_SIZE + productRows.length);
  const totalPages = Math.max(1, Math.ceil(totalProducts / PAGE_SIZE));
  const categoryOptions = useMemo(() => filterOptions.topics.slice(0, 80), [filterOptions.topics]);

  const updateDraft = <Key extends keyof FilterState>(key: Key, value: FilterState[Key]) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = () => {
    setDatasetStatus('loading');
    setPage(0);
    setFilters({ ...draftFilters });
  };

  const resetFilters = () => {
    setDatasetStatus('loading');
    setDraftFilters(initialFilters);
    setPage(0);
    setFilters({ ...initialFilters });
  };

  const toggleWatchlist = (id: string) => {
    setWatchlisted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-[#090a0a] text-[#fffaf0]">
      <div className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header className="border-b border-[#fffaf0]/10 pb-5">
          <h1 className="text-[24px] font-semibold tracking-[-0.04em] text-[#fffaf0] sm:text-[28px]">Minaco Business Database</h1>
          <p className="mt-2 max-w-5xl text-[12px] leading-5 text-[#fffaf0]/48 sm:text-[13px]">
            Minaco continuously tracks the user and revenue performance of new products launched on Product Hunt every day. Revenue performance is not derived from official PR or press releases; it is estimated from observed payment-platform traffic, user retention, industry benchmarks, and thousands of real-world business cases. If you cannot find the product you are looking for, start a Discussion with Minaco for an on-demand search and analysis.
          </p>
        </header>

        <section className="mt-5 rounded-[12px] border border-[#fffaf0]/10 bg-[#0d0e0e] p-4 shadow-[0_16px_50px_rgba(0,0,0,.18)]" aria-labelledby="product-filters-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="product-filters-heading" className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#fffaf0]/55">
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#f2c36b]" />
              Explore products
            </h2>
            {activeFilterCount > 0 ? <span className="rounded-full bg-[#f2c36b]/10 px-2 py-1 text-[9px] font-bold text-[#f2c36b]">{activeFilterCount} active</span> : null}
          </div>
          <form
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.8fr)_minmax(170px,1fr)_minmax(170px,1fr)_minmax(170px,1fr)_auto] xl:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilters();
            }}
          >
            <label className="grid min-w-0 gap-1.5 md:col-span-2 xl:col-span-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#fffaf0]/45">Name or keyword</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#fffaf0]/35" />
                <input
                  value={draftFilters.query}
                  onChange={(event) => updateDraft('query', event.target.value)}
                  placeholder="Search names, domains, topics, descriptions..."
                  className="h-10 w-full rounded-[8px] border border-[#fffaf0]/10 bg-[#0b0c0c] pl-9 pr-9 text-[12px] text-[#fffaf0] outline-none placeholder:text-[#fffaf0]/25 hover:border-[#fffaf0]/18 focus:border-[#f2c36b]/55 focus:ring-2 focus:ring-[#f2c36b]/10"
                />
                {draftFilters.query ? (
                  <button type="button" onClick={() => updateDraft('query', '')} className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-[6px] text-[#fffaf0]/35 hover:bg-[#fffaf0]/5 hover:text-[#fffaf0]" aria-label="Clear search">
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </span>
            </label>
            <SelectField label="Category · PH topic" value={draftFilters.category} onChange={(value) => updateDraft('category', value)}>
              <option value="all">All Product Hunt topics</option>
              {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.value} · {option.count}</option>)}
            </SelectField>
            <SelectField label="Product type" value={draftFilters.productType} onChange={(value) => updateDraft('productType', value)}>
              <option value="all">All product types</option>
              {filterOptions.productTypes.map((option) => <option key={option.value} value={option.value}>{option.value} · {option.count}</option>)}
            </SelectField>
            <SelectField label="Sort by" value={draftFilters.sort} onChange={(value) => updateDraft('sort', value as FilterState['sort'])}>
              <option value="rank">Intelligence rank</option>
              <option value="audience">Users / downloads</option>
              <option value="revenue">Last month revenue</option>
              <option value="trend">3-month momentum</option>
              <option value="newest">Newest launch</option>
            </SelectField>
            <div className="flex gap-2 md:col-span-2 xl:col-span-1">
              <button type="button" onClick={resetFilters} className="h-10 rounded-[8px] border border-[#fffaf0]/12 px-3 text-[11px] font-semibold text-[#fffaf0]/60 transition hover:border-[#fffaf0]/25 hover:bg-[#fffaf0]/5 hover:text-[#fffaf0]">Reset</button>
              <button type="submit" className="h-10 rounded-[8px] border border-[#f2c36b]/60 bg-[#f2c36b] px-4 text-[11px] font-bold text-[#100e0c] shadow-[0_8px_24px_rgba(242,195,107,.12)] transition hover:bg-[#f8dfaa]">Apply</button>
            </div>
          </form>
        </section>

        <section className="mt-4 overflow-hidden rounded-[12px] border border-[#fffaf0]/10 bg-[#0b0c0c] shadow-[0_18px_60px_rgba(0,0,0,.22)]" aria-label="Product intelligence results">
          <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 border-b border-[#fffaf0]/10 px-4">
            <div className="flex items-center gap-3">
              <strong className="text-[12px] font-semibold text-[#fffaf0]">All products</strong>
              <span className="rounded-full border border-[#fffaf0]/10 bg-[#fffaf0]/[0.03] px-2 py-0.5 text-[9px] font-semibold tabular-nums text-[#fffaf0]/42" aria-live="polite">
                {startRow.toLocaleString()}–{endRow.toLocaleString()} of {totalProducts.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-[#fffaf0]/35">
              <CalendarDays className="h-3.5 w-3.5" />
              <span>May–Jul 2026 Similarweb window</span>
            </div>
          </div>

          <div className={`overflow-x-auto transition-opacity ${datasetStatus === 'loading' ? 'opacity-55' : 'opacity-100'}`}>
            <table className="w-full min-w-[1580px] table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-[76px]" />
                <col className="w-[270px]" />
                <col className="w-[122px]" />
                <col className="w-[244px]" />
                <col className="w-[205px]" />
                <col className="w-[244px]" />
                <col className="w-[192px]" />
                <col />
              </colgroup>
              <thead className="bg-[#121312]">
                <tr className="h-11 border-b border-[#fffaf0]/10">
                  {[
                    ['Rank', true],
                    ['Product', false],
                    ['Launched', false],
                    ['Last month · users & revenue', true],
                    ['User scale · 3M', true],
                    ['Category · Product Hunt topics', false],
                    ['Product type', false],
                    ['Product introduction', false],
                  ].map(([label, sortable]) => (
                    <th key={String(label)} className="px-4 text-[9px] font-bold uppercase tracking-[0.13em] text-[#fffaf0]/38">
                      <span className="inline-flex items-center gap-1.5">{label}{sortable ? <ArrowUpDown className="h-3 w-3 text-[#fffaf0]/20" /> : null}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productRows.map((product) => (
                  <tr key={product.id} className="group h-[112px] border-b border-[#fffaf0]/[0.075] transition-colors last:border-0 hover:bg-[#fffaf0]/[0.025]">
                    <td className="px-4 align-middle"><span className="font-mono text-[11px] font-semibold tabular-nums text-[#fffaf0]/54">#{product.rank.toLocaleString()}</span></td>
                    <td className="px-4 align-middle">
                      <div className="flex items-center gap-3">
                        <ProductLogo product={product} />
                        <span className="grid min-w-0 gap-0.5">
                          <span className="flex items-center gap-1.5">
                            <strong className="truncate text-[13px] font-semibold text-[#fffaf0]">{product.name}</strong>
                            <button type="button" onClick={() => toggleWatchlist(product.id)} className={`grid h-6 w-6 shrink-0 place-items-center rounded-[6px] transition ${watchlisted.has(product.id) ? 'text-[#f2c36b]' : 'text-[#fffaf0]/22 hover:bg-[#fffaf0]/5 hover:text-[#fffaf0]/65'}`} aria-label={`${watchlisted.has(product.id) ? 'Remove' : 'Add'} ${product.name} ${watchlisted.has(product.id) ? 'from' : 'to'} watchlist`} aria-pressed={watchlisted.has(product.id)}>
                              <Bookmark className="h-3.5 w-3.5" fill={watchlisted.has(product.id) ? 'currentColor' : 'none'} />
                            </button>
                          </span>
                          {product.websiteUrl ? (
                            <a href={product.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit max-w-[185px] items-center gap-1 truncate font-mono text-[10px] text-[#f2c36b]/72 hover:text-[#f2c36b]">
                              <span className="truncate">{product.domain || product.websiteUrl}</span><ExternalLink className="h-2.5 w-2.5 shrink-0" />
                            </a>
                          ) : <span className="text-[10px] text-[#fffaf0]/28">Website not available</span>}
                          {product.productHuntUrl ? <a href={product.productHuntUrl} target="_blank" rel="noreferrer" className="w-fit text-[8px] font-bold uppercase tracking-[0.11em] text-[#fffaf0]/28 hover:text-[#fffaf0]/55">Product Hunt ↗</a> : null}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 align-middle"><time dateTime={product.launchedAt} className="font-mono text-[10px] tabular-nums text-[#fffaf0]/52">{formatLaunchDate(product.launchedAt)}</time></td>
                    <td className="px-4 align-middle"><LastMonthMetric product={product} /></td>
                    <td className="px-4 align-middle"><TrafficTrend product={product} /></td>
                    <td className="px-4 align-middle"><TagList values={product.topics} /></td>
                    <td className="px-4 align-middle"><TagList values={product.productTypes} tone="gold" /></td>
                    <td className="px-4 pr-6 align-middle"><p className="line-clamp-3 max-w-[390px] text-[10px] leading-[1.55] text-[#fffaf0]/45 group-hover:text-[#fffaf0]/62">{product.description || product.tagline || 'Not available'}</p></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {datasetStatus !== 'loading' && productRows.length === 0 ? (
            <div className="grid min-h-64 place-items-center px-6 py-12 text-center">
              <div>
                <Search className="mx-auto h-6 w-6 text-[#fffaf0]/22" />
                <h3 className="mt-3 text-[13px] font-semibold text-[#fffaf0]">{datasetStatus === 'error' ? 'Product data is temporarily unavailable' : 'No products match these filters'}</h3>
                <p className="mt-1 text-[11px] text-[#fffaf0]/42">{datasetStatus === 'error' ? 'Please retry after the data service reconnects.' : 'Try a broader keyword, topic, or product type.'}</p>
                {datasetStatus !== 'error' ? <button type="button" onClick={resetFilters} className="mt-4 rounded-[8px] border border-[#fffaf0]/12 px-3 py-2 text-[11px] font-semibold text-[#fffaf0]/65 hover:bg-[#fffaf0]/5 hover:text-[#fffaf0]">Clear all filters</button> : null}
              </div>
            </div>
          ) : null}

          <div className="flex min-h-[54px] flex-wrap items-center justify-between gap-3 border-t border-[#fffaf0]/10 bg-[#0d0e0e] px-4">
            <span className="text-[9px] text-[#fffaf0]/34">Website registrations and revenue are Minaco estimates; APP metrics are Appark estimates. * Revenue estimate uses observed payment-platform traffic. Hover a value for its source and range.</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page === 0 || datasetStatus === 'loading'} onClick={() => { setDatasetStatus('loading'); setPage((current) => Math.max(0, current - 1)); }} className="inline-flex h-8 items-center gap-1 rounded-[7px] border border-[#fffaf0]/10 px-2.5 text-[9px] font-semibold text-[#fffaf0]/52 hover:bg-[#fffaf0]/5 disabled:cursor-not-allowed disabled:opacity-30"><ArrowLeft className="h-3 w-3" /> Previous</button>
              <span className="min-w-[74px] text-center font-mono text-[9px] tabular-nums text-[#fffaf0]/38">{page + 1} / {totalPages}</span>
              <button type="button" disabled={page + 1 >= totalPages || datasetStatus === 'loading'} onClick={() => { setDatasetStatus('loading'); setPage((current) => Math.min(totalPages - 1, current + 1)); }} className="inline-flex h-8 items-center gap-1 rounded-[7px] border border-[#fffaf0]/10 px-2.5 text-[9px] font-semibold text-[#fffaf0]/52 hover:bg-[#fffaf0]/5 disabled:cursor-not-allowed disabled:opacity-30">Next <ArrowRight className="h-3 w-3" /></button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
