import assert from 'node:assert/strict';
import test from 'node:test';
import type { ServerConfig } from '../src/config.js';
import { deliverTaskMilestones, trackTaskMilestone } from '../src/task-analytics.js';

const config = { ga4MeasurementId: 'G-TEST', ga4ApiSecret: 'test' } as ServerConfig;
const row = {
  investor_id: 'user-1', event_name: 'first_task_completed', run_id: 'run-1',
  context: { clientId: '123.456', sessionId: '789', analyticsConsent: 'granted', adUserDataConsent: 'denied' },
  occurred_at: new Date('2026-09-15T01:00:00Z'), attempts: 1,
};

test('outbox sends original event time and no private task content', async () => {
  const queries: unknown[][] = [];
  let index = 0;
  await deliverTaskMilestones(config, {
    query: async (_sql, values) => {
      queries.push(values || []);
      return { rows: ++index === 2 ? [row] : [] };
    },
  }, async (_config, event) => {
    assert.equal(event.name, 'first_task_completed');
    assert.equal(event.userId, 'user-1');
    assert.deepEqual(event.context, row.context);
    assert.equal(event.timestampMicros, row.occurred_at.getTime() * 1000);
    assert.equal(event.params.task_type, 'personal_agent');
    assert.match(String(event.params.event_id), /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(event.params).sort(), ['event_id', 'task_type']);
    return { sent: true };
  });
  assert.equal(queries[2][3], 'SENT');
});

test('transport failure schedules a retry, never marks delivery successful', async () => {
  const queries: unknown[][] = [];
  let index = 0;
  await deliverTaskMilestones(config, {
    query: async (_sql, values) => {
      queries.push(values || []);
      return { rows: ++index === 2 ? [row] : [] };
    },
  }, async () => { throw new Error('connection reset'); });
  assert.equal(queries[2][3], 'PENDING');
  assert.equal(queries[2][4], 'request_failed');
  assert.equal(queries[2][5], 15);
});

test('missing configuration leaves pending events available for later delivery', async () => {
  await deliverTaskMilestones({} as ServerConfig, {
    query: async () => { throw new Error('must not claim without configuration'); },
  });
});

test('no claimed row means no delivery', async () => {
  await deliverTaskMilestones(config, { query: async () => ({ rows: [] }) }, async () => {
    throw new Error('must not send');
  });
});

test('enqueue errors cannot fail task acceptance or completion', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.doesNotReject(trackTaskMilestone(config, {
      query: async () => { throw new Error('database unavailable'); },
    }, 'run-1', 'first_task_submitted'));
  } finally { console.warn = warn; }
});
