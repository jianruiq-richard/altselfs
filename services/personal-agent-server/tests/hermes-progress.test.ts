import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HERMES_UPDATE_PLAN_TOOL_DEFINITION,
  parseHermesPlanUpdate,
} from '../src/hermes/hermes-progress.js';

test('Hermes plan updates preserve every step without a count limit', () => {
  const steps = Array.from({ length: 24 }, (_, index) => ({
    id: `step-${index + 1}`,
    title: `Execute step ${index + 1}`,
    status: index === 0 ? 'in_progress' : 'pending',
  }));

  const plan = parseHermesPlanUpdate({
    summary: 'Complete the full research workflow',
    steps,
  });

  assert.equal(plan.steps.length, 24);
  assert.equal(plan.steps[23]?.id, 'step-24');
  assert.equal(
    Object.prototype.hasOwnProperty.call(HERMES_UPDATE_PLAN_TOOL_DEFINITION.inputSchema.properties.steps, 'maxItems'),
    false
  );
});

test('Hermes plan updates reject duplicate step IDs and unsupported statuses', () => {
  assert.throws(
    () => parseHermesPlanUpdate({
      steps: [
        { id: 'research', title: 'Research', status: 'pending' },
        { id: 'research', title: 'Research again', status: 'pending' },
      ],
    }),
    /duplicated/
  );
  assert.throws(
    () => parseHermesPlanUpdate({
      steps: [{ id: 'research', title: 'Research', status: 'cancelled' }],
    }),
    /status must be/
  );
});
