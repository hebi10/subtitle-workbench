import assert from 'node:assert/strict';
import test from 'node:test';
import { createJobRunner } from '../src/job-runner.js';

test('batch keeps completed results when the next file fails and remains locked until cleanup', async () => {
  const saved = [];
  const busy = [];
  const errors = [];
  const runner = createJobRunner({
    runJob: async (file) => {
      if (file === 'second') throw new Error('recognition failed');
      return [{ original: file }];
    },
    onComplete: (file, subtitles) => saved.push({ file, subtitles }),
    onError: (file, error) => errors.push([file, error.message]),
    onBusy: (value) => busy.push(value),
  });
  const result = await runner.run(['first', 'second', 'third'], {});
  assert.deepEqual(saved, [{ file: 'first', subtitles: [{ original: 'first' }] }]);
  assert.deepEqual(errors, [['second', 'recognition failed']]);
  assert.deepEqual(busy, [true, false]);
  assert.deepEqual(result, { completed: 1, failed: 1, pending: 1, cancelled: false });
});

test('a cancelled batch waits for active work and refuses a concurrent run', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = [];
  const saved = [];
  const runner = createJobRunner({
    runJob: async (file, { signal }) => {
      started.push(file);
      await gate;
      signal.throwIfAborted();
      return file;
    },
    onComplete: (file) => saved.push(file),
  });
  const first = runner.run(['first', 'second']);
  runner.cancel();
  assert.equal(runner.isBusy, true);
  await assert.rejects(runner.run(['third']), /진행 중/);
  release();
  assert.deepEqual(await first, { completed: 0, failed: 0, pending: 2, cancelled: true });
  assert.deepEqual(started, ['first']);
  assert.deepEqual(saved, []);
  assert.equal(runner.isBusy, false);
});

test('each run uses a fresh signal and saves every successful file in order', async () => {
  const saved = [];
  const signals = [];
  const runner = createJobRunner({
    runJob: async (file, { signal, index, total, settings }) => {
      signals.push(signal);
      assert.equal(signal.aborted, false);
      assert.equal(settings.language, 'ko');
      return `${file}:${index}/${total}`;
    },
    onComplete: (file, result) => saved.push(result),
  });
  await runner.run(['one', 'two'], { language: 'ko' });
  await runner.run(['three'], { language: 'ko' });
  assert.deepEqual(saved, ['one:0/2', 'two:1/2', 'three:0/1']);
  assert.equal(signals[0], signals[1]);
  assert.notEqual(signals[1], signals[2]);
});
