import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import pg from 'pg';

const [dataDirectoryArgument] = process.argv.slice(2);
if (!dataDirectoryArgument) {
  throw new Error('Usage: node import-market-intelligence-raw-observations.mjs <enrichment-directory>');
}

const connectionString = String(process.env.AGENT_CONTEXT_DATABASE_URL || process.env.DATABASE_URL || '').trim();
if (!connectionString) throw new Error('AGENT_CONTEXT_DATABASE_URL or DATABASE_URL is required.');

const dataDirectory = resolve(dataDirectoryArgument);
const sourceBatch = basename(dataDirectory);
const BATCH_SIZE = 100;

const SOURCES = [
  { file: 'product-identities.jsonl', provider: 'product_hunt', type: 'product_identity', keys: (record) => [record.product_hunt_url] },
  { file: 'product-launches-with-identities.jsonl', provider: 'product_hunt', type: 'product_launch', keys: (record) => [record.url] },
  { file: 'producthunt-official-links.raw.jsonl', provider: 'product_hunt', type: 'official_link_resolution', keys: (record) => [record.productKey, record.productHuntUrl] },
  { file: 'identity-resolution.raw.jsonl', provider: 'identity_resolution', type: 'website_search_resolution', keys: (record) => [record.productKey, record.productHuntUrl] },
  { file: 'semrush.raw.jsonl', provider: 'semrush', type: 'payment_destinations_historical', keys: (record) => record.productKeys || [] },
  { file: 'semrush-2026-07.raw.jsonl', provider: 'semrush', type: 'payment_destinations_monthly', keys: (record) => record.productKeys || [] },
  { file: 'similarweb.raw.jsonl', provider: 'similarweb', type: 'website_intelligence', keys: (record) => record.productKeys || [] },
  { file: 'appark.raw.jsonl', provider: 'appark', type: 'app_intelligence_legacy', keys: (record) => [record.productKey, record.productHuntUrl] },
  { file: 'appark-local-products.jsonl', provider: 'appark', type: 'app_intelligence_summary', keys: (record) => [record.product_key, record.product_hunt_url] },
  { file: 'appark-local-platform.raw.jsonl', provider: 'appark', type: 'app_intelligence_platform', keys: (record) => [record.productKey, record.productHuntUrl] },
  { file: 'pricing-signals.jsonl', provider: 'pricing', type: 'pricing_signal', keys: (record) => [record.productKey] },
];

const SCHEMA_SQL = `
  create schema if not exists market_intelligence;

  create table if not exists market_intelligence.raw_observations (
    id text primary key,
    provider text not null,
    observation_type text not null,
    source_batch text not null,
    source_file text not null,
    source_line integer not null,
    query_key text,
    domain text,
    platform text,
    periods text[] not null default '{}',
    scan_status text,
    data_status text not null,
    http_status integer,
    attempt integer,
    error_message text,
    fetched_at timestamptz,
    content_sha256 text not null,
    raw_payload jsonb not null,
    created_at timestamptz not null default now(),
    unique (source_batch, source_file, content_sha256)
  );

  create table if not exists market_intelligence.raw_observation_products (
    observation_id text not null references market_intelligence.raw_observations(id) on delete cascade,
    product_id text not null references market_intelligence.products(id) on delete cascade,
    product_key text not null,
    relation_type text not null default 'direct',
    created_at timestamptz not null default now(),
    primary key (observation_id, product_id)
  );

  create index if not exists raw_observations_provider_fetched_idx
    on market_intelligence.raw_observations(provider, fetched_at desc);
  create index if not exists raw_observations_type_status_idx
    on market_intelligence.raw_observations(observation_type, data_status);
  create index if not exists raw_observations_query_key_idx
    on market_intelligence.raw_observations(query_key);
  create index if not exists raw_observations_periods_idx
    on market_intelligence.raw_observations using gin(periods);
  create index if not exists raw_observations_payload_idx
    on market_intelligence.raw_observations using gin(raw_payload jsonb_path_ops);
  create index if not exists raw_observation_products_product_idx
    on market_intelligence.raw_observation_products(product_id, observation_id);

  create or replace view market_intelligence.product_raw_observations as
  select
    product.id as product_id,
    product.name as product_name,
    product.product_hunt_url,
    link.product_key,
    link.relation_type,
    observation.id as observation_id,
    observation.provider,
    observation.observation_type,
    observation.query_key,
    observation.domain,
    observation.platform,
    observation.periods,
    observation.scan_status,
    observation.data_status,
    observation.http_status,
    observation.attempt,
    observation.error_message,
    observation.fetched_at,
    observation.source_batch,
    observation.source_file,
    observation.source_line,
    observation.raw_payload
  from market_intelligence.raw_observation_products link
  join market_intelligence.raw_observations observation on observation.id = link.observation_id
  join market_intelligence.products product on product.id = link.product_id;
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

function sanitizedJson(record) {
  const json = JSON.stringify(record, (_key, value) => typeof value === 'string' ? sanitizeUnicode(value) : value);
  return { json, value: JSON.parse(json) };
}

function finiteInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizedTimestamp(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function metricValues(record, provider) {
  if (provider === 'semrush') {
    return (record.monthly || record.raw?.data?.monthly || [])
      .filter((metric) => metric?.status === 'available')
      .map((metric) => Number(metric.paymentOutboundVisits))
      .filter(Number.isFinite);
  }
  if (provider === 'similarweb') {
    return Object.values(record.monthlyVisits || record.raw?.data?.body?.EstimatedMonthlyVisits || {})
      .map(Number)
      .filter(Number.isFinite);
  }
  if (provider === 'appark') {
    return [
      record.downloads30d,
      record.revenue30d,
      record.ios_downloads_30d,
      record.ios_revenue_30d,
      record.android_downloads_30d,
      record.android_revenue_30d,
      record.total_downloads_30d,
      record.total_revenue_30d,
      record.raw?.data?.downloads30d,
      record.raw?.data?.revenue30d,
    ].map(Number).filter(Number.isFinite);
  }
  return [];
}

function scanStatus(record) {
  if (record.scanStatus) return String(record.scanStatus);
  if (record.queryStatus) return String(record.queryStatus);
  if (record.status) return String(record.status);
  const platformStatuses = [record.ios_query_status, record.android_query_status].filter(Boolean);
  return platformStatuses.length > 0 ? platformStatuses.join(' | ') : 'recorded';
}

function dataStatus(record, provider, observationType) {
  const status = scanStatus(record).toLowerCase();
  const error = String(record.error || record.raw?.error || '').toLowerCase();
  const httpStatus = finiteInteger(record.httpStatus);
  const failed = status.includes('fail') || status.includes('error') || (httpStatus !== null && httpStatus >= 400);
  if (failed) {
    if (/quota|limit|exhaust|insufficient|10000/.test(`${status} ${error}`)) return 'failed_quota';
    if (/auth|login|sign.?in|session|unauthor|forbidden/.test(`${status} ${error}`) || httpStatus === 401 || httpStatus === 403) return 'failed_auth';
    if (/retry|timeout|502|503|504/.test(`${status} ${error}`) || [429, 502, 503, 504].includes(httpStatus)) return 'failed_retryable';
    return 'failed';
  }

  if (provider === 'product_hunt') {
    if (observationType === 'product_identity' || observationType === 'product_launch') return 'success_recorded';
    const resolved = Boolean(record.officialUrl || record.officialDomain || record.website_url || record.website_domain)
      || (Array.isArray(record.storeIdentities) && record.storeIdentities.length > 0);
    return resolved ? 'success_resolved' : 'success_no_data';
  }
  if (provider === 'identity_resolution') {
    const resolved = Boolean(record.bestCandidate || record.websiteUrl || record.websiteDomain)
      || (Array.isArray(record.storeIdentities) && record.storeIdentities.length > 0);
    if (resolved) return 'success_resolved';
    if (status.includes('success')) return 'success_no_data';
    return 'recorded';
  }
  if (provider === 'pricing') return record.verified === true ? 'success_verified' : 'success_no_evidence';
  const values = metricValues(record, provider);
  if (values.some((value) => value > 0)) return 'success_positive';
  if (values.length > 0 && values.every((value) => value === 0)) return 'success_zero';
  if (status.includes('skip')) return 'skipped';
  if (status.includes('success') || status === 'recorded' || status === 'available') return 'success_no_data';
  return 'recorded';
}

function periods(record) {
  const values = new Set();
  for (const metric of record.monthly || record.raw?.data?.monthly || []) {
    const month = String(metric?.displayDate || metric?.month || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) values.add(month);
  }
  for (const month of Object.keys(record.monthlyVisits || record.raw?.data?.body?.EstimatedMonthlyVisits || {})) {
    const normalized = String(month).slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(normalized)) values.add(normalized);
  }
  const requested = String(record.requestedMonth || record.toolInput?.month || '').slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(requested)) values.add(requested);
  return [...values].sort();
}

function queryKey(record) {
  return String(
    record.domain
    || record.requestedStoreId
    || record.resolvedStoreId
    || record.ios_app_id
    || record.android_package
    || record.productKey
    || record.product_key
    || record.product_hunt_url
    || record.url
    || '',
  ).trim() || null;
}

function errorMessage(record) {
  const value = record.error || record.raw?.error || null;
  if (!value) return null;
  return typeof value === 'string' ? value.slice(0, 4_000) : JSON.stringify(value).slice(0, 4_000);
}

function observationFor(source, record, sourceLine) {
  const sanitized = sanitizedJson(record);
  const rawJson = sanitized.json;
  const rawRecord = sanitized.value;
  const contentSha256 = createHash('sha256').update(rawJson).digest('hex');
  const id = `raw_${createHash('sha256').update(`${sourceBatch}\n${source.file}\n${contentSha256}`).digest('hex').slice(0, 32)}`;
  return {
    id,
    provider: source.provider,
    observation_type: source.type,
    source_batch: sourceBatch,
    source_file: source.file,
    source_line: sourceLine,
    query_key: queryKey(rawRecord),
    domain: String(rawRecord.domain || rawRecord.websiteDomain || rawRecord.website_domain || '').trim() || null,
    platform: String(rawRecord.platform || '').trim() || null,
    periods: periods(rawRecord),
    scan_status: scanStatus(rawRecord),
    data_status: dataStatus(rawRecord, source.provider, source.type),
    http_status: finiteInteger(rawRecord.httpStatus || rawRecord.pageHttpStatus),
    attempt: finiteInteger(rawRecord.attempt),
    error_message: errorMessage(rawRecord),
    fetched_at: normalizedTimestamp(rawRecord.fetchedAt || rawRecord.checkedAt || rawRecord.identity_checked_at || rawRecord.date),
    content_sha256: contentSha256,
    raw_payload: rawRecord,
  };
}

const { Pool } = pg;
const pool = new Pool({ connectionString, max: 3 });

async function insertBatch(observations, links) {
  if (observations.length === 0) return { observations: 0, links: 0 };
  const client = await pool.connect();
  try {
    await client.query('begin');
    const observationResult = await client.query(`
      insert into market_intelligence.raw_observations (
        id, provider, observation_type, source_batch, source_file, source_line, query_key, domain, platform,
        periods, scan_status, data_status, http_status, attempt, error_message, fetched_at, content_sha256, raw_payload
      )
      select
        id, provider, observation_type, source_batch, source_file, source_line, query_key, domain, platform,
        array(select jsonb_array_elements_text(periods)), scan_status, data_status, http_status, attempt,
        error_message, fetched_at, content_sha256, raw_payload
      from jsonb_to_recordset($1::jsonb) as x(
        id text, provider text, observation_type text, source_batch text, source_file text, source_line integer,
        query_key text, domain text, platform text, periods jsonb, scan_status text, data_status text,
        http_status integer, attempt integer, error_message text, fetched_at timestamptz,
        content_sha256 text, raw_payload jsonb
      )
      on conflict (id) do update set
        query_key = excluded.query_key,
        domain = excluded.domain,
        platform = excluded.platform,
        periods = excluded.periods,
        scan_status = excluded.scan_status,
        data_status = excluded.data_status,
        http_status = excluded.http_status,
        attempt = excluded.attempt,
        error_message = excluded.error_message,
        fetched_at = excluded.fetched_at,
        raw_payload = excluded.raw_payload
    `, [JSON.stringify(observations)]);

    const uniqueLinks = [...new Map(links.map((link) => [`${link.observation_id}\n${link.product_id}`, link])).values()];
    let linkCount = 0;
    if (uniqueLinks.length > 0) {
      const linkResult = await client.query(`
        insert into market_intelligence.raw_observation_products (
          observation_id, product_id, product_key, relation_type
        )
        select observation_id, product_id, product_key, relation_type
        from jsonb_to_recordset($1::jsonb) as x(
          observation_id text, product_id text, product_key text, relation_type text
        )
        on conflict (observation_id, product_id) do nothing
      `, [JSON.stringify(uniqueLinks)]);
      linkCount = linkResult.rowCount || 0;
    }
    await client.query('commit');
    return { observations: observationResult.rowCount || 0, links: linkCount };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

try {
  await pool.query(SCHEMA_SQL);
  const productResult = await pool.query(`
    select id, external_id, product_hunt_url
    from market_intelligence.products
    where external_source = 'product_hunt' and is_mock = false
  `);
  const productIdByKey = new Map();
  for (const row of productResult.rows) {
    for (const value of [row.external_id, row.product_hunt_url]) {
      const key = normalizeProductKey(value);
      if (key) productIdByKey.set(key, row.id);
    }
  }

  const totals = {
    read: 0,
    upserted: 0,
    linked: 0,
    unlinked: 0,
    bySource: {},
    byDataStatus: {},
  };
  let observationBatch = [];
  let linkBatch = [];

  async function flush() {
    const inserted = await insertBatch(observationBatch, linkBatch);
    totals.upserted += inserted.observations;
    totals.linked += inserted.links;
    observationBatch = [];
    linkBatch = [];
    if (totals.read % 1_000 < BATCH_SIZE) {
      console.log(JSON.stringify({ progress: totals.read, upserted: totals.upserted, linked: totals.linked, unlinked: totals.unlinked }));
    }
  }

  for (const source of SOURCES) {
    const filePath = join(dataDirectory, source.file);
    if (!existsSync(filePath)) continue;
    const input = createReadStream(filePath, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let sourceLine = 0;
    for await (const line of lines) {
      sourceLine += 1;
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      const observation = observationFor(source, record, sourceLine);
      const productKeys = [...new Set(source.keys(record).map(normalizeProductKey).filter(Boolean))];
      let linkedProducts = 0;
      for (const key of productKeys) {
        const linkedProductId = productIdByKey.get(key);
        if (!linkedProductId) continue;
        linkBatch.push({
          observation_id: observation.id,
          product_id: linkedProductId,
          product_key: key,
          relation_type: productKeys.length > 1 ? 'shared_query' : 'direct',
        });
        linkedProducts += 1;
      }
      if (linkedProducts === 0) totals.unlinked += 1;
      observationBatch.push(observation);
      totals.read += 1;
      totals.bySource[source.file] = (totals.bySource[source.file] || 0) + 1;
      totals.byDataStatus[observation.data_status] = (totals.byDataStatus[observation.data_status] || 0) + 1;
      if (observationBatch.length >= BATCH_SIZE) await flush();
    }
  }
  await flush();

  const verification = await pool.query(`
    select
      (select count(*)::integer from market_intelligence.raw_observations where source_batch = $1) as observations,
      (select count(*)::integer from market_intelligence.raw_observation_products link join market_intelligence.raw_observations observation on observation.id = link.observation_id where observation.source_batch = $1) as product_links,
      (select count(distinct link.product_id)::integer from market_intelligence.raw_observation_products link join market_intelligence.raw_observations observation on observation.id = link.observation_id where observation.source_batch = $1) as products_with_raw_data
  `, [sourceBatch]);
  console.log(JSON.stringify({ totals, database: verification.rows[0] }, null, 2));
} finally {
  await pool.end();
}
