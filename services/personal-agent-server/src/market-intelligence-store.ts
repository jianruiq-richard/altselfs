import type { ServerConfig } from './config.js';

type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type MarketProductSort =
  | 'rank'
  | 'traffic'
  | 'traffic-growth'
  | 'revenue'
  | 'revenue-growth'
  | 'newest';

export type ListMarketProductsInput = {
  query?: string;
  category?: string;
  sort?: MarketProductSort;
  limit?: number;
};

let sharedPool: PgPool | null = null;
let sharedPoolUrl = '';
let schemaReady: Promise<void> | null = null;

const MARKET_INTELLIGENCE_SCHEMA_SQL = `
  create schema if not exists market_intelligence;

  create table if not exists market_intelligence.products (
    id text primary key,
    external_source text not null,
    external_id text not null,
    slug text not null,
    name text not null,
    tagline text,
    description text not null,
    domain text,
    website_url text,
    logo_url text,
    category text not null,
    topics text[] not null default '{}',
    launched_at timestamptz not null,
    current_rank integer,
    monthly_traffic bigint,
    traffic_growth_pct numeric(8, 2),
    monthly_new_revenue_usd numeric(18, 2),
    revenue_growth_pct numeric(8, 2),
    data_confidence text not null default 'unknown',
    is_mock boolean not null default false,
    metrics_updated_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (external_source, external_id)
  );

  create table if not exists market_intelligence.product_monthly_metrics (
    product_id text not null references market_intelligence.products(id) on delete cascade,
    month date not null,
    traffic_visits bigint,
    estimated_monthly_users bigint,
    estimated_new_revenue_usd numeric(18, 2),
    revenue_low_usd numeric(18, 2),
    revenue_high_usd numeric(18, 2),
    traffic_source text,
    revenue_source text,
    confidence text not null default 'unknown',
    method_version text,
    is_mock boolean not null default false,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (product_id, month)
  );
`;

const SORT_SQL: Record<MarketProductSort, string> = {
  rank: 'p.current_rank asc nulls last, p.id asc',
  traffic: 'p.monthly_traffic desc nulls last, p.id asc',
  'traffic-growth': 'p.traffic_growth_pct desc nulls last, p.id asc',
  revenue: 'p.monthly_new_revenue_usd desc nulls last, p.id asc',
  'revenue-growth': 'p.revenue_growth_pct desc nulls last, p.id asc',
  newest: 'p.launched_at desc, p.id asc',
};

async function getMarketPool(config: ServerConfig) {
  const connectionString = (config.contextDatabaseUrl || config.databaseUrl || '').trim();
  if (!connectionString) {
    throw new Error('AGENT_CONTEXT_DATABASE_URL or DATABASE_URL is required for market intelligence.');
  }
  if (sharedPool && sharedPoolUrl === connectionString) return sharedPool;
  const pg = (await import('pg')) as { Pool: new (options: { connectionString: string; max: number }) => PgPool };
  sharedPoolUrl = connectionString;
  sharedPool = new pg.Pool({ connectionString, max: 4 });
  schemaReady = null;
  return sharedPool;
}

async function ensureMarketSchema(pool: PgPool) {
  if (!schemaReady) {
    schemaReady = pool.query(MARKET_INTELLIGENCE_SCHEMA_SQL).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function rowNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowString(value: unknown) {
  return typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : '';
}

export async function listMarketProducts(config: ServerConfig, input: ListMarketProductsInput = {}) {
  const pool = await getMarketPool(config);
  await ensureMarketSchema(pool);

  const query = input.query?.trim().slice(0, 120) || '';
  const category = input.category?.trim().slice(0, 80) || '';
  const sort = input.sort && input.sort in SORT_SQL ? input.sort : 'rank';
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit || 50)));
  const result = await pool.query(
    `
      select
        p.id,
        p.current_rank,
        p.name,
        p.domain,
        p.website_url,
        p.logo_url,
        p.launched_at,
        p.category,
        p.description,
        p.monthly_traffic,
        p.traffic_growth_pct,
        p.monthly_new_revenue_usd,
        p.revenue_growth_pct,
        p.data_confidence,
        p.is_mock,
        p.metrics_updated_at,
        count(*) over() as total_count,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'month', to_char(recent.month, 'YYYY-MM'),
            'trafficVisits', recent.traffic_visits,
            'estimatedMonthlyUsers', recent.estimated_monthly_users,
            'estimatedNewRevenueUsd', recent.estimated_new_revenue_usd,
            'revenueLowUsd', recent.revenue_low_usd,
            'revenueHighUsd', recent.revenue_high_usd,
            'confidence', recent.confidence
          ) order by recent.month)
          from (
            select m.*
            from market_intelligence.product_monthly_metrics m
            where m.product_id = p.id
            order by m.month desc
            limit 6
          ) recent
        ), '[]'::jsonb) as metrics
      from market_intelligence.products p
      where (
        $1 = ''
        or to_tsvector('simple', coalesce(p.name, '') || ' ' || coalesce(p.domain, '') || ' ' || coalesce(p.tagline, '') || ' ' || coalesce(p.description, ''))
          @@ websearch_to_tsquery('simple', $1)
        or p.name ilike '%' || $1 || '%'
        or p.domain ilike '%' || $1 || '%'
      )
      and ($2 = '' or p.category = $2)
      order by ${SORT_SQL[sort]}
      limit $3
    `,
    [query, category, limit],
  );

  const products = result.rows.map((row) => {
    const metrics = Array.isArray(row.metrics) ? row.metrics : [];
    return {
      id: rowString(row.id),
      rank: rowNumber(row.current_rank),
      name: rowString(row.name),
      domain: rowString(row.domain),
      websiteUrl: rowString(row.website_url),
      logoUrl: rowString(row.logo_url) || null,
      launchedAt: rowString(row.launched_at),
      category: rowString(row.category),
      description: rowString(row.description),
      monthlyTraffic: rowNumber(row.monthly_traffic),
      trafficGrowthPct: rowNumber(row.traffic_growth_pct),
      monthlyNewRevenueUsd: rowNumber(row.monthly_new_revenue_usd),
      revenueGrowthPct: rowNumber(row.revenue_growth_pct),
      confidence: rowString(row.data_confidence),
      isMock: Boolean(row.is_mock),
      metricsUpdatedAt: rowString(row.metrics_updated_at),
      metrics: metrics.map((metric) => {
        const value = metric && typeof metric === 'object' ? metric as Record<string, unknown> : {};
        return {
          month: rowString(value.month),
          trafficVisits: rowNumber(value.trafficVisits),
          estimatedMonthlyUsers: rowNumber(value.estimatedMonthlyUsers),
          estimatedNewRevenueUsd: rowNumber(value.estimatedNewRevenueUsd),
          revenueLowUsd: rowNumber(value.revenueLowUsd),
          revenueHighUsd: rowNumber(value.revenueHighUsd),
          confidence: rowString(value.confidence),
        };
      }),
    };
  });

  return {
    products,
    total: result.rows.length ? rowNumber(result.rows[0].total_count) : 0,
    generatedAt: new Date().toISOString(),
    source: 'aliyun-rds',
    mock: products.length > 0 && products.every((product) => product.isMock),
  };
}
