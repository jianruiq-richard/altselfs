'use client';

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  ExternalLink,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { MinacoBrandMark } from '@/components/minaco-brand-mark';
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
  sort: 'revenue',
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
      <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#fffaf0]/72">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-full appearance-none rounded-[8px] border border-[#fffaf0]/16 bg-[#0b0c0c] px-3 pr-9 text-[14px] font-medium text-[#fffaf0]/92 outline-none transition hover:border-[#fffaf0]/28 focus:border-[#f2c36b]/65 focus:ring-2 focus:ring-[#f2c36b]/12"
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#fffaf0]/55" />
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
  if (metric.value === null) {
    if (metric.source === 'Open Source') return 'Open-source product with no verified product-level paid revenue evidence.';
    if (metric.source === 'Free') return 'Free product with no verified product-level paid revenue evidence.';
    if (metric.source === 'Not available') return 'No material product-level revenue signal was detected.';
    return 'No verified product-level revenue estimate is available yet.';
  }
  const range = metric.low !== null && metric.high !== null
    ? ` Estimated range: ${fullNumber.format(metric.low)}–${fullNumber.format(metric.high)}.`
    : '';
  return `${metric.source || 'Estimated data'}.${range}`;
}

function LastMonthMetric({ product }: { product: MarketProductApiRecord }) {
  const audienceLabel = product.lastMonthAudience.kind === 'app_downloads' ? 'APP downloads' : 'New registrations';
  const usesPaymentTraffic = product.lastMonthRevenue.source?.includes('Semrush payment traffic') ?? false;
  const usesApparkRevenue = product.lastMonthRevenue.source === 'Appark estimate';
  const revenueMarker = usesApparkRevenue ? '**' : usesPaymentTraffic ? '*' : '';
  const revenueMarkerLabel = usesApparkRevenue
    ? 'Revenue estimate provided by Appark'
    : 'Estimated using payment-platform traffic';
  const revenueStatus = product.lastMonthRevenue.value === null
    ? product.lastMonthRevenue.source === 'Open Source' || product.lastMonthRevenue.source === 'Free'
      ? product.lastMonthRevenue.source
      : 'Almost none'
    : null;
  return (
    <div className="grid min-w-[205px] overflow-hidden rounded-[8px] border border-[#fffaf0]/14 bg-[#080909]">
      <div className="flex min-h-[47px] items-center justify-between gap-3 border-b border-[#fffaf0]/12 bg-[#78c889]/[0.075] px-3.5" title={metricTitle(product.lastMonthAudience)}>
        <span className="max-w-[118px] text-[11px] font-bold uppercase leading-4 tracking-[0.06em] text-[#8bd09a]">{audienceLabel}</span>
        <strong className={`text-[17px] font-semibold tabular-nums ${product.lastMonthAudience.value === null ? 'text-[#fffaf0]/48' : 'text-[#8bd09a]'}`}>
          {formatMetric(product.lastMonthAudience.value)}
        </strong>
      </div>
      <div className="flex min-h-[47px] items-center justify-between gap-3 bg-[#f2c36b]/[0.075] px-3.5" title={metricTitle(product.lastMonthRevenue)}>
        <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#f2c36b]">Last month revenue</span>
        <strong className={`${revenueStatus ? 'text-[13px] uppercase tracking-[0.04em]' : 'text-[17px] tabular-nums'} font-semibold ${product.lastMonthRevenue.value === null ? revenueStatus ? 'text-[#f2c36b]' : 'text-[#fffaf0]/48' : 'text-[#f2c36b]'}`}>
          {revenueStatus || formatMetric(product.lastMonthRevenue.value, true)}
          {revenueMarker ? <sup className="ml-0.5 text-[8px] font-black tracking-[-0.08em] text-[#fff0c7]" aria-label={revenueMarkerLabel}>{revenueMarker}</sup> : null}
        </strong>
      </div>
    </div>
  );
}

function TrafficTrend({ product }: { product: MarketProductApiRecord }) {
  const metrics = product.trafficTrend.filter((metric) => metric.value !== null);
  if (metrics.length < 2) {
    return <span className="text-[12px] font-medium text-[#fffaf0]/52">Not available</span>;
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
        <line x1="0" x2={width} y1={height - 4} y2={height - 4} stroke="rgba(255,250,240,.16)" />
        <polyline points={pointString} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
        {points.map((point, index) => (
          <circle key={`${product.id}-trend-${index}`} cx={point.x} cy={point.y} r={index === points.length - 1 ? 2.8 : 1.7} fill="#0b0c0c" stroke={color} strokeWidth="1.5" />
        ))}
      </svg>
      <span className="flex w-[150px] justify-between font-mono text-[10px] font-medium uppercase text-[#fffaf0]/58">
        {metrics.map((metric) => <span key={metric.month}>{metric.month.slice(5)}</span>)}
      </span>
    </div>
  );
}

function TagList({ values, tone = 'neutral' }: { values: string[]; tone?: 'neutral' | 'gold' }) {
  if (values.length === 0) return <span className="text-[12px] text-[#fffaf0]/52">Not available</span>;
  const shown = values.slice(0, 3);
  return (
    <div className="flex max-w-full flex-wrap gap-1.5">
      {shown.map((value) => (
        <span
          key={value}
          className={`inline-flex max-w-full truncate rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone === 'gold' ? 'border-[#f2c36b]/28 bg-[#f2c36b]/[0.08] text-[#f2c36b]/92' : 'border-[#fffaf0]/16 bg-[#fffaf0]/[0.05] text-[#fffaf0]/72'}`}
        >
          {value}
        </span>
      ))}
      {values.length > shown.length ? (
        <span className="inline-flex rounded-full border border-[#fffaf0]/14 px-2.5 py-1 text-[11px] font-semibold text-[#fffaf0]/62">+{values.length - shown.length}</span>
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
  const askMinacoHref = '/investor/chat/100?newDiscussion=1';

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

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-[#090a0a] text-[#fffaf0]">
      <div className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header className="border-b border-[#fffaf0]/10 pb-5">
          <h1 className="text-[24px] font-semibold tracking-[-0.04em] text-[#fffaf0] sm:text-[28px]">Minaco Business Database</h1>
          <p className="mt-2 max-w-6xl text-[14px] leading-6 text-[#fffaf0]/68 sm:text-[15px]">
            Minaco continuously tracks the user and revenue performance of new products launched on Product Hunt every day. Revenue performance is not derived from official PR or press releases; it is estimated from observed payment-platform traffic, user retention, industry benchmarks, and thousands of real-world business cases. If you cannot find the product you are looking for, start a Discussion with Minaco for an on-demand search and analysis.
          </p>
        </header>

        <section className="mt-5 rounded-[12px] border border-[#fffaf0]/10 bg-[#0d0e0e] p-4 shadow-[0_16px_50px_rgba(0,0,0,.18)]" aria-labelledby="product-filters-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="product-filters-heading" className="inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#fffaf0]/80">
              <SlidersHorizontal className="h-4 w-4 text-[#f2c36b]" />
              Explore products
            </h2>
            {activeFilterCount > 0 ? <span className="rounded-full bg-[#f2c36b]/12 px-2.5 py-1 text-[11px] font-bold text-[#f2c36b]">{activeFilterCount} active</span> : null}
          </div>
          <form
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.8fr)_minmax(170px,1fr)_minmax(170px,1fr)_minmax(170px,1fr)_auto] xl:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilters();
            }}
          >
            <label className="grid min-w-0 gap-1.5 md:col-span-2 xl:col-span-1">
              <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#fffaf0]/72">Name or keyword</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#fffaf0]/55" />
                <input
                  value={draftFilters.query}
                  onChange={(event) => updateDraft('query', event.target.value)}
                  placeholder="Search names, domains, topics, descriptions..."
                  className="h-11 w-full rounded-[8px] border border-[#fffaf0]/16 bg-[#0b0c0c] pl-9 pr-9 text-[14px] text-[#fffaf0] outline-none placeholder:text-[#fffaf0]/48 hover:border-[#fffaf0]/28 focus:border-[#f2c36b]/65 focus:ring-2 focus:ring-[#f2c36b]/12"
                />
                {draftFilters.query ? (
                  <button type="button" onClick={() => updateDraft('query', '')} className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-[6px] text-[#fffaf0]/55 hover:bg-[#fffaf0]/8 hover:text-[#fffaf0]" aria-label="Clear search">
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
              <button type="button" onClick={resetFilters} className="h-11 rounded-[8px] border border-[#fffaf0]/18 px-3.5 text-[13px] font-semibold text-[#fffaf0]/78 transition hover:border-[#fffaf0]/30 hover:bg-[#fffaf0]/7 hover:text-[#fffaf0]">Reset</button>
              <button type="submit" className="h-11 rounded-[8px] border border-[#f2c36b]/70 bg-[#f2c36b] px-5 text-[13px] font-bold text-[#100e0c] shadow-[0_8px_24px_rgba(242,195,107,.15)] transition hover:bg-[#f8dfaa]">Apply</button>
            </div>
          </form>
        </section>

        <section className="mt-4 overflow-hidden rounded-[12px] border border-[#fffaf0]/10 bg-[#0b0c0c] shadow-[0_18px_60px_rgba(0,0,0,.22)]" aria-label="Product intelligence results">
          <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 border-b border-[#fffaf0]/10 px-4">
            <div className="flex items-center gap-3">
              <strong className="text-[14px] font-semibold text-[#fffaf0]">All products</strong>
              <span className="rounded-full border border-[#fffaf0]/16 bg-[#fffaf0]/[0.045] px-2.5 py-1 text-[12px] font-semibold tabular-nums text-[#fffaf0]/68" aria-live="polite">
                {startRow.toLocaleString()}–{endRow.toLocaleString()} of {totalProducts.toLocaleString()}
              </span>
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
                <tr className="h-12 border-b border-[#fffaf0]/14">
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
                    <th key={String(label)} className="px-4 text-[11px] font-bold uppercase tracking-[0.1em] text-[#fffaf0]/68">
                      <span className="inline-flex items-center gap-1.5">{label}{sortable ? <ArrowUpDown className="h-3.5 w-3.5 text-[#fffaf0]/42" /> : null}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productRows.map((product) => (
                  <tr key={product.id} className="group h-[124px] border-b border-[#fffaf0]/[0.1] transition-colors last:border-0 hover:bg-[#fffaf0]/[0.035]">
                    <td className="px-4 align-middle"><span className="font-mono text-[13px] font-semibold tabular-nums text-[#fffaf0]/72">#{product.rank.toLocaleString()}</span></td>
                    <td className="px-4 align-middle">
                      <div className="flex items-center gap-3">
                        <ProductLogo product={product} />
                        <span className="grid min-w-0 gap-0.5">
                          {product.productHuntUrl ? (
                            <a
                              href={product.productHuntUrl}
                              target="_blank"
                              rel="noreferrer"
                              title={`View ${product.name} on Product Hunt`}
                              className="truncate text-[14px] font-semibold text-[#fffaf0] transition hover:text-[#f2c36b]"
                            >
                              {product.name}
                            </a>
                          ) : <strong className="truncate text-[14px] font-semibold text-[#fffaf0]">{product.name}</strong>}
                          {product.websiteUrl ? (
                            <a href={product.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit max-w-[185px] items-center gap-1 truncate font-mono text-[12px] text-[#f2c36b]/90 hover:text-[#f8dfaa]">
                              <span className="truncate">{product.domain || product.websiteUrl}</span><ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          ) : <span className="text-[12px] text-[#fffaf0]/52">Website not available</span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 align-middle"><time dateTime={product.launchedAt} className="font-mono text-[12px] font-medium tabular-nums text-[#fffaf0]/68">{formatLaunchDate(product.launchedAt)}</time></td>
                    <td className="px-4 align-middle"><LastMonthMetric product={product} /></td>
                    <td className="px-4 align-middle"><TrafficTrend product={product} /></td>
                    <td className="px-4 align-middle"><TagList values={product.topics} /></td>
                    <td className="px-4 align-middle"><TagList values={product.productTypes} tone="gold" /></td>
                    <td className="px-4 pr-6 align-middle">
                      <p
                        className="line-clamp-3 max-w-[390px] cursor-help text-[12px] leading-[1.6] text-[#fffaf0]/68 group-hover:text-[#fffaf0]/84"
                        title={product.description || product.tagline || 'Not available'}
                      >
                        {product.description || product.tagline || 'Not available'}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {datasetStatus !== 'loading' && productRows.length === 0 ? (
            <div className="grid min-h-64 place-items-center px-6 py-12 text-center">
              <div>
                <Search className="mx-auto h-6 w-6 text-[#fffaf0]/22" />
                <h3 className="mt-3 text-[15px] font-semibold text-[#fffaf0]">{datasetStatus === 'error' ? 'Product data is temporarily unavailable' : "No products in Minaco's tracking database match these filters"}</h3>
                <p className="mt-1.5 text-[13px] text-[#fffaf0]/65">{datasetStatus === 'error' ? 'Please retry after the data service reconnects.' : 'Ask Minaco to research this product for you now.'}</p>
                {datasetStatus !== 'error' ? (
                  <Link
                    href={askMinacoHref}
                    className="mx-auto mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-[9px] border border-[#f6d993]/70 bg-[#e9b85a] px-5 text-[13px] font-bold text-[#171107] shadow-[0_10px_30px_rgba(233,184,90,.18)] transition hover:border-[#ffe7ad] hover:bg-[#f2c36b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f2c36b]/45"
                  >
                    <MinacoBrandMark className="block h-5 w-5 shrink-0 overflow-hidden rounded-[5px]" imageClassName="h-full w-full object-contain" decorative={false} />
                    Ask Minaco about this product
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-t border-[#fffaf0]/12 bg-[#0d0e0e] px-4">
            <span className="text-[11px] leading-5 text-[#fffaf0]/62">Website registrations and revenue are Minaco estimates. Open Source and Free replace unsupported revenue figures when no product-level paid evidence exists. * Uses observed payment-platform traffic. ** App revenue estimate provided by Appark.</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page === 0 || datasetStatus === 'loading'} onClick={() => { setDatasetStatus('loading'); setPage((current) => Math.max(0, current - 1)); }} className="inline-flex h-9 items-center gap-1 rounded-[7px] border border-[#fffaf0]/16 px-3 text-[11px] font-semibold text-[#fffaf0]/72 hover:bg-[#fffaf0]/7 disabled:cursor-not-allowed disabled:opacity-40"><ArrowLeft className="h-3.5 w-3.5" /> Previous</button>
              <label className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-[#fffaf0]/16 bg-[#090a0a] pl-3 pr-2 text-[11px] font-medium text-[#fffaf0]/62">
                <span>Page</span>
                <span className="relative">
                  <select
                    aria-label="Go to page"
                    value={page}
                    disabled={datasetStatus === 'loading'}
                    onChange={(event) => {
                      setDatasetStatus('loading');
                      setPage(Number(event.target.value));
                    }}
                    className="h-7 min-w-[50px] appearance-none rounded-[5px] border border-[#fffaf0]/14 bg-[#111212] pl-2 pr-6 font-mono text-[11px] font-semibold tabular-nums text-[#fffaf0] outline-none hover:border-[#fffaf0]/28 focus:border-[#f2c36b]/65 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {Array.from({ length: totalPages }, (_, index) => (
                      <option key={index} value={index}>{index + 1}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[#fffaf0]/55" />
                </span>
                <span>of {totalPages}</span>
              </label>
              <button type="button" disabled={page + 1 >= totalPages || datasetStatus === 'loading'} onClick={() => { setDatasetStatus('loading'); setPage((current) => Math.min(totalPages - 1, current + 1)); }} className="inline-flex h-9 items-center gap-1 rounded-[7px] border border-[#fffaf0]/16 px-3 text-[11px] font-semibold text-[#fffaf0]/72 hover:bg-[#fffaf0]/7 disabled:cursor-not-allowed disabled:opacity-40">Next <ArrowRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
