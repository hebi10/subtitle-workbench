import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHistoryExportFiles,
  createJobHistoryEntry,
  findReusableHistoryEntry,
  upsertJobHistoryEntry,
} from '../src/job-history.js';

const subtitles = [
  { start: 0, end: 1.5, original: 'Hello', translated: '안녕하세요' },
  { start: 2, end: 4, original: 'World', translated: '세계' },
];

test('createJobHistoryEntry stores serializable subtitle results with metadata', () => {
  const entry = createJobHistoryEntry({
    fileName: 'demo video.mp4',
    fileSize: 12345,
    duration: 12.3,
    subtitles,
    createdAt: '2026-06-22T10:00:00.000Z',
  });

  assert.equal(entry.fileName, 'demo video.mp4');
  assert.equal(entry.fileSize, 12345);
  assert.equal(entry.duration, 12.3);
  assert.equal(entry.subtitleCount, 2);
  assert.equal(entry.createdAt, '2026-06-22T10:00:00.000Z');
  assert.deepEqual(entry.subtitles, subtitles);
  assert.notEqual(entry.subtitles, subtitles);
  assert.ok(entry.id.includes('demo-video'));
});

test('createHistoryExportFiles recreates downloadable subtitle files for a history entry', () => {
  const entry = createJobHistoryEntry({
    fileName: 'demo.mp4',
    fileSize: 100,
    duration: 8,
    subtitles,
    createdAt: '2026-06-22T10:00:00.000Z',
  });

  const files = createHistoryExportFiles(entry);

  assert.deepEqual(files.map((file) => file.label), [
    'SRT 다운로드',
    'VTT 다운로드',
    'JSON 다운로드',
    'ZIP 다운로드',
  ]);
  assert.ok(files[0].content.includes('안녕하세요'));
  assert.ok(files.at(-1).name.endsWith('.zip'));
});

test('findReusableHistoryEntry matches completed results by file name and size', () => {
  const first = createJobHistoryEntry({
    fileName: 'first.mp4',
    fileSize: 100,
    duration: 8,
    subtitles,
    createdAt: '2026-06-22T10:00:00.000Z',
  });
  const second = createJobHistoryEntry({
    fileName: 'second.mp4',
    fileSize: 200,
    duration: 9,
    subtitles,
    createdAt: '2026-06-22T10:01:00.000Z',
  });

  assert.equal(findReusableHistoryEntry([second, first], { name: 'first.mp4', size: 100 }), first);
  assert.equal(findReusableHistoryEntry([second, first], { name: 'first.mp4', size: 999 }), null);
});

test('upsertJobHistoryEntry keeps one latest result per source file', () => {
  const older = createJobHistoryEntry({
    fileName: 'demo.mp4',
    fileSize: 100,
    duration: 8,
    subtitles,
    createdAt: '2026-06-22T10:00:00.000Z',
  });
  const newer = createJobHistoryEntry({
    fileName: 'demo.mp4',
    fileSize: 100,
    duration: 9,
    subtitles: subtitles.slice(0, 1),
    createdAt: '2026-06-22T10:02:00.000Z',
  });

  const history = upsertJobHistoryEntry([older], newer);

  assert.equal(history.length, 1);
  assert.equal(history[0], newer);
  assert.equal(history[0].subtitleCount, 1);
});
