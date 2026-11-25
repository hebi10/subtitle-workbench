import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceSnapshot, readWorkspace, writeWorkspace } from '../src/workspace-storage.js';

const entry = {
  id: '1', fileName: 'sample.mp4', fileSize: 123, duration: 8, createdAt: '2026-11-24T00:00:00Z',
  outputLanguage: 'ko', offsetSeconds: -0.5, translationPending: true,
  apiKey: 'credential-sentinel', proxyUrl: 'connection-sentinel', sourceFile: new Blob(['media-sentinel']),
  editHistory: { past: ['history-sentinel'] },
  translationSettings: { targetLanguage: 'ko', maxSubtitleChars: 42, apiKey: 'credential-sentinel' },
  subtitles: [{ start: 1, end: 2, original: 'original', translated: '번역', status: 'translated',
    speaker: 'A', speakerScope: 1, timingAccuracy: 'estimated', apiKey: 'credential-sentinel' },
    { start: 2, end: 3, original: 'failed', translated: '[번역 실패]', status: 'failed', translationError: 'provider-error-sentinel' }],
};

test('workspace records include only explicitly allowed subtitle and metadata fields', () => {
  const snapshot = createWorkspaceSnapshot([entry], '1');
  assert.equal(snapshot.activeId, '1');
  const stored = snapshot.entries[0];
  assert.equal(stored.offsetSeconds, -0.5);
  assert.equal(stored.translationPending, true);
  assert.deepEqual(stored.translationSettings, { targetLanguage: 'ko', maxSubtitleChars: 42 });
  assert.equal(stored.subtitles[0].speakerScope, 1);
  assert.equal(stored.subtitles[0].timingAccuracy, 'estimated');
  assert.equal(stored.subtitles[0].translated, '번역');
  assert.match(stored.subtitles[1].translationError, /다시 시도/);
  assert.doesNotMatch(JSON.stringify(snapshot), /credential-sentinel|connection-sentinel|media-sentinel|history-sentinel|provider-error-sentinel|apiKey|proxyUrl|sourceFile|editHistory/);
  assert.notEqual(stored.subtitles[0], entry.subtitles[0]);
});

test('invalid or oversized workspace records never silently truncate data', () => {
  assert.throws(() => createWorkspaceSnapshot([entry, entry], '1'));
  assert.throws(() => createWorkspaceSnapshot([entry], '2'));
  assert.throws(() => createWorkspaceSnapshot([{ ...entry, subtitles: [{ start: 4, end: 2 }] }], '1'));
  assert.throws(() => createWorkspaceSnapshot([{ ...entry, subtitles: [{ start: 1, end: 2, original: 'x'.repeat(20001) }] }], '1'));
  assert.equal(createWorkspaceSnapshot([entry], null).activeId, '1');
  assert.deepEqual(createWorkspaceSnapshot([], null), { entries: [], activeId: null });
});

test('unavailable IndexedDB rejects without pretending data was saved', async () => {
  await assert.rejects(readWorkspace(null), /unavailable/);
  await assert.rejects(writeWorkspace(0, createWorkspaceSnapshot([], null), null), /unavailable/);
});
