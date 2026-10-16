import assert from 'node:assert/strict';
import test from 'node:test';

import { mapWithConcurrency } from '../src/limited-concurrency.js';

test('worker failure aborts siblings, stops queued work and waits for active work to settle', async () => {
  const started = [];
  const failure = new Error('first failure');
  let release;
  let siblingSignal;
  let settled = false;
  const pending = mapWithConcurrency([0, 1, 2, 3], 2, async (item, index, signal) => {
    started.push(item);
    if (item === 0) {
      await Promise.resolve();
      throw failure;
    }
    siblingSignal = signal;
    await new Promise((resolve) => { release = resolve; });
    return index;
  });
  const observed = pending.catch((error) => { settled = true; return error; });
  await new Promise((resolve) => setImmediate(resolve));
  const aborted = siblingSignal?.aborted;
  const settledBeforeRelease = settled;
  release();
  assert.equal(await observed, failure);
  assert.equal(aborted, true);
  assert.equal(settledBeforeRelease, false);
  assert.deepEqual(started, [0, 1]);
});

test('external cancellation aborts active workers and prevents later items', async () => {
  const controller = new AbortController();
  const started = [];
  const pending = mapWithConcurrency([0, 1, 2], 2, async (item, index, signal) => {
    started.push(item);
    if (!signal) return item;
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(started, [0, 1]);
});

test('already aborted operations never start workers', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(mapWithConcurrency([0], 1, () => { calls += 1; }, {
    signal: controller.signal,
  }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('mapWithConcurrency preserves result order while limiting active tasks', async () => {
  let active = 0;
  let maxActive = 0;
  const started = [];

  const results = await mapWithConcurrency([30, 10, 20, 5], 2, async (delay, index) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    started.push(index);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return `item-${index}`;
  });

  assert.deepEqual(results, ['item-0', 'item-1', 'item-2', 'item-3']);
  assert.equal(maxActive, 2);
  assert.deepEqual(started.slice(0, 2), [0, 1]);
});

test('mapWithConcurrency rejects when a worker fails', async () => {
  await assert.rejects(
    () => mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) {
        throw new Error('worker failed');
      }
      return item;
    }),
    /worker failed/,
  );
});
