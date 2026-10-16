import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySubtitleOffset,
  buildChunkPlan,
  createTranslationFailureLogDownload,
  createSubtitleDownloads,
  formatSrt,
  formatVtt,
  getTranslationFailures,
  mapSegmentsToGlobal,
  mergeSubtitles,
  normalizeTranscriptionSegments,
  parseSilenceLog,
  splitLongSubtitles,
} from '../src/core.js';

test('negative export offset omits cues before zero and preserves crossing cues without mutating input', () => {
  const subtitles = [
    { start: 0, end: 0.5, original: 'Before' },
    { start: 0.5, end: 1, original: 'Boundary' },
    { start: 0.8, end: 1.5, original: 'Crossing' },
    { start: 3, end: 4, original: 'Later' },
  ];
  const files = createSubtitleDownloads(subtitles, 'video.mp4', { offsetSeconds: -1 });
  assert.deepEqual(JSON.parse(files[2].content), [
    { start: 0, end: 0.5, original: 'Crossing' },
    { start: 2, end: 3, original: 'Later' },
  ]);
  assert.doesNotMatch(files[0].content, /Before|Boundary/);
  assert.match(files[1].content, /00:00:00.000 --> 00:00:00.500/);
  assert.equal(subtitles[2].start, 0.8);
});

test('subtitle offsets reject invalid and millisecond-rounded empty intervals', () => {
  assert.deepEqual(applySubtitleOffset([
    { start: 1, end: 1 }, { start: 3, end: 2 },
    { start: NaN, end: 4 }, { start: 3, end: Infinity },
    { start: 1, end: 1.0001 },
  ]), []);
});

test('download filenames identify selected languages and sanitize unsafe codes', () => {
  for (const [language, suffix] of [
    ['en', 'en'], ['zh-Hant', 'zh-Hant'], ['auto', 'original'],
    ['original', 'original'], ['../../x', 'und'], ['', 'und'],
  ]) {
    const files = createSubtitleDownloads([], 'video.mp4', { language });
    assert.equal(files[0].name, `video.${suffix}.srt`);
    assert.equal(files[1].name, `video.${suffix}.vtt`);
  }
});

test('parseSilenceLog pairs silence start and end lines from ffmpeg output', () => {
  const log = [
    '[silencedetect @ 000] silence_start: 302.418',
    '[silencedetect @ 000] silence_end: 303.124 | silence_duration: 0.706',
    '[silencedetect @ 000] silence_start: 618.930',
    '[silencedetect @ 000] silence_end: 620.402 | silence_duration: 1.472',
  ].join('\n');

  assert.deepEqual(parseSilenceLog(log), [
    { start: 302.418, end: 303.124, duration: 0.706 },
    { start: 618.93, end: 620.402, duration: 1.472 },
  ]);
});

test('buildChunkPlan cuts near the target length at the closest silence midpoint', () => {
  const chunks = buildChunkPlan({
    duration: 1500,
    silences: [
      { start: 604, end: 606, duration: 2 },
      { start: 1000, end: 1001, duration: 1 },
    ],
    targetSeconds: 600,
    minSeconds: 360,
    maxSeconds: 1080,
    searchRadiusSeconds: 240,
    paddingSeconds: 0.5,
  });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks[0].end, 605);
  assert.equal(chunks[0].extractStart, 0);
  assert.equal(chunks[0].extractEnd, 605.5);
  assert.equal(chunks[0].cutReason, 'silence');
  assert.equal(chunks[1].start, 605);
  assert.equal(chunks[1].end, 1500);
});

test('buildChunkPlan falls back to max length when no silence exists in range', () => {
  const chunks = buildChunkPlan({
    duration: 2400,
    silences: [],
    targetSeconds: 600,
    minSeconds: 360,
    maxSeconds: 1080,
    searchRadiusSeconds: 240,
    paddingSeconds: 0,
  });

  assert.deepEqual(
    chunks.map((chunk) => [chunk.start, chunk.end, chunk.cutReason]),
    [
      [0, 1080, 'forced'],
      [1080, 2160, 'forced'],
      [2160, 2400, 'end'],
    ],
  );
});

test('mapSegmentsToGlobal offsets local transcript times and removes padded overlap duplicates', () => {
  const chunk = {
    start: 100,
    end: 200,
    extractStart: 99.5,
    extractEnd: 200.5,
  };
  const mapped = mapSegmentsToGlobal(chunk, [
    { start: 0.1, end: 0.3, text: 'previous overlap' },
    { start: 1.0, end: 3.0, text: 'inside' },
    { start: 101.0, end: 101.3, text: 'next overlap' },
  ]);

  assert.deepEqual(mapped, [
    {
      start: 100.5,
      end: 102.5,
      original: 'inside',
      translated: '',
      chunkIndex: undefined,
    },
  ]);
});

test('mergeSubtitles offsets each chunk subtitle by the remembered chunk start time', () => {
  const merged = mergeSubtitles([
    {
      fileName: 'chunk-001.mp3',
      startTime: 0,
      subtitles: [
        {
          start: 2.1,
          end: 5.8,
          original: 'Hello everyone.',
          translated: 'Hello everyone.',
        },
      ],
    },
    {
      fileName: 'chunk-002.mp3',
      startTime: 618,
      subtitles: [
        {
          start: 12.5,
          end: 16.2,
          original: 'This is an important point.',
          translated: 'This is an important point.',
        },
      ],
    },
  ]);

  assert.deepEqual(merged, [
    {
      start: 2.1,
      end: 5.8,
      original: 'Hello everyone.',
      translated: 'Hello everyone.',
    },
    {
      start: 630.5,
      end: 634.2,
      original: 'This is an important point.',
      translated: 'This is an important point.',
    },
  ]);
});

test('mergeSubtitles can ignore padded overlap cues outside a chunk core range', () => {
  const merged = mergeSubtitles([
    {
      fileName: 'chunk-002.mp3',
      startTime: 99.5,
      coreStartTime: 100,
      coreEndTime: 200,
      subtitles: [
        { start: 0.1, end: 0.3, original: 'previous overlap', translated: '' },
        { start: 1.0, end: 3.0, original: 'inside', translated: '' },
        { start: 101.0, end: 101.3, original: 'next overlap', translated: '' },
      ],
    },
  ]);

  assert.deepEqual(merged, [
    {
      start: 100.5,
      end: 102.5,
      original: 'inside',
      translated: '',
    },
  ]);
});

test('mergeSubtitles splits long transcript cues into readable timed subtitles', () => {
  const merged = mergeSubtitles(
    [
      {
        fileName: 'chunk-001.mp3',
        startTime: 10,
        subtitles: [
          {
            start: 0,
            end: 6,
            original: 'Alpha beta gamma delta epsilon zeta',
            translated: '',
          },
        ],
      },
    ],
    { maxTextLength: 16 },
  );

  assert.deepEqual(merged, [
    { start: 10, end: 12, original: 'Alpha beta gamma', translated: '' },
    { start: 12, end: 14, original: 'delta epsilon', translated: '' },
    { start: 14, end: 16, original: 'zeta', translated: '' },
  ]);
});

test('normalizeTranscriptionSegments rebuilds readable cues from word timestamps', () => {
  const segments = normalizeTranscriptionSegments(
    {
      segments: [{ start: 0, end: 3.2, text: 'Hello everyone this is important. Next line.' }],
      words: [
        { word: 'Hello', start: 0, end: 0.4 },
        { word: 'everyone', start: 0.4, end: 0.9 },
        { word: 'this', start: 0.9, end: 1.2 },
        { word: 'is', start: 1.2, end: 1.4 },
        { word: 'important.', start: 1.4, end: 2.1 },
        { word: 'Next', start: 2.2, end: 2.5 },
        { word: 'line.', start: 2.5, end: 2.9 },
      ],
    },
    3.2,
    { maxTextLength: 34, maxDuration: 2.4, maxCps: 18 },
  );

  assert.deepEqual(segments, [
    { start: 0, end: 2.1, text: 'Hello everyone this is important.' },
    { start: 2.2, end: 2.9, text: 'Next line.' },
  ]);
});

test('normalizeTranscriptionSegments keeps the sentence-ending word with its sentence', () => {
  const segments = normalizeTranscriptionSegments(
    {
      words: [
        { word: 'When', start: 0, end: 0.4 },
        { word: 'they', start: 0.4, end: 0.8 },
        { word: 'threatened', start: 0.8, end: 1.7 },
        { word: 'him.', start: 1.7, end: 2.4 },
        { word: 'He', start: 2.5, end: 2.8 },
        { word: 'was', start: 2.8, end: 3.1 },
        { word: 'not', start: 3.1, end: 3.4 },
        { word: 'hurt.', start: 3.4, end: 3.9 },
      ],
    },
    3.9,
    { maxTextLength: 80, maxDuration: 2, maxCps: 18 },
  );

  assert.deepEqual(segments, [
    { start: 0, end: 2.4, text: 'When they threatened him.' },
    { start: 2.5, end: 3.9, text: 'He was not hurt.' },
  ]);
});

test('normalizeTranscriptionSegments keeps long punctuated sentences whole before translation', () => {
  const segments = normalizeTranscriptionSegments(
    {
      words: [
        { word: 'This', start: 0, end: 0.3 },
        { word: 'sentence', start: 0.3, end: 0.8 },
        { word: 'is', start: 0.8, end: 1.0 },
        { word: 'intentionally', start: 1.0, end: 1.7 },
        { word: 'long', start: 1.7, end: 2.1 },
        { word: 'but', start: 2.1, end: 2.4 },
        { word: 'still', start: 2.4, end: 2.8 },
        { word: 'one', start: 2.8, end: 3.1 },
        { word: 'sentence.', start: 3.1, end: 3.8 },
      ],
    },
    3.8,
    { maxTextLength: 24, maxDuration: 2, maxCps: 18 },
  );

  assert.deepEqual(segments, [
    {
      start: 0,
      end: 3.8,
      text: 'This sentence is intentionally long but still one sentence.',
    },
  ]);
});

test('normalizeTranscriptionSegments prefers punctuated segments when word timestamps have no punctuation', () => {
  const segments = normalizeTranscriptionSegments(
    {
      segments: [
        {
          start: 8.58,
          end: 18.66,
          text: 'There was a turtle by the name of Bert and Bert the turtle was very alert. When danger threatened him he never got hurt.',
        },
      ],
      words: [
        { word: 'There', start: 8.58, end: 8.8 },
        { word: 'was', start: 8.8, end: 9.0 },
        { word: 'a', start: 9.0, end: 9.1 },
        { word: 'turtle', start: 9.1, end: 9.5 },
        { word: 'danger', start: 14.8, end: 15.3 },
        { word: 'threatened', start: 15.3, end: 16.0 },
        { word: 'hurt', start: 18.1, end: 18.66 },
      ],
    },
    18.66,
    { maxTextLength: 34, maxDuration: 2.4, maxCps: 18 },
  );

  assert.deepEqual(segments, [
    {
      start: 8.58,
      end: 18.66,
      text: 'There was a turtle by the name of Bert and Bert the turtle was very alert. When danger threatened him he never got hurt.',
    },
  ]);
});


test('splitLongSubtitles breaks long translated sentences while preserving total timing', () => {
  const subtitles = splitLongSubtitles(
    [
      {
        start: 10,
        end: 16,
        original: 'Alpha beta gamma delta epsilon zeta.',
        translated: 'Translated alpha beta gamma delta epsilon zeta.',
        status: 'translated',
      },
    ],
    16,
  );

  assert.deepEqual(subtitles, [
    {
      start: 10,
      end: 12,
      original: 'Alpha beta gamma',
      translated: 'Translated alpha',
      status: 'translated',
    },
    {
      start: 12,
      end: 14,
      original: 'delta epsilon',
      translated: 'beta gamma delta',
      status: 'translated',
    },
    {
      start: 14,
      end: 16,
      original: 'zeta.',
      translated: 'epsilon zeta.',
      status: 'translated',
    },
  ]);
});

test('splitLongSubtitles keeps translated sentence boundaries while wrapping', () => {
  const subtitles = splitLongSubtitles(
    [
      {
        start: 0,
        end: 12,
        original:
          'There was a turtle named Bert and Bert was very alert. Danger threatened him but he never got hurt. He knew just what to do.',
        translated:
          '버트라는 이름의 거북이가 있었고, 버트는 아주 경계심이 많은 거북이였어요. 위험이 그를 위협해도 그는 다치지 않았어요. 그는 무엇을 해야 할지 정확히 알았죠.',
        status: 'translated',
      },
    ],
    28,
  );

  assert.deepEqual(
    subtitles.map((subtitle) => subtitle.translated),
    [
      '버트라는 이름의 거북이가 있었고, 버트는 아주',
      '경계심이 많은 거북이였어요.',
      '위험이 그를 위협해도 그는 다치지 않았어요.',
      '그는 무엇을 해야 할지 정확히 알았죠.',
    ],
  );
  assert.equal(subtitles[0].start, 0);
  assert.equal(subtitles.at(-1).end, 12);
});

test('splitLongSubtitles does not split repeated comma phrases into tiny captions', () => {
  const subtitles = splitLongSubtitles(
    [
      {
        start: 27,
        end: 37.42,
        original: 'He did what we all must learn to do, you and you and you and you, duck and cover.',
        translated: 'He did what we all must learn to do. You, you, you, you, duck and cover.',
      },
    ],
    18,
  );

  assert.deepEqual(
    subtitles.map((subtitle) => subtitle.translated),
    [
      'He did what we all',
      'must learn to do.',
      'You, you, you,',
      'you, duck and',
      'cover.',
    ],
  );
});

test('formatSrt and formatVtt render translated subtitles with stable timestamps', () => {
  const subtitles = [
    {
      start: 12.4,
      end: 16.8,
      original: 'Today we are going to talk about this issue.',
      translated: '오늘은 이 문제에 대해 이야기해 보겠습니다.',
    },
    {
      start: 16.9,
      end: 21.2,
      original: 'There are several important points.',
      translated: '중요한 지점이 몇 가지 있습니다.',
    },
  ];

  assert.equal(
    formatSrt(subtitles),
    [
      '1',
      '00:00:12,400 --> 00:00:16,800',
      '오늘은 이 문제에 대해 이야기해 보겠습니다.',
      '',
      '2',
      '00:00:16,900 --> 00:00:21,200',
      '중요한 지점이 몇 가지 있습니다.',
      '',
    ].join('\n'),
  );

  assert.equal(
    formatVtt(subtitles),
    [
      'WEBVTT',
      '',
      '00:00:12.400 --> 00:00:16.800',
      '오늘은 이 문제에 대해 이야기해 보겠습니다.',
      '',
      '00:00:16.900 --> 00:00:21.200',
      '중요한 지점이 몇 가지 있습니다.',
      '',
    ].join('\n'),
  );
});

test('createSubtitleDownloads prepares SRT, VTT, and JSON download files', () => {
  const subtitles = [
    {
      start: 630.5,
      end: 634.2,
      original: 'This is an important point.',
      translated: '이것은 중요한 지점입니다.',
    },
  ];

  const files = createSubtitleDownloads(subtitles, 'sample video.mp4');

  assert.deepEqual(
    files.map((file) => [file.label, file.name, file.type]),
    [
      ['SRT 다운로드', 'sample video.ko.srt', 'application/x-subrip;charset=utf-8'],
      ['VTT 다운로드', 'sample video.ko.vtt', 'text/vtt;charset=utf-8'],
      ['JSON 다운로드', 'sample video.subtitles.json', 'application/json;charset=utf-8'],
    ],
  );
  assert.match(files[0].content, /00:10:30,500 --> 00:10:34,200/);
  assert.match(files[0].content, /이것은 중요한 지점입니다\./);
  assert.match(files[1].content, /^WEBVTT/);
  assert.match(files[2].content, /"translated": "이것은 중요한 지점입니다\."/);
});
test('applySubtitleOffset shifts subtitle times and clamps negative values to zero', () => {
  const shifted = applySubtitleOffset(
    [
      { start: 0.2, end: 0.7, original: 'Intro', translated: 'Intro translated' },
      { start: 10, end: 12, original: 'Later', translated: 'Later translated' },
    ],
    -0.5,
  );

  assert.deepEqual(shifted, [
    { start: 0, end: 0.2, original: 'Intro', translated: 'Intro translated' },
    { start: 9.5, end: 11.5, original: 'Later', translated: 'Later translated' },
  ]);
});

test('createSubtitleDownloads applies sync offset to SRT, VTT, JSON contents and filenames', () => {
  const subtitles = [
    {
      start: 0.2,
      end: 1.4,
      original: 'First line.',
      translated: 'First translated.',
    },
    {
      start: 10,
      end: 12,
      original: 'Second line.',
      translated: 'Second translated.',
    },
  ];

  const files = createSubtitleDownloads(subtitles, 'video.mp4', { offsetSeconds: -0.5 });

  assert.deepEqual(
    files.map((file) => file.name),
    ['video.ko.sync-0.5s.srt', 'video.ko.sync-0.5s.vtt', 'video.sync-0.5s.subtitles.json'],
  );
  assert.match(files[0].content, /00:00:00,000 --> 00:00:00,900/);
  assert.match(files[0].content, /00:00:09,500 --> 00:00:11,500/);
  assert.match(files[1].content, /00:00:00.000 --> 00:00:00.900/);

  const json = JSON.parse(files[2].content);
  assert.equal(json[0].start, 0);
  assert.equal(json[0].end, 0.9);
  assert.equal(json[1].start, 9.5);
  assert.equal(json[1].end, 11.5);
});

test('getTranslationFailures and createTranslationFailureLogDownload summarize failed segments', () => {
  const subtitles = [
    { start: 0, end: 1, original: 'ok', translated: 'ok ko', status: 'translated' },
    {
      start: 1,
      end: 2,
      original: 'bad',
      translated: '[번역 실패]',
      status: 'failed',
      translationError: 'blocked',
    },
  ];

  assert.deepEqual(getTranslationFailures(subtitles), [
    {
      index: 2,
      start: 1,
      end: 2,
      original: 'bad',
      translated: '[번역 실패]',
      status: 'failed',
      reason: 'blocked',
    },
  ]);

  const file = createTranslationFailureLogDownload(subtitles, 'video.mp4');
  assert.equal(file.label, '번역 실패 로그 JSON');
  assert.equal(file.name, 'video.translation-failures.json');
  assert.equal(file.type, 'application/json;charset=utf-8');
  assert.match(file.content, /"failedCount": 1/);
  assert.match(file.content, /"reason": "blocked"/);
});
