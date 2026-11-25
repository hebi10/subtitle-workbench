import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findActiveSubtitle,
  createSubtitleLookup,
  formatSubtitleForMode,
  parseJsonSubtitles,
  parseSrt,
  parseSubtitleFileText,
  parseVtt,
} from '../src/subtitle-player.js';

test('parseSrt reads numbered cues and comma timestamps', () => {
  const subtitles = parseSrt([
    '1',
    '00:00:02,100 --> 00:00:05,800',
    'Hello everyone.',
    '',
    '2',
    '00:10:30,500 --> 00:10:34,200',
    'This is an important point.',
  ].join('\n'));

  assert.deepEqual(subtitles, [
    { start: 2.1, end: 5.8, original: 'Hello everyone.', translated: '' },
    { start: 630.5, end: 634.2, original: 'This is an important point.', translated: '' },
  ]);
});

test('parseVtt reads webvtt cues with cue settings', () => {
  const subtitles = parseVtt([
    'WEBVTT',
    '',
    'intro',
    '00:00:12.400 --> 00:00:16.800 align:start position:0%',
    'Today we are going to talk.',
    '',
    '00:00:16.900 --> 00:00:21.200',
    'There are several important points.',
  ].join('\n'));

  assert.deepEqual(subtitles, [
    { start: 12.4, end: 16.8, original: 'Today we are going to talk.', translated: '' },
    { start: 16.9, end: 21.2, original: 'There are several important points.', translated: '' },
  ]);
});

test('parseJsonSubtitles reads generated subtitle arrays and chunk groups', () => {
  assert.deepEqual(
    parseJsonSubtitles(JSON.stringify([
      { start: 2.1, end: 5.8, original: 'Hello.', translated: 'Hi.' },
    ])),
    [{ start: 2.1, end: 5.8, original: 'Hello.', translated: 'Hi.' }],
  );

  assert.deepEqual(
    parseJsonSubtitles(JSON.stringify([
      {
        fileName: 'chunk-002.mp3',
        startTime: 618,
        subtitles: [
          { start: 12.5, end: 16.2, original: 'Important.', translated: 'Translated.' },
        ],
      },
    ])),
    [{ start: 630.5, end: 634.2, original: 'Important.', translated: 'Translated.' }],
  );
});

test('parseSubtitleFileText selects parser from file extension', () => {
  assert.equal(parseSubtitleFileText('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi', 'x.vtt')[0].start, 1);
  assert.equal(parseSubtitleFileText('1\n00:00:01,000 --> 00:00:02,000\nHi', 'x.srt')[0].end, 2);
  assert.equal(parseSubtitleFileText('[{"start":1,"end":2,"original":"Hi"}]', 'x.json')[0].original, 'Hi');
});

test('findActiveSubtitle matches currentTime and applies subtitle offset', () => {
  const subtitles = [
    { start: 10, end: 12, original: 'First', translated: 'Translated first' },
    { start: 20, end: 22, original: 'Second', translated: '' },
  ];

  assert.equal(findActiveSubtitle(subtitles, 10.2)?.original, 'First');
  assert.equal(findActiveSubtitle(subtitles, 12.1), null);
  assert.equal(findActiveSubtitle(subtitles, 10.2, 0.5), null);
  assert.equal(findActiveSubtitle(subtitles, 9.6, -0.5)?.original, 'First');
});

test('formatSubtitleForMode prefers translated text when available', () => {
  const subtitle = {
    start: 1,
    end: 2,
    original: 'Original line',
    translated: 'Translated line',
  };

  assert.deepEqual(formatSubtitleForMode(subtitle, 'translated'), {
    primary: 'Translated line',
    secondary: '',
  });
  assert.deepEqual(formatSubtitleForMode(subtitle, 'original'), {
    primary: 'Original line',
    secondary: '',
  });
  assert.deepEqual(formatSubtitleForMode(subtitle, 'both'), {
    primary: 'Translated line',
    secondary: 'Original line',
  });
});

test('indexed playback matches chronological first active cue, including nested overlaps and backward seeks', () => {
  const cues = [
    { start: 7, end: 10, original: 'late' },
    { start: 1, end: 8, original: 'long' },
    { start: 2, end: 3, original: 'nested' },
    { start: 1, end: 2, original: 'short' },
    { start: 10, end: 11, original: 'adjacent' },
    { start: 4, end: 4, original: 'invalid' },
  ];
  const index = createSubtitleLookup(cues);
  for (const [time, expected] of [[0, null], [1, 'short'], [2, 'long'], [7, 'long'], [8, 'late'], [10, 'adjacent'], [11, null], [2.5, 'long']]) {
    assert.equal(index.at(time)?.subtitle.original ?? null, expected);
  }
  assert.equal(index.at(8.5, 1).index, 1);
  assert.equal(index.at(NaN), null);
});

test('long indexed playback stays correct at repeated arbitrary seek positions', () => {
  const cues = Array.from({ length: 20000 }, (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.5, original: String(i) }));
  const lookup = createSubtitleLookup(cues);
  for (let i = 0; i < 1000; i++) {
    const n = (i * 7919) % cues.length;
    assert.equal(lookup.at(n * 0.5).index, n);
  }
});

test('failed or placeholder translations display original in preview rather than an error caption', () => {
  for (const cue of [{ original: 'Hello', translated: '[번역 실패]', status: 'failed' }, { original: 'Hello', translated: '[번역 불가]' }]) {
    assert.deepEqual(formatSubtitleForMode(cue), { primary: 'Hello', secondary: '' });
    assert.deepEqual(formatSubtitleForMode(cue, 'both'), { primary: 'Hello', secondary: '' });
  }
});
