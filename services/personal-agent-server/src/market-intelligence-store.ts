import type { ServerConfig } from './config.js';

type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type MarketProductSort =
  | 'rank'
  | 'audience'
  | 'trend'
  | 'revenue'
  | 'newest'
  // Backward-compatible sort values used by the first mock UI.
  | 'traffic'
  | 'traffic-growth'
  | 'revenue-growth';

export type MarketProductDataset = 'mock' | 'actual' | 'all';

export type ListMarketProductsInput = {
  query?: string;
  category?: string;
  productType?: string;
  dataset?: MarketProductDataset;
  sort?: MarketProductSort;
  limit?: number;
  offset?: number;
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

  alter table market_intelligence.products
    add column if not exists product_hunt_url text,
    add column if not exists product_types text[] not null default '{}',
    add column if not exists platforms text[] not null default '{}',
    add column if not exists is_native_app boolean not null default false,
    add column if not exists revenue_estimate_low_usd numeric(18, 2),
    add column if not exists revenue_estimate_high_usd numeric(18, 2),
    add column if not exists revenue_estimate_source text,
    add column if not exists estimate_method_version text,
    add column if not exists revenue_estimate_details jsonb,
    add column if not exists audience_estimate_details jsonb,
    add column if not exists company_group_key text,
    add column if not exists company_name text,
    add column if not exists company_domain text,
    add column if not exists company_website_url text,
    add column if not exists is_company_primary boolean not null default true,
    add column if not exists company_product_count integer not null default 1;

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

  alter table market_intelligence.product_monthly_metrics
    add column if not exists estimated_users_low bigint,
    add column if not exists estimated_users_high bigint,
    add column if not exists user_estimate_source text;

  create table if not exists market_intelligence.product_app_metrics (
    product_id text not null references market_intelligence.products(id) on delete cascade,
    observed_at timestamptz not null,
    ios_downloads_30d bigint,
    ios_revenue_30d numeric(18, 2),
    android_downloads_30d bigint,
    android_revenue_30d numeric(18, 2),
    total_downloads_30d bigint,
    total_revenue_30d numeric(18, 2),
    coverage_status text,
    source text not null default 'appark',
    confidence text not null default 'estimated',
    is_mock boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (product_id, observed_at)
  );

  create index if not exists market_products_actual_rank_idx
    on market_intelligence.products (is_mock, current_rank asc, id asc);
  create index if not exists market_products_topics_idx
    on market_intelligence.products using gin (topics);
  create index if not exists market_products_types_idx
    on market_intelligence.products using gin (product_types);
  create index if not exists market_products_company_group_idx
    on market_intelligence.products (is_mock, is_company_primary, company_group_key);
  create index if not exists market_app_metrics_product_observed_idx
    on market_intelligence.product_app_metrics (product_id, observed_at desc);
`;

const SORT_SQL: Record<MarketProductSort, string> = {
  rank: 'p.current_rank asc nulls last, p.id asc',
  audience: 'coalesce(app.total_downloads_30d, latest_metric.estimated_monthly_users) desc nulls last, p.current_rank asc nulls last, p.id asc',
  trend: 'p.traffic_growth_pct desc nulls last, p.current_rank asc nulls last, p.id asc',
  revenue: `case
    when p.revenue_estimate_source in ('Open Source', 'Free') then null
    else coalesce(nullif(app.total_revenue_30d, 0), p.monthly_new_revenue_usd)
  end desc nulls last, p.current_rank asc nulls last, p.id asc`,
  newest: 'p.launched_at desc, p.current_rank asc nulls last, p.id asc',
  traffic: 'coalesce(app.total_downloads_30d, latest_metric.estimated_monthly_users) desc nulls last, p.current_rank asc nulls last, p.id asc',
  'traffic-growth': 'p.traffic_growth_pct desc nulls last, p.current_rank asc nulls last, p.id asc',
  'revenue-growth': 'p.revenue_growth_pct desc nulls last, p.current_rank asc nulls last, p.id asc',
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

function rowNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowNumber(value: unknown) {
  return rowNullableNumber(value) ?? 0;
}

function rowString(value: unknown) {
  return typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : '';
}

function rowStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function normalizeDataset(value: MarketProductDataset | undefined): MarketProductDataset {
  return value === 'mock' || value === 'all' ? value : 'actual';
}

export async function listMarketProducts(config: ServerConfig, input: ListMarketProductsInput = {}) {
  const pool = await getMarketPool(config);
  await ensureMarketSchema(pool);

  const query = input.query?.trim().slice(0, 120) || '';
  const category = input.category?.trim().slice(0, 100) || '';
  const productType = input.productType?.trim().slice(0, 100) || '';
  const dataset = normalizeDataset(input.dataset);
  const sort = input.sort && input.sort in SORT_SQL ? input.sort : 'revenue';
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit || 50)));
  const offset = Math.max(0, Math.min(100_000, Math.floor(input.offset || 0)));
  const datasetSql = dataset === 'all'
    ? 'true'
    : dataset === 'actual'
      ? 'p.is_mock = false'
      : 'p.is_mock = true';

  const result = await pool.query(
    `
      select
        p.id,
        p.current_rank,
        p.name,
        p.domain,
        p.website_url,
        p.product_hunt_url,
        p.logo_url,
        p.launched_at,
        p.category,
        p.topics,
        p.product_types,
        p.platforms,
        p.is_native_app,
        p.tagline,
        p.description,
        p.monthly_traffic,
        p.traffic_growth_pct,
        p.monthly_new_revenue_usd,
        p.revenue_estimate_low_usd,
        p.revenue_estimate_high_usd,
        p.revenue_estimate_source,
        p.estimate_method_version,
        p.revenue_estimate_details,
        p.audience_estimate_details,
        p.company_group_key,
        p.company_name,
        p.company_domain,
        p.company_website_url,
        p.company_product_count,
        p.revenue_growth_pct,
        p.data_confidence,
        p.is_mock,
        p.metrics_updated_at,
        app.observed_at as app_observed_at,
        app.total_downloads_30d,
        app.total_revenue_30d,
        app.coverage_status as app_coverage_status,
        latest_metric.month as latest_metric_month,
        latest_metric.estimated_monthly_users,
        latest_metric.estimated_users_low,
        latest_metric.estimated_users_high,
        latest_metric.user_estimate_source,
        count(*) over() as total_count,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', child.id,
            'name', child.name,
            'tagline', child.tagline,
            'logoUrl', child.logo_url,
            'websiteUrl', child.website_url,
            'productHuntUrl', child.product_hunt_url,
            'launchedAt', child.launched_at,
            'topics', child.topics,
            'productTypes', child.product_types,
            'platforms', child.platforms,
            'isNativeApp', child.is_native_app
          ) order by child.launched_at asc, child.name asc)
          from market_intelligence.products child
          where child.company_group_key = p.company_group_key
            and child.id <> p.id
            and child.is_mock = p.is_mock
        ), '[]'::jsonb) as child_products,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'month', to_char(recent.month, 'YYYY-MM'),
            'trafficVisits', recent.traffic_visits,
            'trafficSource', recent.traffic_source,
            'confidence', recent.confidence
          ) order by recent.month)
          from (
            select m.*
            from market_intelligence.product_monthly_metrics m
            where m.product_id = p.id
            order by m.month desc
            limit 3
          ) recent
        ), '[]'::jsonb) as traffic_trend
      from market_intelligence.products p
      left join lateral (
        select m.*
        from market_intelligence.product_app_metrics m
        where m.product_id = p.id
        order by m.observed_at desc
        limit 1
      ) app on true
      left join lateral (
        select m.*
        from market_intelligence.product_monthly_metrics m
        where m.product_id = p.id
        order by m.month desc
        limit 1
      ) latest_metric on true
      where ${datasetSql}
      and coalesce(p.is_company_primary, true) = true
      and (
        $1 = ''
        or to_tsvector(
          'simple',
          coalesce(p.name, '') || ' ' || coalesce(p.domain, '') || ' ' || coalesce(p.tagline, '') || ' ' ||
          coalesce(p.description, '') || ' ' || array_to_string(p.topics, ' ') || ' ' || array_to_string(p.product_types, ' ')
        ) @@ websearch_to_tsquery('simple', $1)
        or p.name ilike '%' || $1 || '%'
        or p.domain ilike '%' || $1 || '%'
        or exists (
          select 1
          from market_intelligence.products member
          where member.company_group_key = p.company_group_key
            and member.is_mock = p.is_mock
            and (
              member.name ilike '%' || $1 || '%'
              or member.domain ilike '%' || $1 || '%'
              or member.tagline ilike '%' || $1 || '%'
              or member.description ilike '%' || $1 || '%'
            )
        )
      )
      and ($2 = '' or $2 = any(p.topics) or p.category = $2)
      and ($3 = '' or $3 = any(p.product_types))
      order by ${SORT_SQL[sort]}
      limit $4 offset $5
    `,
    [query, category, productType, limit, offset],
  );

  const optionsWhere = dataset === 'all'
    ? 'coalesce(is_company_primary, true) = true'
    : dataset === 'actual'
      ? 'is_mock = false and coalesce(is_company_primary, true) = true'
      : 'is_mock = true and coalesce(is_company_primary, true) = true';
  const [topicResult, typeResult] = await Promise.all([
    pool.query(`
      select value, count(*)::integer as count
      from market_intelligence.products, unnest(topics) value
      where ${optionsWhere}
      group by value
      order by count(*) desc, value asc
      limit 100
    `),
    pool.query(`
      select value, count(*)::integer as count
      from market_intelligence.products, unnest(product_types) value
      where ${optionsWhere}
      group by value
      order by count(*) desc, value asc
      limit 50
    `),
  ]);

  const products = result.rows.map((row) => {
    const trafficTrend = Array.isArray(row.traffic_trend) ? row.traffic_trend : [];
    const companyProductCount = Math.max(1, rowNumber(row.company_product_count));
    const groupedCompany = companyProductCount > 1;
    const appDownloads = groupedCompany ? null : rowNullableNumber(row.total_downloads_30d);
    const registeredUsers = rowNullableNumber(row.estimated_monthly_users);
    const audienceKind = appDownloads !== null
      ? 'app_downloads'
      : registeredUsers !== null
        ? 'registered_users_estimate'
        : null;
    const audienceValue = appDownloads ?? registeredUsers;
    const productRevenueSource = rowString(row.revenue_estimate_source) || null;
    const revenueIsNonMonetized = productRevenueSource === 'Open Source' || productRevenueSource === 'Free';
    const rawAppRevenue = groupedCompany ? null : rowNullableNumber(row.total_revenue_30d);
    const appRevenue = !revenueIsNonMonetized && rawAppRevenue !== null && rawAppRevenue > 0 ? rawAppRevenue : null;
    const latestTrafficMonth = trafficTrend.length > 0
      ? rowString((trafficTrend.at(-1) as Record<string, unknown> | undefined)?.month)
      : '';

    return {
      id: rowString(row.id),
      rank: rowNumber(row.current_rank),
      name: rowString(row.name),
      domain: rowString(row.domain),
      websiteUrl: rowString(row.website_url) || null,
      productHuntUrl: rowString(row.product_hunt_url) || null,
      logoUrl: rowString(row.logo_url) || null,
      launchedAt: rowString(row.launched_at),
      category: rowString(row.category),
      topics: rowStringArray(row.topics),
      productTypes: rowStringArray(row.product_types),
      platforms: rowStringArray(row.platforms),
      isNativeApp: Boolean(row.is_native_app),
      tagline: rowString(row.tagline),
      description: rowString(row.description),
      lastMonthAudience: {
        kind: audienceKind,
        value: audienceValue,
        low: audienceKind === 'app_downloads' ? null : rowNullableNumber(row.estimated_users_low),
        high: audienceKind === 'app_downloads' ? null : rowNullableNumber(row.estimated_users_high),
        period: audienceKind === 'app_downloads' ? 'rolling-30d' : rowString(row.latest_metric_month).slice(0, 7) || latestTrafficMonth || null,
        source: audienceKind === 'app_downloads' ? 'Appark estimate' : rowString(row.user_estimate_source) || null,
      },
      lastMonthRevenue: {
        value: appRevenue ?? rowNullableNumber(row.monthly_new_revenue_usd),
        low: appRevenue !== null ? null : rowNullableNumber(row.revenue_estimate_low_usd),
        high: appRevenue !== null ? null : rowNullableNumber(row.revenue_estimate_high_usd),
        period: appRevenue !== null ? 'rolling-30d' : rowString(row.latest_metric_month).slice(0, 7) || null,
        source: appRevenue !== null ? 'Appark estimate' : productRevenueSource,
      },
      trafficGrowthPct: rowNullableNumber(row.traffic_growth_pct),
      trafficTrend: trafficTrend.map((metric) => {
        const value = metric && typeof metric === 'object' ? metric as Record<string, unknown> : {};
        return {
          month: rowString(value.month),
          value: rowNullableNumber(value.trafficVisits),
          source: rowString(value.trafficSource) || null,
          confidence: rowString(value.confidence),
        };
      }),
      confidence: rowString(row.data_confidence),
      isMock: Boolean(row.is_mock),
      metricsUpdatedAt: rowString(row.metrics_updated_at),
      appCoverageStatus: rowString(row.app_coverage_status) || null,
      estimateMethodVersion: rowString(row.estimate_method_version) || null,
      revenueEstimateDetails: row.revenue_estimate_details && typeof row.revenue_estimate_details === 'object'
        ? row.revenue_estimate_details as Record<string, unknown>
        : null,
      audienceEstimateDetails: row.audience_estimate_details && typeof row.audience_estimate_details === 'object'
        ? row.audience_estimate_details as Record<string, unknown>
        : null,
      companyGroup: {
        key: rowString(row.company_group_key) || `product:${rowString(row.id)}`,
        name: rowString(row.company_name) || rowString(row.name),
        domain: rowString(row.company_domain) || rowString(row.domain) || null,
        websiteUrl: rowString(row.company_website_url) || rowString(row.website_url) || null,
        productCount: companyProductCount,
        isGrouped: groupedCompany,
        childProducts: Array.isArray(row.child_products) ? row.child_products : [],
      },
    };
  });

  const total = result.rows.length ? rowNumber(result.rows[0].total_count) : 0;
  return {
    products,
    total,
    offset,
    limit,
    hasMore: offset + products.length < total,
    generatedAt: new Date().toISOString(),
    source: 'aliyun-rds',
    dataset,
    mock: products.length > 0 && products.every((product) => product.isMock),
    filterOptions: {
      topics: topicResult.rows.map((row) => ({ value: rowString(row.value), count: rowNumber(row.count) })),
      productTypes: typeResult.rows.map((row) => ({ value: rowString(row.value), count: rowNumber(row.count) })),
    },
  };
}
