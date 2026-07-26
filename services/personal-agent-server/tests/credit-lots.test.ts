import assert from 'node:assert/strict';
import test from 'node:test';
import { planFifoAllocations } from '../src/credit-lots.js';

test('allocates Credits from the oldest available lots first', () => {
  assert.deepEqual(
    planFifoAllocations(
      [
        { id: 'welcome', availableCredits: 100 },
        { id: 'subscription', availableCredits: 250 },
        { id: 'pack', availableCredits: 500 },
      ],
      300,
    ),
    {
      allocations: [
        { lotId: 'welcome', amountCredits: 100 },
        { lotId: 'subscription', amountCredits: 200 },
      ],
      allocatedCredits: 300,
      unallocatedCredits: 0,
    },
  );
});

test('reports overdrawn Credits when lots cannot cover the debit', () => {
  assert.deepEqual(
    planFifoAllocations(
      [
        { id: 'oldest', availableCredits: 40 },
        { id: 'newest', availableCredits: 10 },
      ],
      75,
    ),
    {
      allocations: [
        { lotId: 'oldest', amountCredits: 40 },
        { lotId: 'newest', amountCredits: 10 },
      ],
      allocatedCredits: 50,
      unallocatedCredits: 25,
    },
  );
});

test('ignores exhausted and invalid lot balances', () => {
  assert.deepEqual(
    planFifoAllocations(
      [
        { id: 'empty', availableCredits: 0 },
        { id: 'invalid', availableCredits: -10 },
        { id: 'active', availableCredits: 20.4 },
      ],
      15.2,
    ),
    {
      allocations: [{ lotId: 'active', amountCredits: 15 }],
      allocatedCredits: 15,
      unallocatedCredits: 0,
    },
  );
});
