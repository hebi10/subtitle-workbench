import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canStartSubtitleJob,
  previewLimitLabel,
  visibleSubtitlePreview,
} from '../src/ui-state.js';

test('canStartSubtitleJob requires a file, idle state, and user key in browser mode', () => {
  assert.equal(
    canStartSubtitleJob({
      hasFile: false,
      isBusy: false,
      connectionMode: 'browser',
      apiKey: 'sk-test',
      proxyUrl: '',
    }),
    false,
  );
  assert.equal(
    canStartSubtitleJob({
      hasFile: true,
      isBusy: true,
      connectionMode: 'browser',
      apiKey: 'sk-test',
      proxyUrl: '',
    }),
    false,
  );
  assert.equal(
    canStartSubtitleJob({
      hasFile: true,
      isBusy: false,
      connectionMode: 'browser',
      apiKey: '',
      proxyUrl: 'https://worker.example',
    }),
    false,
  );
  assert.equal(
    canStartSubtitleJob({
      hasFile: true,
      isBusy: false,
      connectionMode: 'browser',
      apiKey: 'sk-test',
      proxyUrl: '',
    }),
    true,
  );
  assert.equal(
    canStartSubtitleJob({
      hasFile: true,
      isBusy: false,
      connectionMode: 'browser',
      apiKey: 'sk-test',
      proxyUrl: 'https://worker.example',
    }),
    true,
  );
});

test('canStartSubtitleJob requires a file, idle state, user key, and proxy URL in worker mode', () => {
  assert.equal(
    canStartSubtitleJob({
      hasFile: false,
      isBusy: false,
      connectionMode: 'worker',
      apiKey: 'sk-test',
      proxyUrl: 'https://worker.example',
    }),
    false,
  );
  assert.equal(
    canStartSubtitleJob({
      hasFile: true,
      isBusy: true,
      connectionMode: 'worker',
      apiKey: 'sk-test',
      proxyUrl: 'https://worker.example',
    }),
    false,
  );
  assert.equal(
    canStartSubtitleJob({
      hasFile: true,
      isBusy: false,
      connectionMode: 'worker',
      apiKey: 'sk-test',
      proxyUrl: '',
    }),
    false,
  );
  assert.equal(
    canStartSubtitleJob({
      hasFile: true,
      isBusy: false,
      connectionMode: 'worker',
      apiKey: '',
      proxyUrl: 'https://worker.example',
    }),
    false,
  );
  assert.equal(
    canStartSubtitleJob({
      hasFile: true,
      isBusy: false,
      connectionMode: 'worker',
      apiKey: 'sk-test',
      proxyUrl: 'https://worker.example',
    }),
    true,
  );
});

test('canStartSubtitleJob rejects whitespace-only user keys and Worker URLs', () => {
  assert.equal(
    canStartSubtitleJob({
      hasFile: true,
      isBusy: false,
      connectionMode: 'browser',
      apiKey: '   ',
      proxyUrl: '',
    }),
    false,
  );
  assert.equal(
    canStartSubtitleJob({
      hasFile: true,
      isBusy: false,
      connectionMode: 'worker',
      apiKey: 'sk-test',
      proxyUrl: '   ',
    }),
    false,
  );
});

test('canStartSubtitleJob applies browser requirements to unknown connection modes', () => {
  assert.equal(
    canStartSubtitleJob({
      hasFile: true,
      isBusy: false,
      connectionMode: 'unexpected',
      apiKey: '',
      proxyUrl: 'https://worker.example',
    }),
    false,
  );
  assert.equal(
    canStartSubtitleJob({
      hasFile: true,
      isBusy: false,
      connectionMode: 'unexpected',
      apiKey: 'sk-test',
      proxyUrl: '',
    }),
    true,
  );
});

test('visibleSubtitlePreview limits preview to the first twenty subtitles', () => {
  const subtitles = Array.from({ length: 25 }, (_, index) => ({ start: index, end: index + 1 }));

  assert.equal(visibleSubtitlePreview(subtitles).length, 20);
  assert.equal(visibleSubtitlePreview(subtitles)[19].start, 19);
  assert.equal(previewLimitLabel(25, 20), '처음 20개만 표시합니다. 전체 자막은 다운로드 파일에서 확인하세요.');
  assert.equal(previewLimitLabel(12, 20), '전체 12개 표시');
});
