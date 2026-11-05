import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSrt, formatVtt, mergeSubtitles, normalizeTranscriptionSegments, speakerMarkedText } from '../src/core.js';
import { updateSpeakerAt, mergeSubtitleWithNext, mergeShortSubtitles } from '../src/subtitle-editor.js';
import { parseJsonSubtitles } from '../src/subtitle-player.js';

test('speaker transitions add >> only when a known speaker actually changes', () => {
  const cues = [
    { start: 0, end: 1, original: '안녕하세요', speaker: 'A', speakerScope: 0 },
    { start: 1, end: 2, original: '반갑습니다', speaker: 'A', speakerScope: 0 },
    { start: 2, end: 3, original: '네', speaker: 'B', speakerScope: 0 },
    { start: 3, end: 4, original: '계속', speaker: 'B', speakerScope: 0 },
    { start: 4, end: 5, original: '새 구간', speaker: 'A', speakerScope: 1 },
  ];
  const srt = formatSrt(cues);
  assert.match(srt, /00:00:02,000 --> 00:00:03,000\n>> 네/);
  assert.doesNotMatch(srt, />> 안녕하세요|>> 반갑습니다|>> 계속|>> 새 구간/);
  assert.equal((formatVtt(cues).match(/>>/g) || []).length, 1);
  assert.equal(speakerMarkedText({ original: '말', speaker: 'B' }, { speaker: 'A' }), '>> 말');
});

test('speaker id and estimated timing survive normalization, merge, and JSON import', () => {
  const segments = normalizeTranscriptionSegments({ segments: [{ start: 1, end: 2, text: 'Hello', speaker: 'speaker_1' }] });
  assert.equal(segments[0].speaker, 'speaker_1');
  const merged = mergeSubtitles([{ startTime: 0, subtitles: [{ ...segments[0], timingAccuracy: 'estimated' }] }]);
  assert.equal(merged[0].speaker, 'speaker_1');
  assert.equal(merged[0].timingAccuracy, 'estimated');
  assert.equal(parseJsonSubtitles(JSON.stringify(merged))[0].speaker, 'speaker_1');
});

test('editing speaker supports clearing, and never merges two distinct speakers', () => {
  const cues = [
    { start: 0, end: 0.5, original: 'A', speaker: 'one' },
    { start: 0.5, end: 1, original: 'B', speaker: 'two' },
  ];
  assert.deepEqual(mergeSubtitleWithNext(cues, 0), cues);
  assert.equal(mergeShortSubtitles(cues).length, 2);
  const updated = updateSpeakerAt(cues, 0, 'two');
  assert.equal(mergeSubtitleWithNext(updated, 0).length, 1);
  assert.equal(updateSpeakerAt(updated, 0, '')[0].speaker, undefined);
});
