import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditHistory, commitEdit, undoEdit, redoEdit } from '../src/edit-history.js';

const cues = (translated) => [{ start: 0, end: 2, original: 'Hello', translated }];

test('edit history restores edits in both directions and preserves boundary states', () => {
  const initial = createEditHistory(cues('첫째'));
  assert.deepEqual(undoEdit(initial), initial);
  assert.deepEqual(redoEdit(initial), initial);
  const second = commitEdit(initial, cues('둘째'));
  const third = commitEdit(second, cues('셋째'));
  const undone = undoEdit(third);
  assert.deepEqual(undone.present, cues('둘째'));
  assert.deepEqual(undoEdit(undone).present, cues('첫째'));
  assert.deepEqual(redoEdit(undone), third);
  assert.deepEqual(redoEdit(third), third);
  assert.deepEqual(initial.present, cues('첫째'));
  assert.deepEqual(third.present, cues('셋째'));
});

test('unchanged commits keep history and redo while new edits discard redo', () => {
  const initial = createEditHistory(cues('첫째'));
  const undone = undoEdit(commitEdit(initial, cues('둘째')));
  const unchanged = commitEdit(undone, [{ translated: '첫째', original: 'Hello', end: 2, start: 0 }]);
  assert.deepEqual(unchanged, undone);
  const changed = commitEdit(undone, cues('셋째'));
  assert.equal(changed.future.length, 0);
  assert.equal(changed.past.length, 1);
  assert.deepEqual(redoEdit(changed).present, cues('셋째'));
});

test('history keeps only the configured number of undo steps', () => {
  let history = createEditHistory(cues('0'), 2);
  for (let index = 1; index <= 3; index += 1) {
    history = commitEdit(history, cues(String(index)));
  }
  assert.equal(history.past.length, 2);
  const earliest = undoEdit(undoEdit(history));
  assert.deepEqual(earliest.present, cues('1'));
  assert.deepEqual(undoEdit(earliest), earliest);
  assert.equal(createEditHistory().limit, 50);
  const disabled = commitEdit(createEditHistory([], 0), cues('1'));
  assert.equal(disabled.past.length, 0);
});

test('initial and committed subtitles are independent from caller mutations', () => {
  const source = cues('첫째');
  const initial = createEditHistory(source);
  source[0].translated = '변조';
  assert.deepEqual(initial.present, cues('첫째'));
  const edits = cues('둘째');
  const committed = commitEdit(initial, edits);
  edits[0].translated = '변조';
  assert.deepEqual(committed.present, cues('둘째'));
  committed.past[0][0].translated = '변조';
  assert.deepEqual(initial.present, cues('첫째'));
});

test('undo redo and unchanged results do not share mutable snapshots with their inputs', () => {
  const history = commitEdit(commitEdit(createEditHistory(cues('0')), cues('1')), cues('2'));
  const before = structuredClone(history);
  const undone = undoEdit(history);
  const redone = redoEdit(undone);
  redone.present[0].translated = '변조';
  redone.past[0][0].translated = '변조';
  assert.deepEqual(undone.present, cues('1'));
  assert.deepEqual(undone.past[0], cues('0'));
  undone.future[0][0].translated = '변조';
  assert.deepEqual(history, before);
  const unchanged = commitEdit(history, history.present);
  unchanged.present[0].translated = '변조';
  unchanged.past[0][0].translated = '변조';
  assert.deepEqual(history, before);
});
