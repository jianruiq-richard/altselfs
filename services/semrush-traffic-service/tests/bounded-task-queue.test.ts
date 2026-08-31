import assert from 'node:assert/strict';
import test from 'node:test';
import { BoundedSerialTaskQueue, QueueFullError } from '../src/bounded-task-queue.js';

test('runs one task at a time, queues three, and rejects the fifth request', async () => {
  const queue = new BoundedSerialTaskQueue(3);
  const gates = Array.from({ length: 4 }, deferred<void>);
  const started: number[] = [];
  const finished: number[] = [];
  let active = 0;
  let maximumActive = 0;

  const tasks = gates.map((gate, index) => queue.enqueue(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    started.push(index);
    await gate.promise;
    finished.push(index);
    active -= 1;
    return index;
  }));

  assert.deepEqual(queue.snapshot(), {
    active: 1,
    waiting: 3,
    maxActive: 1,
    maxWaiting: 3,
    capacity: 4,
  });
  await assert.rejects(
    queue.enqueue(async () => 4),
    (error: unknown) => error instanceof QueueFullError
      && error.code === 'QUEUE_FULL'
      && error.queue.waiting === 3,
  );

  for (let index = 0; index < gates.length; index += 1) {
    assert.deepEqual(started, Array.from({ length: index + 1 }, (_, value) => value));
    gates[index].resolve();
    await waitFor(() => finished.length === index + 1);
    if (index + 1 < gates.length) await waitFor(() => started.length === index + 2);
  }

  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(queue.snapshot(), {
    active: 0,
    waiting: 0,
    maxActive: 1,
    maxWaiting: 3,
    capacity: 4,
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for queue state');
}
