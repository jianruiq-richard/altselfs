import { readFileSync } from 'node:fs';
import pg from 'pg';

const [payloadFile] = process.argv.slice(2);
if (!payloadFile) throw new Error('Usage: node scripts/import-market-intelligence.mjs <payload.json>');

const connectionString = String(process.env.AGENT_CONTEXT_DATABASE_URL || process.env.DATABASE_URL || '').trim();
if (!connectionString) throw new Error('AGENT_CONTEXT_DATABASE_URL or DATABASE_URL is required.');

const payload = JSON.parse(readFileSync(payloadFile, 'utf8'));
const { Pool } = pg;
const pool = new Pool({ connectionString, max: 2 });
const client = await pool.connect();

const SCHEMA_SQL = `
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
    add column if not exists estimate_method_version text;

  create table if not exists market_intelligence.product_launches (
    id text primary key,
    product_id text not null references market_intelligence.products(id) on delete cascade,
    source text not null,
    external_id text not null,
    launched_at timestamptz not null,
    votes_count integer,
    comments_count integer,
    raw_object_key text,
    is_mock boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source, external_id)
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
    source text not null default 'Appark',
    confidence text not null default 'estimated',
    is_mock boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (product_id, observed_at)
  );

  create table if not exists market_intelligence.product_payment_metrics (
    product_id text not null references market_intelligence.products(id) on delete cascade,
    month date not null,
    payment_outbound_visits bigint,
    source text not null,
    confidence text not null default 'medium',
    is_mock boolean not null default false,
    observed_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (product_id, month)
  );

  create table if not exists market_intelligence.sync_runs (
    id text primary key,
    source text not null,
    status text not null,
    item_count integer not null default 0,
    is_mock boolean not null default false,
    metadata jsonb not null default '{}'::jsonb,
    started_at timestamptz not null default now(),
    completed_at timestamptz
  );

  create index if not exists market_products_actual_rank_idx
    on market_intelligence.products (is_mock, current_rank asc, id asc);
  create index if not exists market_products_topics_idx
    on market_intelligence.products using gin (topics);
  create index if not exists market_products_types_idx
    on market_intelligence.products using gin (product_types);
  create index if not exists market_metrics_product_month_idx
    on market_intelligence.product_monthly_metrics (product_id, month desc);
  create index if not exists market_app_metrics_product_observed_idx
    on market_intelligence.product_app_metrics (product_id, observed_at desc);
  create index if not exists market_payment_metrics_product_month_idx
    on market_intelligence.product_payment_metrics (product_id, month desc);
`;

function chunks(values, size = 250) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function importProducts(rows) {
  for (const chunk of chunks(rows)) {
    await client.query(`
      with incoming as (
        select * from jsonb_to_recordset($1::jsonb) as x(
          id text,
          external_source text,
          external_id text,
          slug text,
          name text,
          tagline text,
          description text,
          domain text,
          website_url text,
          product_hunt_url text,
          logo_url text,
          category text,
          topics jsonb,
          product_types jsonb,
          platforms jsonb,
          is_native_app boolean,
          launched_at timestamptz,
          current_rank integer,
          monthly_traffic bigint,
          traffic_growth_pct numeric,
          monthly_new_revenue_usd numeric,
          revenue_growth_pct numeric,
          revenue_estimate_low_usd numeric,
          revenue_estimate_high_usd numeric,
          revenue_estimate_source text,
          estimate_method_version text,
          data_confidence text,
          is_mock boolean,
          metrics_updated_at timestamptz
        )
      )
      insert into market_intelligence.products (
        id, external_source, external_id, slug, name, tagline, description, domain, website_url,
        product_hunt_url, logo_url, category, topics, product_types, platforms, is_native_app,
        launched_at, current_rank, monthly_traffic, traffic_growth_pct, monthly_new_revenue_usd,
        revenue_growth_pct, revenue_estimate_low_usd, revenue_estimate_high_usd, revenue_estimate_source,
        estimate_method_version, data_confidence, is_mock, metrics_updated_at, updated_at
      )
      select
        id, external_source, external_id, slug, name, tagline, description, domain, website_url,
        product_hunt_url, logo_url, category,
        array(select jsonb_array_elements_text(topics)),
        array(select jsonb_array_elements_text(product_types)),
        array(select jsonb_array_elements_text(platforms)),
        is_native_app, launched_at, current_rank, monthly_traffic, traffic_growth_pct, monthly_new_revenue_usd,
        revenue_growth_pct, revenue_estimate_low_usd, revenue_estimate_high_usd, revenue_estimate_source,
        estimate_method_version, data_confidence, is_mock, metrics_updated_at, now()
      from incoming
      on conflict (id) do update set
        external_source = excluded.external_source,
        external_id = excluded.external_id,
        slug = excluded.slug,
        name = excluded.name,
        tagline = excluded.tagline,
        description = excluded.description,
        domain = excluded.domain,
        website_url = excluded.website_url,
        product_hunt_url = excluded.product_hunt_url,
        logo_url = excluded.logo_url,
        category = excluded.category,
        topics = excluded.topics,
        product_types = excluded.product_types,
        platforms = excluded.platforms,
        is_native_app = excluded.is_native_app,
        launched_at = excluded.launched_at,
        current_rank = excluded.current_rank,
        monthly_traffic = excluded.monthly_traffic,
        traffic_growth_pct = excluded.traffic_growth_pct,
        monthly_new_revenue_usd = excluded.monthly_new_revenue_usd,
        revenue_growth_pct = excluded.revenue_growth_pct,
        revenue_estimate_low_usd = excluded.revenue_estimate_low_usd,
        revenue_estimate_high_usd = excluded.revenue_estimate_high_usd,
        revenue_estimate_source = excluded.revenue_estimate_source,
        estimate_method_version = excluded.estimate_method_version,
        data_confidence = excluded.data_confidence,
        is_mock = excluded.is_mock,
        metrics_updated_at = excluded.metrics_updated_at,
        updated_at = now()
    `, [JSON.stringify(chunk)]);
  }
}

async function importLaunches(rows) {
  for (const chunk of chunks(rows)) {
    await client.query(`
      insert into market_intelligence.product_launches (
        id, product_id, source, external_id, launched_at, votes_count, comments_count, raw_object_key, is_mock, updated_at
      )
      select id, product_id, source, external_id, launched_at, votes_count, comments_count, raw_object_key, is_mock, now()
      from jsonb_to_recordset($1::jsonb) as x(
        id text, product_id text, source text, external_id text, launched_at timestamptz,
        votes_count integer, comments_count integer, raw_object_key text, is_mock boolean
      )
      on conflict (id) do update set
        product_id = excluded.product_id,
        launched_at = excluded.launched_at,
        votes_count = excluded.votes_count,
        comments_count = excluded.comments_count,
        raw_object_key = excluded.raw_object_key,
        is_mock = excluded.is_mock,
        updated_at = now()
    `, [JSON.stringify(chunk)]);
  }
}

async function importMonthlyMetrics(rows) {
  for (const chunk of chunks(rows)) {
    await client.query(`
      insert into market_intelligence.product_monthly_metrics (
        product_id, month, traffic_visits, estimated_monthly_users, estimated_users_low,
        estimated_users_high, user_estimate_source, traffic_source, confidence, method_version,
        is_mock, observed_at, updated_at
      )
      select
        product_id, month, traffic_visits, estimated_monthly_users, estimated_users_low,
        estimated_users_high, user_estimate_source, traffic_source, confidence, method_version,
        is_mock, observed_at, now()
      from jsonb_to_recordset($1::jsonb) as x(
        product_id text, month date, traffic_visits bigint, estimated_monthly_users bigint,
        estimated_users_low bigint, estimated_users_high bigint, user_estimate_source text,
        traffic_source text, confidence text, method_version text, is_mock boolean, observed_at timestamptz
      )
      on conflict (product_id, month) do update set
        traffic_visits = excluded.traffic_visits,
        estimated_monthly_users = excluded.estimated_monthly_users,
        estimated_users_low = excluded.estimated_users_low,
        estimated_users_high = excluded.estimated_users_high,
        user_estimate_source = excluded.user_estimate_source,
        traffic_source = excluded.traffic_source,
        confidence = excluded.confidence,
        method_version = excluded.method_version,
        is_mock = excluded.is_mock,
        observed_at = excluded.observed_at,
        updated_at = now()
    `, [JSON.stringify(chunk)]);
  }
}

async function importAppMetrics(rows) {
  for (const chunk of chunks(rows)) {
    await client.query(`
      insert into market_intelligence.product_app_metrics (
        product_id, observed_at, ios_downloads_30d, ios_revenue_30d, android_downloads_30d,
        android_revenue_30d, total_downloads_30d, total_revenue_30d, coverage_status,
        source, confidence, is_mock, updated_at
      )
      select
        product_id, observed_at, ios_downloads_30d, ios_revenue_30d, android_downloads_30d,
        android_revenue_30d, total_downloads_30d, total_revenue_30d, coverage_status,
        source, confidence, is_mock, now()
      from jsonb_to_recordset($1::jsonb) as x(
        product_id text, observed_at timestamptz, ios_downloads_30d bigint, ios_revenue_30d numeric,
        android_downloads_30d bigint, android_revenue_30d numeric, total_downloads_30d bigint,
        total_revenue_30d numeric, coverage_status text, source text, confidence text, is_mock boolean
      )
      on conflict (product_id, observed_at) do update set
        ios_downloads_30d = excluded.ios_downloads_30d,
        ios_revenue_30d = excluded.ios_revenue_30d,
        android_downloads_30d = excluded.android_downloads_30d,
        android_revenue_30d = excluded.android_revenue_30d,
        total_downloads_30d = excluded.total_downloads_30d,
        total_revenue_30d = excluded.total_revenue_30d,
        coverage_status = excluded.coverage_status,
        source = excluded.source,
        confidence = excluded.confidence,
        is_mock = excluded.is_mock,
        updated_at = now()
    `, [JSON.stringify(chunk)]);
  }
}

async function importPaymentMetrics(rows) {
  for (const chunk of chunks(rows)) {
    await client.query(`
      insert into market_intelligence.product_payment_metrics (
        product_id, month, payment_outbound_visits, source, confidence, is_mock, observed_at, updated_at
      )
      select product_id, month, payment_outbound_visits, source, confidence, is_mock, observed_at, now()
      from jsonb_to_recordset($1::jsonb) as x(
        product_id text, month date, payment_outbound_visits bigint, source text,
        confidence text, is_mock boolean, observed_at timestamptz
      )
      on conflict (product_id, month) do update set
        payment_outbound_visits = excluded.payment_outbound_visits,
        source = excluded.source,
        confidence = excluded.confidence,
        is_mock = excluded.is_mock,
        observed_at = excluded.observed_at,
        updated_at = now()
    `, [JSON.stringify(chunk)]);
  }
}

try {
  await client.query('begin');
  await client.query(SCHEMA_SQL);

  const actualProductIds = payload.products.map((product) => product.id);
  await client.query(`
    delete from market_intelligence.product_launches child
    using market_intelligence.products product
    where child.product_id = product.id and product.external_source = 'product_hunt' and product.is_mock = false
  `);
  await client.query(`
    delete from market_intelligence.product_monthly_metrics child
    using market_intelligence.products product
    where child.product_id = product.id and product.external_source = 'product_hunt' and product.is_mock = false
  `);
  await client.query(`
    delete from market_intelligence.product_app_metrics child
    using market_intelligence.products product
    where child.product_id = product.id and product.external_source = 'product_hunt' and product.is_mock = false
  `);
  await client.query(`
    delete from market_intelligence.product_payment_metrics child
    using market_intelligence.products product
    where child.product_id = product.id and product.external_source = 'product_hunt' and product.is_mock = false
  `);

  await importProducts(payload.products);
  await client.query(`
    delete from market_intelligence.products
    where external_source = 'product_hunt' and is_mock = false and not (id = any($1::text[]))
  `, [actualProductIds]);
  await importLaunches(payload.launches);
  await importMonthlyMetrics(payload.monthlyMetrics);
  await importAppMetrics(payload.appMetrics);
  await importPaymentMetrics(payload.paymentMetrics);
  await client.query('delete from market_intelligence.products where is_mock = true');

  const syncRunId = `product_hunt_import_${Date.now()}`;
  await client.query(`
    insert into market_intelligence.sync_runs (
      id, source, status, item_count, is_mock, metadata, started_at, completed_at
    ) values ($1, 'product_hunt_2026', 'completed', $2, false, $3::jsonb, now(), now())
  `, [syncRunId, payload.products.length, JSON.stringify(payload.metadata)]);

  await client.query('commit');

  const verification = await client.query(`
    select
      count(*) filter (where p.is_mock = false)::integer as products,
      count(*) filter (where p.is_mock = false and p.website_url is not null)::integer as websites,
      count(*) filter (where p.is_mock = false and p.monthly_traffic is not null)::integer as similarweb,
      count(*) filter (where p.is_mock = false and p.monthly_new_revenue_usd is not null)::integer as revenue_estimates
    from market_intelligence.products p
  `);
  console.log(JSON.stringify({ imported: payload.metadata.counts, database: verification.rows[0] }, null, 2));
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}
