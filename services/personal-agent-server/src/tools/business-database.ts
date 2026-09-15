import type { ServerConfig } from '../config.js';
import { listMarketProducts, type PgPool, type ListMarketProductsInput } from '../market-intelligence-store.js';
import { isRecord } from '../util.js';

export const BUSINESS_TOOL_NAMES = ['search_businesses', 'get_business_details', 'get_business_metrics'] as const;
const idsSchema = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 20, uniqueItems: true };
export function createBusinessDatabaseTools() {
  return BUSINESS_TOOL_NAMES.map((name) => ({
    namespace: null, name, deferLoading: false,
    description: ({
      search_businesses: 'Search the built-in Business Database (always available independently of connectors). Read-only real data; company-primary results may aggregate multiple products. Search first, then fetch details/metrics by ID. Estimates are not measured facts.',
      get_business_details: 'Read up to 20 Business Database product IDs, including company grouping, metric definitions, sources and estimate evidence. Missing IDs are reported. Never writes data.',
      get_business_metrics: 'Read monthly traffic, estimated users and estimated revenue for up to 20 product IDs over a month range (maximum 36 months). These are calendar-month records, not rolling app downloads/revenue; missing observations remain absent. Never writes data.',
    })[name],
    inputSchema: { type: 'object', additionalProperties: false, properties: name === 'search_businesses' ? {
      query: { type: 'string', maxLength: 120 }, category: { type: 'string', maxLength: 100 }, productType: { type: 'string', maxLength: 100 },
      sort: { type: 'string', enum: ['rank', 'audience', 'trend', 'revenue', 'newest'] },
      limit: { type: 'integer', minimum: 1, maximum: 50 }, offset: { type: 'integer', minimum: 0, maximum: 100000 },
    } : name === 'get_business_details' ? { ids: idsSchema } : {
      ids: idsSchema, fromMonth: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }, toMonth: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
      metrics: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: ['traffic', 'users', 'revenue'] } },
    }, required: name === 'search_businesses' ? [] : name === 'get_business_details' ? ['ids'] : ['ids', 'fromMonth', 'toMonth'] },
  }));
}

export function parseBusinessArguments(name: string, value: unknown) {
  if (!BUSINESS_TOOL_NAMES.includes(name as typeof BUSINESS_TOOL_NAMES[number]) || !isRecord(value)) throw new Error('Invalid business query.');
  const allowed = name === 'search_businesses' ? ['query', 'category', 'productType', 'sort', 'limit', 'offset'] : name === 'get_business_details' ? ['ids'] : ['ids', 'fromMonth', 'toMonth', 'metrics'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Unsupported query parameter.');
  if (name === 'search_businesses') {
    for (const key of ['query', 'category', 'productType']) if (value[key] !== undefined && (typeof value[key] !== 'string' || (value[key] as string).length > (key === 'query' ? 120 : 100))) throw new Error(`Invalid ${key}.`);
    if (value.sort !== undefined && !['rank', 'audience', 'trend', 'revenue', 'newest'].includes(String(value.sort))) throw new Error('Invalid sort.');
    for (const [key, min, max] of [['limit', 1, 50], ['offset', 0, 100000]] as const) if (value[key] !== undefined && (!Number.isInteger(value[key]) || Number(value[key]) < min || Number(value[key]) > max)) throw new Error(`Invalid ${key}.`);
  } else {
    if (!Array.isArray(value.ids) || !value.ids.length || value.ids.length > 20 || value.ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200) || new Set(value.ids).size !== value.ids.length) throw new Error('Provide 1–20 unique product IDs.');
    if (name === 'get_business_metrics') {
      const month = (v: unknown) => { if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new Error('Use YYYY-MM dates.'); return Number(v.slice(0, 4)) * 12 + Number(v.slice(5)); };
      const span = month(value.toMonth) - month(value.fromMonth);
      if (span < 0 || span >= 36) throw new Error('Choose an ordered range of at most 36 months.');
      if (value.metrics !== undefined && (!Array.isArray(value.metrics) || !value.metrics.length || value.metrics.some((m) => !['traffic', 'users', 'revenue'].includes(String(m))))) throw new Error('Invalid metrics.');
    }
  }
  return value;
}

type ReadClient = PgPool & { release(): void };
type ReadPool = { connect(): Promise<ReadClient> };
let readPool: ReadPool | undefined;
export function resolveBusinessDatabaseUrl(config: ServerConfig) {
  return process.env.BUSINESS_DATABASE_READONLY_URL?.trim() || config.contextDatabaseUrl?.trim() || config.databaseUrl?.trim() || '';
}

async function getReadPool(config: ServerConfig): Promise<ReadPool> {
  if (readPool) return readPool;
  const connectionString = resolveBusinessDatabaseUrl(config);
  if (!connectionString) throw new Error('Business Database is temporarily unavailable.');
  const pg = await import('pg') as unknown as { Pool: new (options: Record<string, unknown>) => ReadPool };
  readPool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000, options: '-c default_transaction_read_only=on -c statement_timeout=10000' });
  return readPool;
}

export async function withBusinessReadTransaction<T>(pool: ReadPool, work: (client: PgPool) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function queryBusinessDatabase(name: string, args: Record<string, unknown>, config: ServerConfig, db: PgPool) {
  if (name === 'search_businesses') {
    const result = await listMarketProducts(config, { ...args, dataset: 'actual', limit: Number(args.limit || 20) } as ListMarketProductsInput, db);
    return { ...result, filterOptions: undefined, products: result.products.map(({ revenueEstimateDetails, audienceEstimateDetails, companyGroup, ...p }) => ({ ...p, description: p.description.slice(0, 400), companyGroup: { ...companyGroup, childProducts: undefined } })) };
  }
  const ids = args.ids as string[];
  const products = await db.query(`SELECT id, name, domain, website_url, product_hunt_url, tagline, description, category, topics, product_types,
    company_group_key, company_name, company_product_count, is_company_primary, monthly_traffic, traffic_growth_pct,
    monthly_new_revenue_usd, revenue_estimate_low_usd, revenue_estimate_high_usd, revenue_estimate_source, revenue_estimate_month,
    revenue_period_kind, estimate_method_version, revenue_estimate_details, audience_estimate_details, data_confidence, metrics_updated_at
     , (SELECT jsonb_build_object('observedAt', a.observed_at, 'referenceMonth', a.reference_month,
      'periodStart', a.period_start, 'periodEnd', a.period_end, 'downloads30d', a.total_downloads_30d,
      'revenue30dUsd', a.total_revenue_30d, 'source', a.source, 'confidence', a.confidence, 'coverageStatus', a.coverage_status)
      FROM market_intelligence.product_app_metrics a WHERE a.product_id = p.id AND NOT a.is_mock ORDER BY a.observed_at DESC LIMIT 1) AS latest_app_observation
    FROM market_intelligence.products p WHERE id = ANY($1::text[]) AND is_mock = false ORDER BY array_position($1::text[], id)`, [ids]);
  const missingIds = ids.filter((id) => !products.rows.some((row) => row.id === id));
  if (name === 'get_business_details') return { products: products.rows, missingIds, metricNotes: 'Monthly estimates and rolling 30-day app observations have different scopes and periods. Company aggregates must not be added to their member products. Decimals may be encoded as strings; null means unknown.' };
  const metrics = (args.metrics || ['traffic', 'users', 'revenue']) as string[];
  const columns = [
    ...(metrics.includes('traffic') ? ['m.traffic_visits', 'm.traffic_source'] : []),
    ...(metrics.includes('users') ? ['m.estimated_monthly_users', 'm.estimated_users_low', 'm.estimated_users_high', 'm.user_estimate_source'] : []),
    ...(metrics.includes('revenue') ? ['m.estimated_new_revenue_usd', 'm.revenue_low_usd', 'm.revenue_high_usd', 'm.revenue_source'] : []),
  ];
  const result = await db.query(`SELECT m.product_id, to_char(m.month, 'YYYY-MM') AS month, m.confidence, m.method_version, m.observed_at, ${columns.join(', ')}
    FROM market_intelligence.product_monthly_metrics m JOIN market_intelligence.products p ON p.id = m.product_id
    WHERE m.product_id = ANY($1::text[]) AND NOT m.is_mock AND NOT p.is_mock AND m.month BETWEEN $2::date AND $3::date
    ORDER BY array_position($1::text[], m.product_id), m.month`, [ids, `${args.fromMonth}-01`, `${args.toMonth}-01`]);
  return { products: products.rows.map(({ id, name, company_group_key, is_company_primary }) => ({ id, name, company_group_key, is_company_primary })), missingIds, observations: result.rows, fromMonth: args.fromMonth, toMonth: args.toMonth, metrics, periodKind: 'calendar_month', missingData: 'Absent rows and null values are unknown, not zero. Numeric database decimals may be encoded as strings.' };
}

export async function assertBusinessReadTransaction(db: PgPool) {
  const result = await db.query('SHOW transaction_read_only');
  if (result.rows[0]?.transaction_read_only !== 'on') throw new Error('Business queries require a read-only transaction.');
}

export async function runBusinessDatabaseTool(name: string, value: unknown, config: ServerConfig) {
  let args: Record<string, unknown>;
  try { args = parseBusinessArguments(name, value); } catch (error) { return { success: false, text: JSON.stringify({ error: (error as Error).message }) }; }
  try {
    const data = await withBusinessReadTransaction(await getReadPool(config), async (db) => {
      await assertBusinessReadTransaction(db);
      return queryBusinessDatabase(name, args, config, db);
    });
    const text = JSON.stringify({ source: 'Business Database', dataset: 'actual', readAt: new Date().toISOString(), ...data });
    if (text.length > 120000) return { success: false, text: JSON.stringify({ error: 'Result too large. Retry with fewer IDs, a smaller limit, or a narrower date range.' }) };
    return { success: true, text };
  } catch { return { success: false, text: JSON.stringify({ error: 'Business Database is temporarily unavailable. No data was changed. Do not invent results.' }) }; }
}
