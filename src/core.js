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

    for (const subtitle of chunk.subtitles ?? []) {
      const localStart = numberOr(subtitle.start, 0);
      const localEnd = numberOr(subtitle.end ?? subtitle.start, localStart);
      const globalStart = roundSeconds(chunkStartTime + localStart);
      const globalEnd = roundSeconds(Math.max(chunkStartTime + localEnd, globalStart + 0.001));
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

      const originalParts = splitSubtitleText(original, maxTextLength);
      const translated = cleanSubtitleText(subtitle.translated ?? '');
      const translatedParts = translated ? splitSubtitleText(translated, maxTextLength) : [];
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
    const displayParts = splitSubtitleText(translated || original, maxTextLength);
    const originalParts = splitSubtitleText(original, maxTextLength);
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
      });
    });
  }

  return sortSubtitles(splitSubtitles);
}

export function normalizeTranscriptionSegments(response, fallbackDuration = 0, options = {}) {
  const words = Array.isArray(response?.words) ? response.words : [];
  const segments = Array.isArray(response?.segments) ? response.segments : [];

  if (words.length > 0) {
    if (!words.some((word) => isSentenceBoundary(word.word ?? word.text)) && segmentsHaveSentenceBoundaries(segments)) {
      return normalizeVerboseSegments(segments, fallbackDuration);
    }

    const wordSegments = rebuildTranscriptCuesFromWords(words, options);
    if (wordSegments.length > 0) {
      return wordSegments;
    }
  }

  if (segments.length > 0) {
    return normalizeVerboseSegments(segments, fallbackDuration);
  }

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
    .map((subtitle, index) => {
      const text = subtitleText(subtitle, field);
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
  const cues = sortSubtitles(subtitles).map((subtitle) => {
    const text = subtitleText(subtitle, field);
    return [
      `${formatTimestamp(subtitle.start, '.')} --> ${formatTimestamp(subtitle.end, '.')}`,
      text,
      '',
    ].join('\n');
  });

  return ['WEBVTT', '', ...cues].join('\n');
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

function normalizeVerboseSegments(segments, fallbackDuration) {
  return segments
    .filter((segment) => segment && segment.text)
    .map((segment) => ({
      start: Number(segment.start ?? 0),
      end: Number(segment.end ?? segment.start ?? fallbackDuration),
      text: cleanSubtitleText(segment.text),
    }));
}

export function rebuildTranscriptCuesFromWords(words, options = {}) {
  const settings = {
    maxTextLength: positiveNumber(options.maxTextLength, DEFAULT_MAX_SUBTITLE_TEXT_LENGTH),
    maxDuration: positiveNumber(options.maxDuration, DEFAULT_MAX_SUBTITLE_SECONDS),
    maxCps: positiveNumber(options.maxCps, DEFAULT_MAX_SUBTITLE_CPS),
  };
  const normalizedWords = [...(words ?? [])]
    .map((word) => ({
      start: Number(word.start ?? 0),
      end: Number(word.end ?? word.start ?? 0),
      text: cleanSubtitleText(word.word ?? word.text ?? ''),
    }))
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end))
    .filter((word) => word.end >= word.start)
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
  const rawEnd = roundSeconds(words[words.length - 1]?.end ?? start);
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
