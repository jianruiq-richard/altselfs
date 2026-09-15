import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBusinessReadTransaction, resolveBusinessDatabaseUrl, createBusinessDatabaseTools, parseBusinessArguments, queryBusinessDatabase, withBusinessReadTransaction } from '../src/tools/business-database.js';
import { businessSelectionContext, parseBusinessSelection } from '../../../src/lib/business-selection.js';
import type { ServerConfig } from '../src/config.js';

test('three built-in tools are eager, have bounded schemas and reject write/raw SQL arguments', () => {
  assert.deepEqual(createBusinessDatabaseTools().map((t) => t.name), ['search_businesses', 'get_business_details', 'get_business_metrics']);
  assert.ok(createBusinessDatabaseTools().every((t) => t.deferLoading === false));
  for (const args of [{ sql: 'DELETE FROM products' }, { dataset: 'mock' }, { limit: 51 }, { offset: -1 }]) assert.throws(() => parseBusinessArguments('search_businesses', args));
  assert.throws(() => parseBusinessArguments('get_business_details', { ids: Array.from({ length: 21 }, (_, i) => String(i)) }));
  assert.throws(() => parseBusinessArguments('get_business_metrics', { ids: ['a'], fromMonth: '2026-13', toMonth: '2026-14' }));
  assert.throws(() => parseBusinessArguments('get_business_metrics', { ids: ['a'], fromMonth: '2020-01', toMonth: '2026-01' }));
});

test('read transaction commits only on success and rolls back/releases on failure', async () => {
  for (const fails of [false, true]) {
    const calls: string[] = [];
    const pool = { connect: async () => ({ query: async (sql: string) => { calls.push(sql); return { rows: [] }; }, release: () => calls.push('release') }) };
    const work = withBusinessReadTransaction(pool, async (db) => { await db.query('SELECT 1'); if (fails) throw new Error('test'); return 1; });
    if (fails) await assert.rejects(work); else assert.equal(await work, 1);
    assert.deepEqual(calls, ['BEGIN READ ONLY', 'SELECT 1', fails ? 'ROLLBACK' : 'COMMIT', 'release']);
  }
});

test('details bind IDs, exclude mock records and report missing IDs', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const maliciousId = "x'); DELETE FROM products; --";
  const result = await queryBusinessDatabase('get_business_details', { ids: ['a', maliciousId] }, {} as ServerConfig, {
    query: async (sql, values) => { calls.push({ sql, values }); return { rows: [{ id: 'a', name: 'A', monthly_new_revenue_usd: null }] }; },
  });
  assert.deepEqual(result.missingIds, [maliciousId]);
  assert.ok(!calls[0].sql.includes(maliciousId));
  assert.match(calls[0].sql, /is_mock = false/);
  assert.deepEqual(calls[0].values, [['a', maliciousId]]);
});

test('search reuses page read query without schema initialization', async () => {
  const calls: string[] = [];
  await queryBusinessDatabase('search_businesses', {}, {} as ServerConfig, { query: async (sql) => { calls.push(sql); return { rows: [] }; } });
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((sql) => /^\s*select\b/i.test(sql)));
  assert.match(calls[0], /p.is_mock = false/);
});

test('metrics preserve requested dates and whitelist columns, never fill missing observations', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const args = parseBusinessArguments('get_business_metrics', { ids: ['a'], fromMonth: '2026-01', toMonth: '2026-03', metrics: ['traffic'] });
  const result = await queryBusinessDatabase('get_business_metrics', args, {} as ServerConfig, { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } });
  assert.deepEqual(result.observations, []);
  assert.match(calls[1].sql, /NOT m.is_mock AND NOT p.is_mock/);
  assert.ok(!calls[1].sql.includes('m.estimated_new_revenue_usd'));
  assert.deepEqual(calls[1].values, [['a'], '2026-01-01', '2026-03-01']);
});

test('selection round trip preserves exact IDs and scope, rejects invalid handoffs', () => {
  const selection = { items: [{ id: 'product-a', name: 'Company A' }], scope: 'filtered', selectedAt: '2026-09-15T00:00:00Z', totalMatched: 120, filters: { query: 'AI', category: 'all', productType: 'all', sort: 'revenue' } };
  const parsed = parseBusinessSelection(JSON.parse(JSON.stringify(selection)))!;
  assert.deepEqual(parsed, selection);
  assert.ok(businessSelectionContext(parsed).includes('product-a'));
  assert.throws(() => parseBusinessSelection({ ...selection, items: [] }));
  assert.throws(() => parseBusinessSelection({ ...selection, items: [...selection.items, ...selection.items] }));
  assert.throws(() => parseBusinessSelection({ ...selection, totalMatched: 0 }));
});


test('business tools fail closed outside a verified read-only transaction', async () => {
  for (const rows of [[{ transaction_read_only: 'off' }], []]) {
    await assert.rejects(assertBusinessReadTransaction({ query: async () => ({ rows }) }));
  }
  await assertBusinessReadTransaction({ query: async (sql) => {
    assert.equal(sql, 'SHOW transaction_read_only');
    return { rows: [{ transaction_read_only: 'on' }] };
  } });
});

test('reuse the existing context database while allowing an explicit reader override', () => {
  const previous = process.env.BUSINESS_DATABASE_READONLY_URL;
  try {
    delete process.env.BUSINESS_DATABASE_READONLY_URL;
    assert.equal(resolveBusinessDatabaseUrl({ contextDatabaseUrl: ' context ', databaseUrl: 'fallback' } as ServerConfig), 'context');
    assert.equal(resolveBusinessDatabaseUrl({ databaseUrl: 'fallback' } as ServerConfig), 'fallback');
    assert.equal(resolveBusinessDatabaseUrl({} as ServerConfig), '');
    process.env.BUSINESS_DATABASE_READONLY_URL = ' reader ';
    assert.equal(resolveBusinessDatabaseUrl({ contextDatabaseUrl: 'context' } as ServerConfig), 'reader');
  } finally {
    if (previous === undefined) delete process.env.BUSINESS_DATABASE_READONLY_URL;
    else process.env.BUSINESS_DATABASE_READONLY_URL = previous;
  }
});
