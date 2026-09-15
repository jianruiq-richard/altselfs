import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { TASK_ANALYTICS_SCHEMA, trackTaskMilestone, deliverTaskMilestones } from '../src/task-analytics.js';

// Explicit opt-in. All fixtures live in connection-local temporary tables and
// the transaction is rolled back; no production rows or schemas are modified.
test('PostgreSQL milestones: eligibility, history, deduplication, consent and retry', {
  skip: process.env.TASK_ANALYTICS_POSTGRES_TEST !== '1',
}, async () => {
  const { Client } = createRequire(import.meta.url)('pg');
  const client = new Client({ connectionString: process.env.AGENT_CONTEXT_DATABASE_URL });
  await client.connect();
  const config = { ga4MeasurementId: 'G-TEST', ga4ApiSecret: 'test' };
  try {
    await client.query('begin');
    await client.query(`create temporary table agent_context_runs (
      id text primary key, investor_id text, status text, request jsonb,
      created_at timestamptz not null default now(), queued_at timestamptz,
      started_at timestamptz, completed_at timestamptz
    ) on commit drop`);
    await client.query('set local search_path to pg_temp');
    await client.query(TASK_ANALYTICS_SCHEMA);
    const add = async (id, user, status, consent = 'granted', age = 0) => {
      await client.query(`insert into agent_context_runs
        (id, investor_id, status, request, created_at, started_at, completed_at)
        values ($1,$2,$3,$4, now() - ($5 * interval '1 hour'),
          case when $3 = 'REJECTED_CREDITS' then null else now() - ($5 * interval '1 hour') end,
          case when $3 = 'SUCCESS' then now() - ($5 * interval '1 hour') else null end)`,
      [id, user, status, JSON.stringify({ metadata: { analytics: {
        clientId: '123.456', sessionId: '789', analyticsConsent: consent,
      } } }), age]);
    };
    await add('rejected', 'new', 'REJECTED_CREDITS');
    await trackTaskMilestone(config, client, 'rejected', 'first_task_submitted');
    assert.equal((await client.query('select * from agent_task_milestones')).rowCount, 0);
    await add('accepted', 'new', 'RUNNING');
    for (let attempt = 0; attempt < 3; attempt++) await trackTaskMilestone(config, client, 'accepted', 'first_task_submitted');
    assert.equal((await client.query('select * from agent_task_milestones')).rowCount, 1);
    await trackTaskMilestone(config, client, 'accepted', 'first_task_completed');
    assert.equal((await client.query('select * from agent_task_milestones')).rowCount, 1);
    await client.query("update agent_context_runs set status = 'ERROR' where id = 'accepted'");
    await add('success', 'new', 'SUCCESS');
    await trackTaskMilestone(config, client, 'success', 'first_task_completed');
    assert.equal((await client.query('select * from agent_task_milestones')).rowCount, 2);
    await add('historical', 'old', 'SUCCESS', 'granted', 24);
    await add('returning', 'old', 'SUCCESS');
    for (const event of ['first_task_submitted', 'first_task_completed']) await trackTaskMilestone(config, client, 'returning', event);
    assert.equal((await client.query("select * from agent_task_milestones where investor_id = 'old'")).rowCount, 0);
    await add('declined', 'privacy', 'SUCCESS', 'denied');
    await trackTaskMilestone(config, client, 'declined', 'first_task_completed');
    assert.equal((await client.query("select delivery_status from agent_task_milestones where investor_id = 'privacy'")).rows[0].delivery_status, 'SKIPPED');
    let sends = 0;
    await deliverTaskMilestones(config, client, async () => { sends++; return { sent: false, reason: 'request_failed' }; });
    assert.equal(sends, 2);
    assert.equal((await client.query("select * from agent_task_milestones where delivery_status = 'PENDING' and attempts = 1")).rowCount, 2);
    await deliverTaskMilestones(config, client, async () => { throw new Error('retry should wait'); });
    await client.query("update agent_task_milestones set available_at = now() where delivery_status = 'PENDING'");
    await deliverTaskMilestones(config, client, async () => { sends++; return { sent: true }; });
    assert.equal(sends, 4);
    assert.equal((await client.query("select * from agent_task_milestones where delivery_status = 'SENT'")).rowCount, 2);
    await deliverTaskMilestones(config, client, async () => { throw new Error('already sent'); });
    await add('expired', 'expiry', 'SUCCESS', 'granted', 71);
    await trackTaskMilestone(config, client, 'expired', 'first_task_completed');
    await deliverTaskMilestones(config, client, async () => { throw new Error('expired'); });
    assert.equal((await client.query("select delivery_status from agent_task_milestones where investor_id = 'expiry'")).rows[0].delivery_status, 'EXPIRED');
  } finally {
    await client.query('rollback');
    await client.end();
  }
});
