import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canStartSubtitleJob,
  getExportSummary,
  getGeneratePreparationStatus,
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

test('generation preparation distinguishes selected file, verified duration, and unverified API inputs', () => {
  const initial = getGeneratePreparationStatus({
    hasFile: false, hasDuration: false, hasApiKey: false, connectionMode: 'worker',
    proxyUrl: '', sourceLanguage: '자동 감지', translationEnabled: true,
    targetLanguage: '한국어', isCustomTarget: false, customTargetLanguage: '',
  });
  assert.deepEqual(initial, {
    file: '파일 선택 필요',
    connection: 'API 키 입력 필요',
    language: '자동 감지 → 한국어',
  });
  const incomplete = getGeneratePreparationStatus({
    hasFile: true, hasDuration: false, hasApiKey: true, connectionMode: 'worker',
    proxyUrl: '  ', sourceLanguage: '일본어', translationEnabled: false,
    targetLanguage: '한국어', isCustomTarget: false, customTargetLanguage: '',
  });
  assert.equal(incomplete.file, '파일 길이 확인 필요');
  assert.equal(incomplete.connection, 'Worker URL 입력 필요');
  assert.equal(incomplete.language, '일본어 · 번역 사용 안 함');
  const filled = getGeneratePreparationStatus({
    hasFile: true, hasDuration: true, hasApiKey: true, connectionMode: 'browser',
    proxyUrl: '', sourceLanguage: '영어', translationEnabled: true,
    targetLanguage: '다른 언어 직접 입력', isCustomTarget: true, customTargetLanguage: '독일어',
  });
  assert.equal(filled.file, '길이 확인됨');
  assert.equal(filled.connection, '정보 입력됨 · 실제 연결 미검증');
  assert.equal(filled.language, '영어 → 독일어');
});

test('custom translation language status never claims a blank custom language is configured', () => {
  const status = getGeneratePreparationStatus({
    hasFile: true, hasDuration: true, hasApiKey: true, connectionMode: 'worker',
    proxyUrl: 'https://worker.example', sourceLanguage: '자동 감지', translationEnabled: true,
    targetLanguage: '다른 언어 직접 입력', isCustomTarget: true, customTargetLanguage: ' ',
  });
  assert.equal(status.language, '자동 감지 → 번역 언어 입력 필요');
  assert.match(status.connection, /미검증/);
});

test('getExportSummary reports empty, ready, and partial translation accurately', () => {
  assert.deepEqual(getExportSummary(), {
    fileName: '선택한 작업 없음',
    status: { state: 'empty', label: '저장할 자막 없음' },
    language: '—',
    sync: '0.0초',
  });
  const ready = getExportSummary({
    fileName: 'subtitles.mp4', subtitleCount: 3, failedCount: 0, language: 'en', offsetSeconds: 0.5,
  });
  assert.equal(ready.fileName, 'subtitles.mp4');
  assert.equal(ready.status.state, 'ready');
  assert.equal(ready.language, 'en');
  assert.equal(ready.sync, '0.5초');
  const partial = getExportSummary({
    fileName: 'partial.wav', subtitleCount: 4, failedCount: 2, language: 'original', offsetSeconds: -0.5,
  });
  assert.equal(partial.status.state, 'partial');
  assert.match(partial.status.label, /번역 실패 2개/);
  assert.match(partial.status.label, /원문 보존/);
  assert.equal(partial.language, '원문');
  assert.equal(partial.sync, '-0.5초');
  const pending = getExportSummary({ fileName: 'cancelled.mp4', subtitleCount: 2, failedCount: 0, translationPending: true });
  assert.equal(pending.status.state, 'pending');
  assert.match(pending.status.label, /번역 완료 전/);
  assert.match(pending.status.label, /원문 보존/);
});
