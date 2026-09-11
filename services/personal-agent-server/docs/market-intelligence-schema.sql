begin;

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
  product_hunt_url text,
  category text not null,
  topics text[] not null default '{}',
  product_types text[] not null default '{}',
  platforms text[] not null default '{}',
  is_native_app boolean not null default false,
  launched_at timestamptz not null,
  current_rank integer,
  monthly_traffic bigint,
  traffic_growth_pct numeric(8, 2),
  monthly_new_revenue_usd numeric(18, 2),
  revenue_growth_pct numeric(8, 2),
  revenue_estimate_low_usd numeric(18, 2),
  revenue_estimate_high_usd numeric(18, 2),
  revenue_estimate_source text,
  estimate_method_version text,
  revenue_estimate_details jsonb,
  data_confidence text not null default 'unknown',
  is_mock boolean not null default false,
  metrics_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_source, external_id)
);

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
  estimated_users_low bigint,
  estimated_users_high bigint,
  user_estimate_source text,
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

create table if not exists market_intelligence.product_pricing_snapshots (
  product_id text not null references market_intelligence.products(id) on delete cascade,
  snapshot_month date not null,
  pricing_strategy text not null,
  verified boolean not null default false,
  evidence_status text not null,
  scan_status text not null,
  evidence_url text,
  checkout_url text,
  signals text[] not null default '{}',
  price_points jsonb not null default '[]'::jsonb,
  primary_price_points jsonb not null default '[]'::jsonb,
  pricing_flags jsonb not null default '{}'::jsonb,
  source text not null default 'official_website',
  confidence text not null default 'unknown',
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, snapshot_month)
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

create index if not exists market_products_rank_idx
  on market_intelligence.products (current_rank asc, id asc);
create index if not exists market_products_launch_idx
  on market_intelligence.products (launched_at desc, id asc);
create index if not exists market_products_category_idx
  on market_intelligence.products (category, current_rank asc);
create index if not exists market_products_traffic_idx
  on market_intelligence.products (monthly_traffic desc nulls last, id asc);
create index if not exists market_products_traffic_growth_idx
  on market_intelligence.products (traffic_growth_pct desc nulls last, id asc);
create index if not exists market_products_revenue_idx
  on market_intelligence.products (monthly_new_revenue_usd desc nulls last, id asc);
create index if not exists market_products_revenue_growth_idx
  on market_intelligence.products (revenue_growth_pct desc nulls last, id asc);
create index if not exists market_products_search_idx
  on market_intelligence.products using gin (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(domain, '') || ' ' || coalesce(tagline, '') || ' ' || coalesce(description, ''))
  );
create index if not exists market_metrics_product_month_idx
  on market_intelligence.product_monthly_metrics (product_id, month desc);
create index if not exists market_products_topics_idx
  on market_intelligence.products using gin (topics);
create index if not exists market_products_types_idx
  on market_intelligence.products using gin (product_types);
create index if not exists market_app_metrics_product_observed_idx
  on market_intelligence.product_app_metrics (product_id, observed_at desc);
create index if not exists market_payment_metrics_product_month_idx
  on market_intelligence.product_payment_metrics (product_id, month desc);
create index if not exists product_pricing_snapshots_month_strategy_idx
  on market_intelligence.product_pricing_snapshots(snapshot_month desc, pricing_strategy);
create index if not exists product_pricing_snapshots_verified_idx
  on market_intelligence.product_pricing_snapshots(verified, snapshot_month desc);
create index if not exists product_pricing_snapshots_price_points_idx
  on market_intelligence.product_pricing_snapshots using gin(price_points jsonb_path_ops);

commit;
