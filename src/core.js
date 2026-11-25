const DEFAULT_SPLIT_OPTIONS = {
  targetSeconds: 10 * 60,
  minSeconds: 6 * 60,
  maxSeconds: 18 * 60,
  searchRadiusSeconds: 4 * 60,
  paddingSeconds: 0.5,
};

export const DEFAULT_MAX_SUBTITLE_TEXT_LENGTH = 42;
export const DEFAULT_MAX_SUBTITLE_SECONDS = 4.5;
export const DEFAULT_MAX_SUBTITLE_CPS = 18;

export function parseSilenceLog(logText) {
  const silences = [];
  let pendingStart = null;

  for (const line of String(logText ?? '').split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
      continue;
    }

    const endMatch = line.match(
      /silence_end:\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*silence_duration:\s*([0-9]+(?:\.[0-9]+)?)/,
    );
    if (!endMatch) {
      continue;
    }

    const end = Number(endMatch[1]);
    const duration = Number(endMatch[2]);
    const start = pendingStart ?? end - duration;

    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      silences.push({
        start: roundSeconds(start),
        end: roundSeconds(end),
        duration: roundSeconds(duration),
      });
    }

    pendingStart = null;
  }

  return silences;
}

export function buildChunkPlan(options) {
  const settings = normalizeSplitOptions(options);
  const duration = roundSeconds(Math.max(0, Number(options.duration) || 0));
  const silences = normalizeSilences(options.silences);
  const chunks = [];

  if (duration <= 0) {
    return chunks;
  }

  let start = 0;
  let index = 0;

  while (start < duration - 0.001) {
    const remaining = roundSeconds(duration - start);

    if (remaining <= settings.maxSeconds) {
      chunks.push(
        createChunk({
          index,
          start,
          end: duration,
          duration,
          paddingSeconds: settings.paddingSeconds,
          cutReason: 'end',
        }),
      );
      break;
    }

    const ideal = start + settings.targetSeconds;
    const lowerBound = Math.max(start + settings.minSeconds, ideal - settings.searchRadiusSeconds);
    const upperBound = Math.min(start + settings.maxSeconds, ideal + settings.searchRadiusSeconds);
    const cut = chooseSilenceCut({ silences, ideal, lowerBound, upperBound });

    const end = cut ?? Math.min(start + settings.maxSeconds, duration);
    const cutReason = cut == null ? 'forced' : 'silence';

    if (end <= start + 0.001) {
      chunks.push(
        createChunk({
          index,
          start,
          end: duration,
          duration,
          paddingSeconds: settings.paddingSeconds,
          cutReason: 'end',
        }),
      );
      break;
    }

    chunks.push(
      createChunk({
        index,
        start,
        end,
        duration,
        paddingSeconds: settings.paddingSeconds,
        cutReason,
      }),
    );

    start = roundSeconds(end);
    index += 1;
  }

  return chunks;
}

export function mapSegmentsToGlobal(chunk, segments) {
  return mergeSubtitles([
    {
      fileName: chunk.fileName,
      index: chunk.index,
      startTime: chunk.extractStart ?? chunk.start ?? 0,
      coreStartTime: chunk.start,
      coreEndTime: chunk.end,
      extractEndTime: chunk.extractEnd,
      subtitles: segments,
    },
  ]).map((subtitle) => ({
    ...subtitle,
    chunkIndex: chunk.index,
  }));
}

export function mergeSubtitles(chunks, options = {}) {
  const maxTextLength = positiveNumber(options.maxTextLength, DEFAULT_MAX_SUBTITLE_TEXT_LENGTH);
  const mergedSubtitles = [];

  for (const chunk of chunks ?? []) {
    const chunkStartTime = numberOr(chunk.startTime ?? chunk.extractStart ?? chunk.start, 0);
    const coreStartTime = optionalNumber(chunk.coreStartTime ?? chunk.coreStart ?? chunk.start);
    const coreEndTime = optionalNumber(chunk.coreEndTime ?? chunk.coreEnd ?? chunk.end);
    const extractEndTime = optionalNumber(chunk.extractEndTime ?? chunk.extractEnd);

    for (const subtitle of chunk.subtitles ?? []) {
      if (!validTranscriptTime(subtitle?.start, subtitle?.end)) continue;
      const globalStart = roundSeconds(chunkStartTime + subtitle.start);
      const globalEnd = roundSeconds(Math.min(extractEndTime ?? Infinity,
        Math.max(chunkStartTime + subtitle.end, globalStart + 0.001)));
      if (globalStart < 0 || globalEnd <= globalStart) continue;
      const midpoint = (globalStart + globalEnd) / 2;

      if (
        (coreStartTime != null && midpoint < coreStartTime) ||
        (coreEndTime != null && midpoint >= coreEndTime)
      ) {
        continue;
      }

      const original = cleanSubtitleText(subtitle.original ?? subtitle.text ?? '');
      if (!original) {
        continue;
      }

      let originalParts = splitSubtitleText(original, maxTextLength);
      const translated = cleanSubtitleText(subtitle.translated ?? '');
      const translatedParts = translated ? splitSubtitleText(translated, maxTextLength) : [];
      if (originalParts.length > Math.round((globalEnd - globalStart) * 1000)) originalParts = [original];
      const partCount = originalParts.length;
      const partDuration = (globalEnd - globalStart) / partCount;

      originalParts.forEach((part, partIndex) => {
        const isLastPart = partIndex === partCount - 1;
        const partStart =
          partIndex === 0 ? globalStart : roundSeconds(globalStart + partDuration * partIndex);
        const partEnd = isLastPart
          ? globalEnd
          : roundSeconds(Math.max(globalStart + partDuration * (partIndex + 1), partStart + 0.001));

        mergedSubtitles.push({
          start: partStart,
          end: partEnd,
          original: part,
          translated: translatedParts.length === partCount ? translatedParts[partIndex] : translated,
          ...(subtitle.status ? { status: subtitle.status } : {}),
          ...(subtitle.translationError ? { translationError: subtitle.translationError } : {}),
          ...(subtitle.speaker ? { speaker: String(subtitle.speaker) } : {}),
          ...(subtitle.speakerScope != null ? { speakerScope: subtitle.speakerScope } : {}),
          ...(subtitle.timingAccuracy ? { timingAccuracy: subtitle.timingAccuracy } : {}),
        });
      });
    }
  }

  return sortSubtitles(mergedSubtitles);
}

export function splitLongSubtitles(subtitles, maxTextLength = DEFAULT_MAX_SUBTITLE_TEXT_LENGTH) {
  const splitSubtitles = [];

  for (const subtitle of subtitles ?? []) {
    const start = numberOr(subtitle.start, 0);
    const end = roundSeconds(Math.max(numberOr(subtitle.end, start), start + 0.001));
    const original = cleanSubtitleText(subtitle.original ?? subtitle.text ?? '');
    const translated = cleanSubtitleText(subtitle.translated ?? '');
    let displayParts = splitSubtitleText(translated || original, maxTextLength);
    const originalParts = splitSubtitleText(original, maxTextLength);
    if (displayParts.length > Math.round((end - start) * 1000)) displayParts = [translated || original];
    const partCount = Math.max(displayParts.length, 1);
    const partDuration = (end - start) / partCount;

    displayParts.forEach((part, partIndex) => {
      const isLastPart = partIndex === partCount - 1;
      const partStart = partIndex === 0 ? start : roundSeconds(start + partDuration * partIndex);
      const partEnd = isLastPart
        ? end
        : roundSeconds(Math.max(start + partDuration * (partIndex + 1), partStart + 0.001));

      splitSubtitles.push({
        start: partStart,
        end: partEnd,
        original: originalParts.length === partCount ? originalParts[partIndex] : original,
        translated: translated ? part : '',
        ...(subtitle.status ? { status: subtitle.status } : {}),
        ...(subtitle.translationError ? { translationError: subtitle.translationError } : {}),
        ...(subtitle.speaker ? { speaker: subtitle.speaker } : {}),
        ...(subtitle.speakerScope != null ? { speakerScope: subtitle.speakerScope } : {}),
        ...(subtitle.timingAccuracy ? { timingAccuracy: subtitle.timingAccuracy } : {}),
      });
    });
  }

  return sortSubtitles(splitSubtitles);
}

export function normalizeTranscriptionSegments(response, fallbackDuration = 0, options = {}) {
  const words = Array.isArray(response?.words) ? response.words.filter((word) => word && validTranscriptTime(word.start, word.end) && cleanSubtitleText(word.word ?? word.text ?? '')) : [];
  const rawSegments = Array.isArray(response?.segments) ? response.segments : [];
  const segments = normalizeVerboseSegments(rawSegments);

  if (segments.some((segment) => segment.speaker)) return segments;

  if (words.length > 0) {
    if (!words.some((word) => isSentenceBoundary(word.word ?? word.text)) && segmentsHaveSentenceBoundaries(segments)) {
      return segments;
    }

    const wordSegments = rebuildTranscriptCuesFromWords(words, options);
    if (wordSegments.length > 0) {
      return wordSegments;
    }
  }

  if (segments.length > 0) {
    return segments;
  }

  // Do not fabricate timing for a timestamped response whose entries are all invalid.
  if (rawSegments.length || (Array.isArray(response?.words) && response.words.length)) return [];
  const text = cleanSubtitleText(response?.text ?? '');
  if (!text) {
    return [];
  }

  return [
    {
      start: 0,
      end: Math.max(Number(response?.duration ?? fallbackDuration) || 0, 0.001),
      text,
    },
  ];
}

export function sortSubtitles(subtitles) {
  return [...(subtitles ?? [])].sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    return left.end - right.end;
  });
}

export function formatSrt(subtitles, field = 'translated') {
  return sortSubtitles(subtitles)
    .map((subtitle, index, all) => {
      const text = speakerMarkedText(subtitle, all[index - 1], field);
      return [
        String(index + 1),
        `${formatTimestamp(subtitle.start, ',')} --> ${formatTimestamp(subtitle.end, ',')}`,
        text,
        '',
      ].join('\n');
    })
    .join('\n');
}

export function formatVtt(subtitles, field = 'translated') {
  const cues = sortSubtitles(subtitles).map((subtitle, index, all) => {
    const text = speakerMarkedText(subtitle, all[index - 1], field);
    return [
      `${formatTimestamp(subtitle.start, '.')} --> ${formatTimestamp(subtitle.end, '.')}`,
      text,
      '',
    ].join('\n');
  });

  return ['WEBVTT', '', ...cues].join('\n');
}

export function speakerMarkedText(subtitle, previous, field = 'translated') {
  const text = subtitleText(subtitle, field);
  const speaker = String(subtitle?.speaker ?? '').trim();
  const previousSpeaker = String(previous?.speaker ?? '').trim();
  const scope = subtitle?.speakerScope;
  const previousScope = previous?.speakerScope;
  // Speaker IDs from separate audio chunks are not necessarily the same person.
  const sameScope = scope == null || previousScope == null || scope === previousScope;
  return speaker && previousSpeaker && speaker !== previousSpeaker && sameScope ? `>> ${text}` : text;
}

export function formatTimestamp(seconds, millisecondSeparator = ',') {
  const totalMilliseconds = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const millis = totalMilliseconds % 1000;

  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}${millisecondSeparator}${pad(millis, 3)}`;
}

export function secondsToClock(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${pad(minutes, 2)}:${pad(secs, 2)}`;
  }

  return `${minutes}:${pad(secs, 2)}`;
}

// Describes the work submitted to the API, not a price or a quota/billing guarantee.
export function describeApiWorkload({ durationSeconds, fileCount = 1, chunkCount, extractedSeconds, translationEnabled = true } = {}) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return '파일 길이를 확인하면 예상 처리량을 안내합니다.';
  const multiple = Number.isSafeInteger(fileCount) && fileCount > 1;
  const parts = [`${multiple ? '현재 파일' : '원본'} 길이 ${secondsToClock(Math.ceil(duration))}`];
  if (Number.isSafeInteger(chunkCount) && chunkCount > 0) parts.push(`예정 전사 ${chunkCount}구간`);
  if (Number.isFinite(extractedSeconds) && extractedSeconds > 0) {
    parts.push(`계획된 추출 음성 약 ${secondsToClock(Math.ceil(extractedSeconds))} (패딩 포함)`);
  } else {
    parts.push('분할 패딩·재시도에 따라 전송량 증가 가능');
  }
  parts.push(translationEnabled ? '번역 별도 · 인식 후 토큰 사용량 결정' : '번역 안 함');
  if (multiple) parts.push(`선택 ${fileCount}개 파일 중 현재 파일 기준 · 나머지 길이는 처리 시 확인`);
  return parts.join(' · ');
}

export function subtitleText(subtitle, preferredField = 'translated') {
  const preferred = cleanSubtitleText(subtitle?.[preferredField] ?? '');
  if (preferred) {
    return preferred;
  }

  const translated = cleanSubtitleText(subtitle?.translated ?? '');
  if (translated) {
    return translated;
  }

  return cleanSubtitleText(subtitle?.original ?? subtitle?.text ?? '');
}

export function cleanSubtitleText(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

export function sanitizeFileBase(fileName) {
  const withoutExtension = String(fileName || 'subtitle').replace(/\.[^.]+$/, '');
  const safe = withoutExtension
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return safe || 'subtitle';
}

export function toSubtitleJson(subtitles) {
  return `${JSON.stringify(sortSubtitles(subtitles), null, 2)}\n`;
}

export function applySubtitleOffset(subtitles, offsetSeconds = 0) {
  const offset = roundSeconds(numberOr(offsetSeconds, 0));

  return sortSubtitles(subtitles).flatMap((subtitle) => {
    const start = roundSeconds(Math.max(0, Number(subtitle.start) + offset));
    const end = roundSeconds(Number(subtitle.end) + offset);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return [];
    }
    return [{ ...subtitle, start, end }];
  });
}

export function createSubtitleDownloads(subtitles, sourceFileName, options = {}) {
  const base = sanitizeFileBase(sourceFileName);
  const requestedLanguage = String(options.language ?? 'ko').trim();
  const language = /^(auto|original)$/i.test(requestedLanguage)
    ? 'original'
    : /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(requestedLanguage) ? requestedLanguage : 'und';
  const offsetSeconds = roundSeconds(Number(options.offsetSeconds) || 0);
  const syncSuffix = formatSyncSuffix(offsetSeconds);
  const outputSubtitles = applySubtitleOffset(subtitles, offsetSeconds);

  return [
    {
      label: 'SRT 다운로드',
      name: `${base}.${language}${syncSuffix}.srt`,
      type: 'application/x-subrip;charset=utf-8',
      content: formatSrt(outputSubtitles),
    },
    {
      label: 'VTT 다운로드',
      name: `${base}.${language}${syncSuffix}.vtt`,
      type: 'text/vtt;charset=utf-8',
      content: formatVtt(outputSubtitles),
    },
    {
      label: 'JSON 다운로드',
      name: `${base}${syncSuffix}.subtitles.json`,
      type: 'application/json;charset=utf-8',
      content: toSubtitleJson(outputSubtitles),
    },
  ];
}

export function getTranslationFailures(subtitles) {
  return sortSubtitles(subtitles)
    .map((subtitle, index) => ({ subtitle, index }))
    .filter(({ subtitle }) => subtitle.status === 'failed')
    .map(({ subtitle, index }) => ({
      index: index + 1,
      start: subtitle.start,
      end: subtitle.end,
      original: subtitle.original,
      translated: subtitle.translated,
      status: subtitle.status,
      reason: subtitle.translationError || 'Translation failed',
    }));
}

export function createTranslationFailureLogDownload(subtitles, sourceFileName) {
  const failures = getTranslationFailures(subtitles);
  if (failures.length === 0) {
    return null;
  }

  const base = sanitizeFileBase(sourceFileName);
  return {
    label: '번역 실패 로그 JSON',
    name: `${base}.translation-failures.json`,
    type: 'application/json;charset=utf-8',
    content: `${JSON.stringify(
      {
        failedCount: failures.length,
        failures,
      },
      null,
      2,
    )}\n`,
  };
}

function formatSyncSuffix(offsetSeconds) {
  if (Math.abs(offsetSeconds) < 0.001) {
    return '';
  }

  const sign = offsetSeconds > 0 ? '+' : '';
  return `.sync${sign}${formatCompactNumber(offsetSeconds)}s`;
}

function formatCompactNumber(value) {
  return String(roundSeconds(value)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function chooseSilenceCut({ silences, ideal, lowerBound, upperBound }) {
  const candidates = silences
    .map((silence) => ({
      silence,
      midpoint: roundSeconds((silence.start + silence.end) / 2),
    }))
    .filter(({ midpoint }) => midpoint >= lowerBound && midpoint <= upperBound)
    .sort((left, right) => {
      const leftDistance = Math.abs(left.midpoint - ideal);
      const rightDistance = Math.abs(right.midpoint - ideal);
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
      return right.silence.duration - left.silence.duration;
    });

  return candidates[0]?.midpoint ?? null;
}

function createChunk({ index, start, end, duration, paddingSeconds, cutReason }) {
  const roundedStart = roundSeconds(start);
  const roundedEnd = roundSeconds(end);
  return {
    index,
    start: roundedStart,
    end: roundedEnd,
    duration: roundSeconds(roundedEnd - roundedStart),
    extractStart: roundSeconds(Math.max(0, roundedStart - paddingSeconds)),
    extractEnd: roundSeconds(Math.min(duration, roundedEnd + paddingSeconds)),
    cutReason,
  };
}

function normalizeSplitOptions(options) {
  return {
    targetSeconds: positiveNumber(options.targetSeconds, DEFAULT_SPLIT_OPTIONS.targetSeconds),
    minSeconds: positiveNumber(options.minSeconds, DEFAULT_SPLIT_OPTIONS.minSeconds),
    maxSeconds: positiveNumber(options.maxSeconds, DEFAULT_SPLIT_OPTIONS.maxSeconds),
    searchRadiusSeconds: positiveNumber(
      options.searchRadiusSeconds,
      DEFAULT_SPLIT_OPTIONS.searchRadiusSeconds,
    ),
    paddingSeconds: Math.max(0, Number(options.paddingSeconds ?? DEFAULT_SPLIT_OPTIONS.paddingSeconds)),
  };
}

function normalizeSilences(silences) {
  return [...(silences ?? [])]
    .map((silence) => ({
      start: Number(silence.start),
      end: Number(silence.end),
      duration: Number(silence.duration ?? Number(silence.end) - Number(silence.start)),
    }))
    .filter((silence) => Number.isFinite(silence.start) && Number.isFinite(silence.end))
    .filter((silence) => silence.end > silence.start)
    .sort((left, right) => left.start - right.start);
}

function validTranscriptTime(start, end) {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start;
}

function normalizeVerboseSegments(segments) {
  return segments
    .filter((segment) => segment && segment.text && validTranscriptTime(segment.start, segment.end))
    .map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: cleanSubtitleText(segment.text),
      ...(segment.speaker != null && String(segment.speaker).trim() ? { speaker: String(segment.speaker).trim() } : {}),
    }));
}

export function rebuildTranscriptCuesFromWords(words, options = {}) {
  const settings = {
    maxTextLength: positiveNumber(options.maxTextLength, DEFAULT_MAX_SUBTITLE_TEXT_LENGTH),
    maxDuration: positiveNumber(options.maxDuration, DEFAULT_MAX_SUBTITLE_SECONDS),
    maxCps: positiveNumber(options.maxCps, DEFAULT_MAX_SUBTITLE_CPS),
  };
  const normalizedWords = [...(words ?? [])]
    .filter((word) => word && validTranscriptTime(word.start, word.end))
    .map((word) => ({
      start: word.start,
      end: word.end,
      text: cleanSubtitleText(word.word ?? word.text ?? ''),
    }))
    .filter((word) => word.text)
    .sort((left, right) => left.start - right.start);

  const cues = [];
  let currentSentence = [];

  for (const word of normalizedWords) {
    currentSentence.push(word);

    if (isSentenceBoundary(word.text)) {
      cues.push(wordsToCue(currentSentence));
      currentSentence = [];
    }
  }

  if (currentSentence.length > 0) {
    cues.push(...splitWordsByCueLimits(currentSentence, settings));
  }

  return cues.filter((cue) => cue.text);
}

function splitWordsByCueLimits(words, settings) {
  const cues = [];
  let current = [];

  for (const word of words) {
    if (current.length > 0 && shouldStartNewCue(current, word, settings)) {
      cues.push(wordsToCue(current));
      current = [word];
      continue;
    }

    current.push(word);
  }

  if (current.length > 0) {
    cues.push(wordsToCue(current));
  }

  return cues;
}

function splitSubtitleText(text, maxTextLength) {
  const cleaned = cleanSubtitleText(text);
  const maxLength = Math.max(1, Math.floor(Number(maxTextLength) || DEFAULT_MAX_SUBTITLE_TEXT_LENGTH));

  if (!cleaned || cleaned.length <= maxLength) {
    return cleaned ? [cleaned] : [];
  }

  const sentenceParts = splitSubtitleSentences(cleaned);
  if (sentenceParts.length > 1) {
    return sentenceParts.flatMap((sentence) => splitSubtitleText(sentence, maxLength));
  }

  const chunks = [];
  let current = '';

  for (const word of cleaned.split(' ')) {
    if (!word) {
      continue;
    }

    if (word.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }

      for (let index = 0; index < word.length; index += maxLength) {
        chunks.push(word.slice(index, index + maxLength));
      }
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = word;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [cleaned];
}

function splitSubtitleSentences(text) {
  const parts = String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : [text];
}

function shouldStartNewCue(currentWords, nextWord, settings) {
  const nextWords = [...currentWords, nextWord];
  const currentStart = currentWords[0].start;
  const nextDuration = Math.max(nextWord.end - currentStart, 0.001);
  const nextText = wordsToText(nextWords);
  const nextCps = nextText.length / nextDuration;

  return (
    nextText.length > settings.maxTextLength ||
    nextDuration > settings.maxDuration ||
    nextCps > settings.maxCps * 1.5
  );
}

function wordsToCue(words) {
  const start = roundSeconds(words[0]?.start ?? 0);
  const rawEnd = roundSeconds(words.reduce((latest, word) => Math.max(latest, word.end), start));
  return {
    start,
    end: roundSeconds(Math.max(rawEnd, start + 0.001)),
    text: wordsToText(words),
  };
}

function wordsToText(words) {
  return cleanSubtitleText(words.map((word) => word.text).join(' '));
}

function segmentsHaveSentenceBoundaries(segments) {
  return segments.some((segment) => /[.!?]/.test(String(segment?.text ?? '')));
}

function isSentenceBoundary(text) {
  return /[.!?]$/.test(String(text ?? '').trim());
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundSeconds(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}
