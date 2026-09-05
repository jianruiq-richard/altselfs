'use client';

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  CalendarDays,
  ChevronDown,
  Columns3,
  ExternalLink,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { fetchWorkspaceJson, WORKSPACE_CACHE_KEYS } from '@/lib/workspace-client-cache';

type TrendDirection = 'up' | 'down';
type ProductCategory = 'AI Development' | 'Creative AI' | 'Productivity' | 'Sales & GTM';

type ProductRecord = {
  id: string;
  rank: number;
  name: string;
  domain: string;
  href: string;
  launchDate: string;
  category: ProductCategory;
  description: string;
  mark: string;
  markClassName: string;
  traffic: number[];
  trafficLabel: string;
  trafficGrowth: number;
  revenue: number[];
  revenueLabel: string;
  revenueGrowth: number;
  watchlisted?: boolean;
};

type FilterState = {
  query: string;
  category: 'all' | ProductCategory;
  launchWindow: 'all' | '1y' | '3y' | 'older';
  momentum: 'all' | 'fast' | 'steady' | 'cooling';
  sort: 'rank' | 'traffic' | 'traffic-growth' | 'revenue' | 'revenue-growth' | 'newest';
};

const initialFilters: FilterState = {
  query: '',
  category: 'all',
  launchWindow: 'all',
  momentum: 'all',
  sort: 'rank',
};

const fallbackProducts: ProductRecord[] = [
  {
    id: 'lovable',
    rank: 1,
    name: 'Lovable',
    domain: 'lovable.dev',
    href: 'https://lovable.dev',
    launchDate: '2023-11-29',
    category: 'AI Development',
    description: 'AI software builder that turns natural-language product ideas into editable full-stack applications.',
    mark: 'L',
    markClassName: 'bg-[linear-gradient(145deg,#ff5a7d,#8b5cf6_55%,#3b82f6)] text-white',
    traffic: [12.4, 15.7, 22.1, 28.8, 35.4, 42.8],
    trafficLabel: '42.8M',
    trafficGrowth: 20.9,
    revenue: [4.2, 5.4, 8.1, 10.6, 13.8, 17.2],
    revenueLabel: '$17.2M',
    revenueGrowth: 24.6,
    watchlisted: true,
  },
  {
    id: 'higgsfield',
    rank: 2,
    name: 'Higgsfield',
    domain: 'higgsfield.ai',
    href: 'https://higgsfield.ai',
    launchDate: '2023-07-12',
    category: 'Creative AI',
    description: 'Generative video platform focused on cinematic camera motion, social formats, and controllable visual effects.',
    mark: 'H',
    markClassName: 'bg-[#d9ff44] text-[#101309]',
    traffic: [2.8, 3.1, 4.4, 6.7, 10.2, 18.6],
    trafficLabel: '18.6M',
    trafficGrowth: 82.4,
    revenue: [0.5, 0.9, 1.2, 2.1, 3.4, 5.7],
    revenueLabel: '$5.7M',
    revenueGrowth: 67.6,
  },
  {
    id: 'gamma',
    rank: 3,
    name: 'Gamma',
    domain: 'gamma.app',
    href: 'https://gamma.app',
    launchDate: '2020-11-16',
    category: 'Productivity',
    description: 'AI-native presentation and document workspace for creating polished narratives without manual layout work.',
    mark: 'G',
    markClassName: 'bg-[linear-gradient(145deg,#8b5cf6,#5b7cff)] text-white',
    traffic: [21.8, 23.6, 24.4, 28.9, 31.7, 34.1],
    trafficLabel: '34.1M',
    trafficGrowth: 7.6,
    revenue: [7.8, 8.4, 9.2, 10.6, 11.7, 12.9],
    revenueLabel: '$12.9M',
    revenueGrowth: 10.3,
    watchlisted: true,
  },
  {
    id: 'clay',
    rank: 4,
    name: 'Clay',
    domain: 'clay.com',
    href: 'https://clay.com',
    launchDate: '2017-02-01',
    category: 'Sales & GTM',
    description: 'GTM data enrichment and workflow platform that combines research signals, providers, and AI-led personalization.',
    mark: 'C',
    markClassName: 'bg-[#f05a32] text-white',
    traffic: [3.4, 3.9, 4.8, 5.1, 6.2, 7.5],
    trafficLabel: '7.5M',
    trafficGrowth: 21.0,
    revenue: [9.1, 10.8, 12.6, 14.4, 17.1, 19.8],
    revenueLabel: '$19.8M',
    revenueGrowth: 15.8,
  },
  {
    id: 'granola',
    rank: 5,
    name: 'Granola',
    domain: 'granola.ai',
    href: 'https://granola.ai',
    launchDate: '2023-05-18',
    category: 'Productivity',
    description: 'AI meeting notebook that enhances a user’s own notes with transcript context and shareable summaries.',
    mark: 'g',
    markClassName: 'bg-[#f4e9d8] font-serif text-[#222018]',
    traffic: [0.8, 1.1, 1.5, 2.1, 2.9, 4.2],
    trafficLabel: '4.2M',
    trafficGrowth: 44.8,
    revenue: [0.4, 0.6, 0.9, 1.2, 1.8, 2.6],
    revenueLabel: '$2.6M',
    revenueGrowth: 44.4,
  },
  {
    id: 'replit',
    rank: 6,
    name: 'Replit',
    domain: 'replit.com',
    href: 'https://replit.com',
    launchDate: '2016-03-15',
    category: 'AI Development',
    description: 'Browser-based software creation platform with collaborative coding, deployment, and autonomous agent workflows.',
    mark: 'R',
    markClassName: 'bg-[#f26822] text-white',
    traffic: [14.9, 15.7, 18.6, 17.8, 19.2, 20.1],
    trafficLabel: '20.1M',
    trafficGrowth: 4.7,
    revenue: [8.5, 8.9, 9.8, 10.1, 10.9, 11.4],
    revenueLabel: '$11.4M',
    revenueGrowth: 4.6,
  },
  {
    id: 'napkin',
    rank: 7,
    name: 'Napkin AI',
    domain: 'napkin.ai',
    href: 'https://napkin.ai',
    launchDate: '2024-08-07',
    category: 'Creative AI',
    description: 'Visual communication tool that converts text into editable diagrams, illustrations, and presentation-ready graphics.',
    mark: 'N',
    markClassName: 'bg-[#fff9eb] text-[#ee552f]',
    traffic: [0.9, 2.6, 3.4, 4.1, 3.8, 4.6],
    trafficLabel: '4.6M',
    trafficGrowth: 21.1,
    revenue: [0.2, 0.4, 0.8, 1.1, 1.0, 1.3],
    revenueLabel: '$1.3M',
    revenueGrowth: 30.0,
  },
  {
    id: 'wispr-flow',
    rank: 8,
    name: 'Wispr Flow',
    domain: 'wisprflow.ai',
    href: 'https://wisprflow.ai',
    launchDate: '2024-02-14',
    category: 'Productivity',
    description: 'Voice-first writing layer that turns fast natural speech into clean, formatted text across desktop applications.',
    mark: 'W',
    markClassName: 'bg-[#f0edff] text-[#6647ed]',
    traffic: [1.2, 1.5, 2.4, 3.2, 4.9, 6.8],
    trafficLabel: '6.8M',
    trafficGrowth: 38.8,
    revenue: [0.3, 0.5, 0.8, 1.2, 1.7, 2.3],
    revenueLabel: '$2.3M',
    revenueGrowth: 35.3,
  },
];

type MarketProductApiRecord = {
  id: string;
  rank: number;
  name: string;
  domain: string;
  websiteUrl: string;
  logoUrl: string | null;
  launchedAt: string;
  category: string;
  description: string;
  monthlyTraffic: number;
  trafficGrowthPct: number;
  monthlyNewRevenueUsd: number;
  revenueGrowthPct: number;
  confidence: string;
  isMock: boolean;
  metricsUpdatedAt: string;
  metrics: Array<{
    month: string;
    trafficVisits: number;
    estimatedMonthlyUsers: number;
    estimatedNewRevenueUsd: number;
    revenueLowUsd: number;
    revenueHighUsd: number;
    confidence: string;
  }>;
};

type MarketProductApiResponse = {
  products: MarketProductApiRecord[];
  total: number;
  generatedAt: string;
  source: string;
  mock: boolean;
};

const productCategories: ProductCategory[] = ['AI Development', 'Creative AI', 'Productivity', 'Sales & GTM'];

const markClassNames: Record<ProductCategory, string> = {
  'AI Development': 'bg-[#d9ff44] text-[#101309]',
  'Creative AI': 'bg-[linear-gradient(145deg,#ff5a7d,#8b5cf6_55%,#3b82f6)] text-white',
  Productivity: 'bg-[#f4e9d8] text-[#222018]',
  'Sales & GTM': 'bg-[#f05a32] text-white',
};

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function normalizeCategory(value: string): ProductCategory {
  return productCategories.includes(value as ProductCategory) ? value as ProductCategory : 'Productivity';
}

function normalizeSeries(values: number[], current: number) {
  const valid = values.filter(Number.isFinite);
  return valid.length >= 2 ? valid : Array.from({ length: 6 }, () => current);
}

function mapApiProduct(product: MarketProductApiRecord, index: number): ProductRecord {
  const category = normalizeCategory(product.category);
  const traffic = normalizeSeries(product.metrics.map((metric) => Number(metric.trafficVisits)), Number(product.monthlyTraffic) || 0);
  const revenue = normalizeSeries(product.metrics.map((metric) => Number(metric.estimatedNewRevenueUsd)), Number(product.monthlyNewRevenueUsd) || 0);
  const trafficCurrent = Number(product.monthlyTraffic) || traffic.at(-1) || 0;
  const revenueCurrent = Number(product.monthlyNewRevenueUsd) || revenue.at(-1) || 0;

  return {
    id: product.id,
    rank: Number(product.rank) || index + 1,
    name: product.name,
    domain: product.domain,
    href: product.websiteUrl || `https://${product.domain}`,
    launchDate: product.launchedAt.slice(0, 10),
    category,
    description: product.description,
    mark: product.name.slice(0, 1).toUpperCase(),
    markClassName: markClassNames[category],
    traffic,
    trafficLabel: compactNumber.format(trafficCurrent),
    trafficGrowth: Number(product.trafficGrowthPct) || 0,
    revenue,
    revenueLabel: `$${compactNumber.format(revenueCurrent)}`,
    revenueGrowth: Number(product.revenueGrowthPct) || 0,
  };
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

function formatLaunchDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

function Sparkline({
  id,
  values,
  label,
  growth,
  color,
}: {
  id: string;
  values: number[];
  label: string;
  growth: number;
  color: string;
}) {
  const width = 116;
  const height = 38;
  const inset = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = inset + (index / (values.length - 1)) * (width - inset * 2);
    const y = height - inset - ((value - min) / range) * (height - inset * 2);
    return { x, y };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `M ${points[0].x} ${height - inset} L ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} L ${points[points.length - 1].x} ${height - inset} Z`;
  const direction: TrendDirection = growth >= 0 ? 'up' : 'down';

  return (
    <div className="flex min-w-[184px] items-center gap-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[38px] w-[116px] shrink-0 overflow-visible"
        role="img"
        aria-label={`Six month trend ending at ${label}, ${Math.abs(growth).toFixed(1)} percent ${direction}`}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={width} y1={height - 3} y2={height - 3} stroke="rgba(255,250,240,.08)" />
        <path d={area} fill={`url(#${id}-fill)`} />
        <polyline points={line} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        {points.map((point, index) => (
          <circle
            key={`${id}-${index}`}
            cx={point.x}
            cy={point.y}
            r={index === points.length - 1 ? 2.6 : 1.35}
            fill={index === points.length - 1 ? color : '#0d0e0e'}
            stroke={color}
            strokeWidth="1.25"
          />
        ))}
      </svg>
      <span className="grid min-w-[58px] gap-0.5">
        <strong className="text-[12px] font-semibold tabular-nums text-[#fffaf0]/92">{label}</strong>
        <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums ${growth >= 0 ? 'text-[#78c889]' : 'text-[#e86f61]'}`}>
          {growth >= 0 ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
          {Math.abs(growth).toFixed(1)}%
        </span>
      </span>
    </div>
  );
}

function trafficValue(product: ProductRecord) {
  return product.traffic.at(-1) || 0;
}

function revenueValue(product: ProductRecord) {
  return product.revenue.at(-1) || 0;
}

function withinLaunchWindow(launchDate: string, launchWindow: FilterState['launchWindow']) {
  if (launchWindow === 'all') return true;
  const yearsOld = (Date.now() - new Date(`${launchDate}T00:00:00`).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (launchWindow === '1y') return yearsOld <= 1;
  if (launchWindow === '3y') return yearsOld > 1 && yearsOld <= 3;
  return yearsOld > 3;
}

function matchesMomentum(product: ProductRecord, momentum: FilterState['momentum']) {
  if (momentum === 'all') return true;
  const averageGrowth = (product.trafficGrowth + product.revenueGrowth) / 2;
  if (momentum === 'fast') return averageGrowth >= 30;
  if (momentum === 'steady') return averageGrowth >= 5 && averageGrowth < 30;
  return averageGrowth < 5;
}

export function ProductIntelligencePage() {
  const pathname = usePathname();
  const isDevelopmentPreview = pathname === '/product-intelligence-preview';
  const [draftFilters, setDraftFilters] = useState<FilterState>(initialFilters);
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [productRows, setProductRows] = useState<ProductRecord[]>(fallbackProducts);
  const [totalProducts, setTotalProducts] = useState(fallbackProducts.length);
  const [datasetStatus, setDatasetStatus] = useState<'loading' | 'rds' | 'fallback'>('loading');
  const [datasetUpdatedAt, setDatasetUpdatedAt] = useState<string | null>(null);
  const [watchlisted, setWatchlisted] = useState(() => new Set(fallbackProducts.filter((product) => product.watchlisted).map((product) => product.id)));

  useEffect(() => {
    let active = true;
    const previewQuery = isDevelopmentPreview ? '&preview=1' : '';
    const cacheKey = isDevelopmentPreview
      ? `${WORKSPACE_CACHE_KEYS.productIntelligence}:preview`
      : WORKSPACE_CACHE_KEYS.productIntelligence;

    fetchWorkspaceJson<MarketProductApiResponse>(
      cacheKey,
      `/api/product-intelligence/products?limit=100${previewQuery}`,
      {},
      { ttlMs: 30_000 },
    ).then((payload) => {
      if (!active || !Array.isArray(payload.products) || payload.products.length === 0) return;
      setProductRows(payload.products.map(mapApiProduct));
      setTotalProducts(Number(payload.total) || payload.products.length);
      setDatasetUpdatedAt(payload.generatedAt || null);
      setDatasetStatus('rds');
    }).catch((error) => {
      console.error('Using local product intelligence fallback:', error);
      if (active) setDatasetStatus('fallback');
    });

    return () => {
      active = false;
    };
  }, [isDevelopmentPreview]);

  const visibleProducts = useMemo(() => {
    const normalizedQuery = filters.query.trim().toLowerCase();
    const filtered = productRows.filter((product) => {
      const searchable = `${product.name} ${product.domain} ${product.category} ${product.description}`.toLowerCase();
      return (
        (!normalizedQuery || searchable.includes(normalizedQuery)) &&
        (filters.category === 'all' || product.category === filters.category) &&
        withinLaunchWindow(product.launchDate, filters.launchWindow) &&
        matchesMomentum(product, filters.momentum)
      );
    });

    return filtered.toSorted((a, b) => {
      if (filters.sort === 'traffic') return trafficValue(b) - trafficValue(a);
      if (filters.sort === 'traffic-growth') return b.trafficGrowth - a.trafficGrowth;
      if (filters.sort === 'revenue') return revenueValue(b) - revenueValue(a);
      if (filters.sort === 'revenue-growth') return b.revenueGrowth - a.revenueGrowth;
      if (filters.sort === 'newest') return b.launchDate.localeCompare(a.launchDate);
      return a.rank - b.rank;
    });
  }, [filters, productRows]);

  const activeFilterCount = [filters.query, filters.category !== 'all', filters.launchWindow !== 'all', filters.momentum !== 'all'].filter(Boolean).length;

  const updateDraft = <Key extends keyof FilterState>(key: Key, value: FilterState[Key]) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const resetFilters = () => {
    setDraftFilters(initialFilters);
    setFilters(initialFilters);
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
      <div className="mx-auto w-full max-w-[1720px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header className="flex flex-col gap-4 border-b border-[#fffaf0]/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f2c36b]/20 bg-[#f2c36b]/[0.07] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#f2c36b]">
                <Sparkles className="h-3 w-3" />
                {datasetStatus === 'rds' ? 'Alibaba RDS · mock data' : datasetStatus === 'loading' ? 'Loading Alibaba RDS' : 'Local fallback data'}
              </span>
              <span className="text-[10px] font-medium text-[#fffaf0]/34">
                {datasetUpdatedAt ? `Loaded ${new Date(datasetUpdatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : 'Connecting to the data service'}
              </span>
            </div>
            <h1 className="text-[24px] font-semibold tracking-[-0.04em] text-[#fffaf0] sm:text-[28px]">Product Intelligence</h1>
            <p className="mt-1 max-w-2xl text-[12px] leading-5 text-[#fffaf0]/48 sm:text-[13px]">
              A living index of product launches, growth signals, traffic momentum, and estimated new revenue.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-[8px] border border-[#fffaf0]/10 bg-[#fffaf0]/[0.025] px-3 py-2 text-right">
              <strong className="block text-[14px] font-semibold tabular-nums text-[#fffaf0]">{totalProducts.toLocaleString()}</strong>
              <span className="block text-[9px] uppercase tracking-[0.14em] text-[#fffaf0]/35">Tracked products</span>
            </div>
            <div className="rounded-[8px] border border-[#fffaf0]/10 bg-[#fffaf0]/[0.025] px-3 py-2 text-right">
              <strong className="block text-[14px] font-semibold tabular-nums text-[#78c889]">+{productRows.length}</strong>
              <span className="block text-[9px] uppercase tracking-[0.14em] text-[#fffaf0]/35">Updated today</span>
            </div>
          </div>
        </header>

        <section className="mt-5 rounded-[12px] border border-[#fffaf0]/10 bg-[#0d0e0e] p-4 shadow-[0_16px_50px_rgba(0,0,0,.18)]" aria-labelledby="product-filters-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="product-filters-heading" className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#fffaf0]/55">
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#f2c36b]" />
              Explore products
            </h2>
            {activeFilterCount > 0 ? (
              <span className="rounded-full bg-[#f2c36b]/10 px-2 py-1 text-[9px] font-bold text-[#f2c36b]">{activeFilterCount} active</span>
            ) : null}
          </div>
          <form
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1.8fr)_repeat(4,minmax(132px,1fr))_auto] xl:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              setFilters(draftFilters);
            }}
          >
            <label className="grid min-w-0 gap-1.5 md:col-span-2 xl:col-span-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#fffaf0]/45">Name or keyword</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#fffaf0]/35" />
                <input
                  value={draftFilters.query}
                  onChange={(event) => updateDraft('query', event.target.value)}
                  placeholder="Search products, domains, descriptions..."
                  className="h-10 w-full rounded-[8px] border border-[#fffaf0]/10 bg-[#0b0c0c] pl-9 pr-9 text-[12px] text-[#fffaf0] outline-none placeholder:text-[#fffaf0]/25 hover:border-[#fffaf0]/18 focus:border-[#f2c36b]/55 focus:ring-2 focus:ring-[#f2c36b]/10"
                />
                {draftFilters.query ? (
                  <button
                    type="button"
                    onClick={() => updateDraft('query', '')}
                    className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-[6px] text-[#fffaf0]/35 hover:bg-[#fffaf0]/5 hover:text-[#fffaf0]"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </span>
            </label>
            <SelectField label="Category" value={draftFilters.category} onChange={(value) => updateDraft('category', value as FilterState['category'])}>
              <option value="all">All categories</option>
              <option value="AI Development">AI development</option>
              <option value="Creative AI">Creative AI</option>
              <option value="Productivity">Productivity</option>
              <option value="Sales & GTM">Sales &amp; GTM</option>
            </SelectField>
            <SelectField label="Launch date" value={draftFilters.launchWindow} onChange={(value) => updateDraft('launchWindow', value as FilterState['launchWindow'])}>
              <option value="all">Any launch date</option>
              <option value="1y">Within 1 year</option>
              <option value="3y">1–3 years ago</option>
              <option value="older">More than 3 years</option>
            </SelectField>
            <SelectField label="Momentum" value={draftFilters.momentum} onChange={(value) => updateDraft('momentum', value as FilterState['momentum'])}>
              <option value="all">All momentum</option>
              <option value="fast">Fast growing</option>
              <option value="steady">Steady growth</option>
              <option value="cooling">Cooling</option>
            </SelectField>
            <SelectField label="Sort by" value={draftFilters.sort} onChange={(value) => updateDraft('sort', value as FilterState['sort'])}>
              <option value="rank">Intelligence rank</option>
              <option value="traffic">Monthly traffic</option>
              <option value="traffic-growth">Traffic growth</option>
              <option value="revenue">New revenue</option>
              <option value="revenue-growth">Revenue growth</option>
              <option value="newest">Newest launch</option>
            </SelectField>
            <div className="flex gap-2 md:col-span-2 xl:col-span-1">
              <button
                type="button"
                onClick={resetFilters}
                className="h-10 rounded-[8px] border border-[#fffaf0]/12 px-3 text-[11px] font-semibold text-[#fffaf0]/60 transition hover:border-[#fffaf0]/25 hover:bg-[#fffaf0]/5 hover:text-[#fffaf0]"
              >
                Reset
              </button>
              <button
                type="submit"
                className="h-10 rounded-[8px] border border-[#f2c36b]/60 bg-[#f2c36b] px-4 text-[11px] font-bold text-[#100e0c] shadow-[0_8px_24px_rgba(242,195,107,.12)] transition hover:bg-[#f8dfaa]"
              >
                Apply filters
              </button>
            </div>
          </form>
        </section>

        <section className="mt-4 overflow-hidden rounded-[12px] border border-[#fffaf0]/10 bg-[#0b0c0c] shadow-[0_18px_60px_rgba(0,0,0,.22)]" aria-label="Product intelligence results">
          <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 border-b border-[#fffaf0]/10 px-4">
            <div className="flex items-center gap-3">
              <strong className="text-[12px] font-semibold text-[#fffaf0]">All products</strong>
              <span className="rounded-full border border-[#fffaf0]/10 bg-[#fffaf0]/[0.03] px-2 py-0.5 text-[9px] font-semibold tabular-nums text-[#fffaf0]/42" aria-live="polite">
                {visibleProducts.length} shown
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-[#fffaf0]/35">
              <CalendarDays className="h-3.5 w-3.5" />
              <span>6-month window</span>
              <span className="mx-2 h-3 w-px bg-[#fffaf0]/10" />
              <button type="button" className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 font-semibold text-[#fffaf0]/55 hover:bg-[#fffaf0]/5 hover:text-[#fffaf0]">
                <Columns3 className="h-3.5 w-3.5" /> Columns
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1310px] table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-[78px]" />
                <col className="w-[254px]" />
                <col className="w-[126px]" />
                <col className="w-[220px]" />
                <col className="w-[220px]" />
                <col className="w-[142px]" />
                <col />
              </colgroup>
              <thead className="bg-[#121312]">
                <tr className="h-11 border-b border-[#fffaf0]/10">
                  {[
                    ['Rank', true],
                    ['Product', false],
                    ['Launched', false],
                    ['Monthly traffic · 6M', true],
                    ['New revenue · 6M', true],
                    ['Category', false],
                    ['Product introduction', false],
                  ].map(([label, sortable]) => (
                    <th key={String(label)} className="px-4 text-[9px] font-bold uppercase tracking-[0.13em] text-[#fffaf0]/38">
                      <span className="inline-flex items-center gap-1.5">
                        {label}
                        {sortable ? <ArrowUpDown className="h-3 w-3 text-[#fffaf0]/20" /> : null}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((product) => (
                  <tr key={product.id} className="group h-[106px] border-b border-[#fffaf0]/[0.075] transition-colors last:border-0 hover:bg-[#fffaf0]/[0.025]">
                    <td className="px-4 align-middle">
                      <span className="font-mono text-[12px] font-semibold tabular-nums text-[#fffaf0]/54">#{String(product.rank).padStart(2, '0')}</span>
                    </td>
                    <td className="px-4 align-middle">
                      <div className="flex items-center gap-3">
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-[15px] font-black shadow-[inset_0_0_0_1px_rgba(255,255,255,.16)] ${product.markClassName}`} aria-hidden="true">
                          {product.mark}
                        </span>
                        <span className="grid min-w-0 gap-0.5">
                          <span className="flex items-center gap-1.5">
                            <strong className="truncate text-[13px] font-semibold text-[#fffaf0]">{product.name}</strong>
                            <button
                              type="button"
                              onClick={() => toggleWatchlist(product.id)}
                              className={`grid h-6 w-6 shrink-0 place-items-center rounded-[6px] transition ${watchlisted.has(product.id) ? 'text-[#f2c36b]' : 'text-[#fffaf0]/22 hover:bg-[#fffaf0]/5 hover:text-[#fffaf0]/65'}`}
                              aria-label={`${watchlisted.has(product.id) ? 'Remove' : 'Add'} ${product.name} ${watchlisted.has(product.id) ? 'from' : 'to'} watchlist`}
                              aria-pressed={watchlisted.has(product.id)}
                            >
                              <Bookmark className="h-3.5 w-3.5" fill={watchlisted.has(product.id) ? 'currentColor' : 'none'} />
                            </button>
                          </span>
                          <a
                            href={product.href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex w-fit items-center gap-1 font-mono text-[10px] text-[#f2c36b]/72 hover:text-[#f2c36b]"
                          >
                            {product.domain}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 align-middle">
                      <time dateTime={product.launchDate} className="font-mono text-[10px] tabular-nums text-[#fffaf0]/52">{formatLaunchDate(product.launchDate)}</time>
                    </td>
                    <td className="px-4 align-middle">
                      <Sparkline id={`${product.id}-traffic`} values={product.traffic} label={product.trafficLabel} growth={product.trafficGrowth} color="#f2c36b" />
                    </td>
                    <td className="px-4 align-middle">
                      <Sparkline id={`${product.id}-revenue`} values={product.revenue} label={product.revenueLabel} growth={product.revenueGrowth} color="#e86f61" />
                    </td>
                    <td className="px-4 align-middle">
                      <span className="inline-flex max-w-full rounded-full border border-[#fffaf0]/10 bg-[#fffaf0]/[0.035] px-2.5 py-1 text-[9px] font-semibold text-[#fffaf0]/58">
                        {product.category}
                      </span>
                    </td>
                    <td className="px-4 pr-6 align-middle">
                      <p className="line-clamp-3 max-w-[390px] text-[11px] leading-[1.55] text-[#fffaf0]/48 group-hover:text-[#fffaf0]/64">{product.description}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {visibleProducts.length === 0 ? (
            <div className="grid min-h-64 place-items-center px-6 py-12 text-center">
              <div>
                <Search className="mx-auto h-6 w-6 text-[#fffaf0]/22" />
                <h3 className="mt-3 text-[13px] font-semibold text-[#fffaf0]">No products match these filters</h3>
                <p className="mt-1 text-[11px] text-[#fffaf0]/42">Try a broader keyword, category, or momentum range.</p>
                <button type="button" onClick={resetFilters} className="mt-4 rounded-[8px] border border-[#fffaf0]/12 px-3 py-2 text-[11px] font-semibold text-[#fffaf0]/65 hover:bg-[#fffaf0]/5 hover:text-[#fffaf0]">
                  Clear all filters
                </button>
              </div>
            </div>
          ) : null}

          <footer className="flex min-h-[48px] flex-wrap items-center justify-between gap-3 border-t border-[#fffaf0]/10 bg-[#0d0e0e] px-4 text-[9px] text-[#fffaf0]/34">
            <span>Traffic and revenue figures are mock directional estimates; replace them with Similarweb and Semrush enrichment.</span>
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${datasetStatus === 'rds' ? 'bg-[#78c889]' : datasetStatus === 'loading' ? 'bg-[#f2c36b]' : 'bg-[#e86f61]'}`} />
              {datasetStatus === 'rds' ? 'Loaded from Alibaba Cloud RDS' : datasetStatus === 'loading' ? 'Connecting to Alibaba Cloud RDS' : 'RDS unavailable · showing local fallback'}
            </span>
          </footer>
        </section>
      </div>
    </main>
  );
}
