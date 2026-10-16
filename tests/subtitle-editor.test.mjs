import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterSubtitles,
  getSubtitleEditMetrics,
  mergeShortSubtitles,
  mergeSubtitleWithNext,
  shiftSubtitleAt,
  shiftSubtitles,
  splitSubtitleAt,
  updateSubtitleTimingAt,
  updateSubtitleTextAt,
} from '../src/subtitle-editor.js';

const sampleSubtitles = [
  { start: 0.2, end: 1.4, original: 'Hello world', translated: '안녕하세요', status: 'translated' },
  { start: 3, end: 5, original: 'Missing line', translated: '', status: 'failed' },
  { start: 8, end: 10, original: 'Export result', translated: '결과 내보내기', status: 'translated' },
];

test('short subtitle merging preserves long silence gaps including a trailing short cue', () => {
  const subtitles = [
    { start: 0, end: 1, original: 'Hi' },
    { start: 120, end: 121, original: 'Bye' },
    { start: 130, end: 136, original: 'A longer complete sentence' },
    { start: 140, end: 141, original: 'End' },
  ];
  assert.deepEqual(mergeShortSubtitles(subtitles), subtitles);
});

test('short subtitle merging bounds resulting duration and text length', () => {
  const durationCues = Array.from({ length: 6 }, (_, index) => ({ start: index, end: index + 1, original: 'Hi' }));
  assert.deepEqual(mergeShortSubtitles(durationCues).map(({ start, end }) => [start, end]), [[0, 4], [4, 6]]);
  const textCues = [
    { start: 0, end: 1, original: 'A'.repeat(24) },
    { start: 1, end: 2, original: 'B'.repeat(24) },
  ];
  assert.deepEqual(mergeShortSubtitles(textCues), textCues);
});

test('short subtitle merging supports a zero gap limit', () => {
  const subtitles = [{ start: 0, end: 1, original: 'Hi' }, { start: 1.1, end: 2, original: 'Bye' }];
  assert.deepEqual(mergeShortSubtitles(subtitles, { maxGap: 0 }), subtitles);
});

test('warning filter uses the same custom thresholds as editor metrics', () => {
  const subtitles = [{ start: 0, end: 3, original: 'Text' }, { start: 4, end: 5, original: 'Longer text' }];
  assert.deepEqual(filterSubtitles(subtitles, { status: 'warning', maxDuration: 2, maxTextLength: 8, maxCps: 30 }), subtitles);
  assert.deepEqual(filterSubtitles(subtitles, { status: 'warning', maxDuration: 10, maxTextLength: 100, maxCps: 100 }), []);
});

test('filterSubtitles searches original and translated text case-insensitively', () => {
  assert.deepEqual(filterSubtitles(sampleSubtitles, { query: 'hello' }), [sampleSubtitles[0]]);
  assert.deepEqual(filterSubtitles(sampleSubtitles, { query: '내보내기' }), [sampleSubtitles[2]]);
});

test('filterSubtitles can show only failed subtitles', () => {
  assert.deepEqual(filterSubtitles(sampleSubtitles, { status: 'failed' }), [sampleSubtitles[1]]);
});

test('filterSubtitles can show only quality warning subtitles', () => {
  const subtitles = [
    { start: 0, end: 2, original: 'Short line', translated: 'Short line' },
    {
      start: 2,
      end: 2.5,
      original: 'This subtitle is much too long to read in half a second',
      translated: '',
    },
  ];

  assert.deepEqual(filterSubtitles(subtitles, { status: 'warning' }), [subtitles[1]]);
});

test('updateSubtitleTextAt edits original or translated text without mutating input', () => {
  const updated = updateSubtitleTextAt(sampleSubtitles, 0, 'translated', '반갑습니다');

  assert.equal(updated[0].translated, '반갑습니다');
  assert.equal(sampleSubtitles[0].translated, '안녕하세요');
  assert.equal(updated[1], sampleSubtitles[1]);
});

test('shiftSubtitles shifts every cue and clamps negative start times', () => {
  assert.deepEqual(shiftSubtitles(sampleSubtitles, -0.5).map(({ start, end }) => ({ start, end })), [
    { start: 0, end: 0.9 },
    { start: 2.5, end: 4.5 },
    { start: 7.5, end: 9.5 },
  ]);
});

test('shiftSubtitleAt shifts only one cue and preserves at least one millisecond duration', () => {
  const shifted = shiftSubtitleAt(sampleSubtitles, 0, -1);

  assert.equal(shifted[0].start, 0);
  assert.equal(shifted[0].end, 0.4);
  assert.equal(shifted[1], sampleSubtitles[1]);
});

test('updateSubtitleTimingAt edits cue timing and preserves a minimum duration', () => {
  const updated = updateSubtitleTimingAt(sampleSubtitles, 0, { start: 1.2345, end: 1 });

  assert.equal(updated[0].start, 1.235);
  assert.equal(updated[0].end, 1.236);
  assert.equal(sampleSubtitles[0].start, 0.2);
  assert.equal(updated[1], sampleSubtitles[1]);
});

test('splitSubtitleAt divides timing and text without mutating input', () => {
  const split = splitSubtitleAt(sampleSubtitles, 0);

  assert.equal(split.length, sampleSubtitles.length + 1);
  assert.deepEqual(split.slice(0, 2).map(({ start, end }) => ({ start, end })), [
    { start: 0.2, end: 0.8 },
    { start: 0.8, end: 1.4 },
  ]);
  assert.equal(split[0].original, 'Hello');
  assert.equal(split[1].original, 'world');
  assert.equal(sampleSubtitles[0].original, 'Hello world');
});

test('mergeSubtitleWithNext combines adjacent cue timing and text', () => {
  const merged = mergeSubtitleWithNext(sampleSubtitles, 0);

  assert.equal(merged.length, sampleSubtitles.length - 1);
  assert.deepEqual(
    { start: merged[0].start, end: merged[0].end, original: merged[0].original },
    { start: 0.2, end: 5, original: 'Hello world Missing line' },
  );
});

test('mergeShortSubtitles combines short runs while preserving their time range', () => {
  const merged = mergeShortSubtitles([
    { start: 0, end: 2, original: 'Normal first', translated: 'Normal first' },
    { start: 2.2, end: 3.1, original: 'You,', translated: '너도,' },
    { start: 3.1, end: 4, original: 'you,', translated: '너도,' },
    { start: 4.5, end: 7, original: 'Normal last', translated: 'Normal last' },
  ]);

  assert.deepEqual(
    merged.map(({ start, end, translated }) => ({ start, end, translated })),
    [
      { start: 0, end: 2, translated: 'Normal first' },
      { start: 2.2, end: 4, translated: '너도, 너도,' },
      { start: 4.5, end: 7, translated: 'Normal last' },
    ],
  );
});

test('getSubtitleEditMetrics reports duration length and cps warnings', () => {
  const metrics = getSubtitleEditMetrics(
    { start: 0, end: 1, original: 'This line is too fast to read comfortably', translated: '' },
    { maxTextLength: 20, maxDuration: 0.5, maxCps: 12 },
  );

  assert.equal(metrics.duration, 1);
  assert.equal(metrics.length, 41);
  assert.equal(metrics.cps, 41);
  assert.deepEqual(metrics.warnings, ['long-text', 'long-duration', 'high-cps']);
});
