import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import pg from 'pg';

const [inputFileArgument] = process.argv.slice(2);
if (!inputFileArgument) {
  throw new Error('Usage: node scripts/import-market-intelligence-pricing-snapshots.mjs <pricing-snapshots.raw.jsonl>');
}

const connectionString = String(process.env.AGENT_CONTEXT_DATABASE_URL || process.env.DATABASE_URL || '').trim();
if (!connectionString) throw new Error('AGENT_CONTEXT_DATABASE_URL or DATABASE_URL is required.');

function compatibleConnectionString(value) {
  const url = new URL(value);
  if (url.searchParams.get('sslmode') === 'require' && !url.searchParams.has('uselibpqcompat')) {
    url.searchParams.set('uselibpqcompat', 'true');
  }
  return url.toString();
}

const inputFile = resolve(inputFileArgument);
const { Pool } = pg;
const pool = new Pool({ connectionString: compatibleConnectionString(connectionString), max: 2 });

const SCHEMA_SQL = `
  create schema if not exists market_intelligence;

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

  alter table market_intelligence.product_pricing_snapshots
    add column if not exists primary_price_points jsonb not null default '[]'::jsonb;

  create index if not exists product_pricing_snapshots_month_strategy_idx
    on market_intelligence.product_pricing_snapshots(snapshot_month desc, pricing_strategy);
  create index if not exists product_pricing_snapshots_verified_idx
    on market_intelligence.product_pricing_snapshots(verified, snapshot_month desc);
  create index if not exists product_pricing_snapshots_price_points_idx
    on market_intelligence.product_pricing_snapshots using gin(price_points jsonb_path_ops);

  create or replace view market_intelligence.product_current_pricing as
  select distinct on (snapshot.product_id)
    product.id as product_id,
    product.name as product_name,
    product.product_hunt_url,
    product.website_url,
    snapshot.snapshot_month,
    snapshot.pricing_strategy,
    snapshot.verified,
    snapshot.evidence_status,
    snapshot.scan_status,
    snapshot.evidence_url,
    snapshot.checkout_url,
    snapshot.signals,
    snapshot.price_points,
    snapshot.primary_price_points,
    snapshot.pricing_flags,
    snapshot.confidence,
    snapshot.observed_at
  from market_intelligence.product_pricing_snapshots snapshot
  join market_intelligence.products product on product.id = snapshot.product_id
  order by snapshot.product_id, snapshot.snapshot_month desc, snapshot.observed_at desc;
`;

function normalizeProductKey(value) {
  return String(value || '').trim().replace(/[?#].*$/, '').replace(/\/$/, '');
}

function sanitizeUnicode(value) {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1];
        index += 1;
      } else {
        output += '\ufffd';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      output += '\ufffd';
    } else {
      output += value[index];
    }
  }
  return output;
}

function sanitizedValue(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'string' ? sanitizeUnicode(item) : item));
}

function chunks(values, size = 200) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function confidence(record) {
  if (record.verified && (record.pricePoints || []).length > 0) return 'high';
  if (record.verified) return 'medium';
  if (record.status === 'no_pricing_evidence') return 'medium';
  return 'low';
}

try {
  await pool.query(SCHEMA_SQL);
  const products = await pool.query(`
    select id, external_id, product_hunt_url
    from market_intelligence.products
    where external_source = 'product_hunt' and is_mock = false
  `);
  const productIdByKey = new Map();
  for (const product of products.rows) {
    for (const value of [product.external_id, product.product_hunt_url]) {
      const key = normalizeProductKey(value);
      if (key) productIdByKey.set(key, product.id);
    }
  }

  const latestByProductMonth = new Map();
  const lines = createInterface({ input: createReadStream(inputFile, { encoding: 'utf8' }), crlfDelay: Infinity });
  let read = 0;
  let unlinked = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    read += 1;
    const record = JSON.parse(line);
    const productId = productIdByKey.get(normalizeProductKey(record.productKey));
    if (!productId) {
      unlinked += 1;
      continue;
    }
    const month = String(record.snapshotMonth || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const row = {
      product_id: productId,
      snapshot_month: `${month}-01`,
      pricing_strategy: record.pricingStrategy || 'unknown',
      verified: record.verified === true,
      evidence_status: record.evidenceStatus || 'unknown',
      scan_status: record.status || 'unknown',
      evidence_url: record.evidenceUrl || null,
      checkout_url: record.checkoutUrl || null,
      signals: record.signals || [],
      price_points: sanitizedValue(record.pricePoints || []),
      primary_price_points: sanitizedValue(record.primaryPricePoints || []),
      pricing_flags: sanitizedValue(record.flags || {}),
      source: 'official_website',
      confidence: confidence(record),
      observed_at: record.checkedAt || new Date().toISOString(),
    };
    const key = `${productId}\n${month}`;
    const previous = latestByProductMonth.get(key);
    if (!previous || String(row.observed_at) >= String(previous.observed_at)) latestByProductMonth.set(key, row);
  }

  let upserted = 0;
  for (const batch of chunks([...latestByProductMonth.values()])) {
    const result = await pool.query(`
      insert into market_intelligence.product_pricing_snapshots (
        product_id, snapshot_month, pricing_strategy, verified, evidence_status, scan_status,
        evidence_url, checkout_url, signals, price_points, primary_price_points, pricing_flags, source, confidence, observed_at, updated_at
      )
      select
        product_id, snapshot_month, pricing_strategy, verified, evidence_status, scan_status,
        evidence_url, checkout_url,
        array(select jsonb_array_elements_text(signals)),
        price_points, primary_price_points, pricing_flags, source, confidence, observed_at, now()
      from jsonb_to_recordset($1::jsonb) as x(
        product_id text, snapshot_month date, pricing_strategy text, verified boolean,
        evidence_status text, scan_status text, evidence_url text, checkout_url text,
        signals jsonb, price_points jsonb, primary_price_points jsonb, pricing_flags jsonb, source text, confidence text, observed_at timestamptz
      )
      on conflict (product_id, snapshot_month) do update set
        pricing_strategy = excluded.pricing_strategy,
        verified = excluded.verified,
        evidence_status = excluded.evidence_status,
        scan_status = excluded.scan_status,
        evidence_url = excluded.evidence_url,
        checkout_url = excluded.checkout_url,
        signals = excluded.signals,
        price_points = excluded.price_points,
        primary_price_points = excluded.primary_price_points,
        pricing_flags = excluded.pricing_flags,
        source = excluded.source,
        confidence = excluded.confidence,
        observed_at = excluded.observed_at,
        updated_at = now()
    `, [JSON.stringify(batch)]);
    upserted += result.rowCount || 0;
  }

  const verification = await pool.query(`
    select
      count(*)::integer as total,
      count(*) filter (where verified)::integer as verified,
      count(*) filter (where scan_status = 'no_pricing_evidence')::integer as no_pricing_evidence,
      count(*) filter (where scan_status = 'unreachable')::integer as unreachable,
      count(*) filter (where scan_status = 'no_website')::integer as no_website
    from market_intelligence.product_pricing_snapshots
    where snapshot_month = $1::date
  `, [[...latestByProductMonth.values()][0]?.snapshot_month || '1900-01-01']);
  console.log(JSON.stringify({ inputFile, read, unlinked, upserted, database: verification.rows[0] }, null, 2));
} finally {
  await pool.end();
}
