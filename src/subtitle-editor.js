import { cleanSubtitleText, sortSubtitles } from './core.js';

const DEFAULT_MAX_TEXT_LENGTH = 42;
const DEFAULT_MAX_DURATION = 4.5;
const DEFAULT_MAX_CPS = 18;

export function filterSubtitles(subtitles, { query = '', status = 'all', ...qualityOptions } = {}) {
  const normalizedQuery = String(query ?? '').trim().toLowerCase();

  return sortSubtitles(subtitles).filter((subtitle) => {
    if (status === 'failed' && subtitle.status !== 'failed') {
      return false;
    }
    if (status === 'warning' && getSubtitleEditMetrics(subtitle, qualityOptions).warnings.length === 0) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      subtitle.original,
      subtitle.translated,
      subtitle.translationError,
    ]
      .map((value) => String(value ?? '').toLowerCase())
      .join(' ');

    return haystack.includes(normalizedQuery);
  });
}

export function mergeShortSubtitles(subtitles, options = {}) {
  const sorted = sortSubtitles(subtitles);
  const maxDuration = Number(options.maxDuration) || 1.2;
  const maxLength = Number(options.maxLength) || 8;
  const maxGap = Math.max(0, toNumber(options.maxGap, 0.5));
  const maxMergedDuration = Math.max(0.001, toNumber(options.maxMergedDuration, DEFAULT_MAX_DURATION));
  const maxTextLength = Math.max(1, toNumber(options.maxTextLength, DEFAULT_MAX_TEXT_LENGTH));
  const merged = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const subtitle = sorted[index];
    if (!isShortSubtitle(subtitle, maxDuration, maxLength)) {
      merged.push(subtitle);
      continue;
    }

    const run = [subtitle];
    while (isShortSubtitle(sorted[index + 1], maxDuration, maxLength)) {
      const next = sorted[index + 1];
      const candidate = mergeSubtitleRun([...run, next]);
      const previousEnd = Math.max(...run.map((cue) => toNumber(cue.end, 0)));
      if (
        roundSeconds(toNumber(next.start, 0) - previousEnd) > maxGap ||
        candidate.end - candidate.start > maxMergedDuration ||
        Math.max(candidate.original.length, candidate.translated.length) > maxTextLength
      ) {
        break;
      }
      index += 1;
      run.push(sorted[index]);
    }

    merged.push(run.length > 1 ? mergeSubtitleRun(run) : subtitle);
  }

  return merged;
}

export function updateSubtitleTextAt(subtitles, index, field, value) {
  const safeField = field === 'original' ? 'original' : 'translated';

  return sortSubtitles(subtitles).map((subtitle, subtitleIndex) => {
    if (subtitleIndex !== index) {
      return subtitle;
    }

    const next = {
      ...subtitle,
      [safeField]: cleanSubtitleText(value),
    };

    if (safeField === 'translated' && next.status === 'failed' && next.translated) {
      next.status = 'edited';
      delete next.translationError;
    }

    return next;
  });
}

export function shiftSubtitles(subtitles, deltaSeconds) {
  return sortSubtitles(subtitles).map((subtitle) => shiftSubtitle(subtitle, deltaSeconds));
}

export function shiftSubtitleAt(subtitles, index, deltaSeconds) {
  return sortSubtitles(subtitles).map((subtitle, subtitleIndex) => {
    if (subtitleIndex !== index) {
      return subtitle;
    }

    return shiftSubtitle(subtitle, deltaSeconds);
  });
}

export function updateSubtitleTimingAt(subtitles, index, timing = {}) {
  return sortSubtitles(subtitles).map((subtitle, subtitleIndex) => {
    if (subtitleIndex !== index) {
      return subtitle;
    }

    const currentStart = toNumber(subtitle.start, 0);
    const currentEnd = toNumber(subtitle.end, currentStart + 0.001);
    const start = roundSeconds(Math.max(0, toNumber(timing.start, currentStart)));
    const requestedEnd = roundSeconds(Math.max(0, toNumber(timing.end, currentEnd)));

    return {
      ...subtitle,
      start,
      end: roundSeconds(Math.max(requestedEnd, start + 0.001)),
    };
  });
}

export function splitSubtitleAt(subtitles, index) {
  const sorted = sortSubtitles(subtitles);
  const subtitle = sorted[index];
  if (!subtitle) {
    return sorted;
  }

  const start = toNumber(subtitle.start, 0);
  const end = Math.max(toNumber(subtitle.end, start + 0.001), start + 0.001);
  const midpoint = roundSeconds(start + (end - start) / 2);
  const [originalA, originalB] = splitTextInHalf(subtitle.original ?? subtitle.text ?? '');
  const [translatedA, translatedB] = splitTextInHalf(subtitle.translated ?? '');

  const first = {
    ...subtitle,
    start: roundSeconds(start),
    end: midpoint,
    original: originalA,
    translated: translatedA,
  };
  const second = {
    ...subtitle,
    start: midpoint,
    end: roundSeconds(end),
    original: originalB,
    translated: translatedB,
  };

  return [...sorted.slice(0, index), first, second, ...sorted.slice(index + 1)];
}

export function mergeSubtitleWithNext(subtitles, index) {
  const sorted = sortSubtitles(subtitles);
  const current = sorted[index];
  const next = sorted[index + 1];
  if (!current || !next) {
    return sorted;
  }

  const merged = {
    ...current,
    end: roundSeconds(Math.max(toNumber(current.end, 0), toNumber(next.end, 0))),
    original: joinSubtitleText(current.original ?? current.text ?? '', next.original ?? next.text ?? ''),
    translated: joinSubtitleText(current.translated ?? '', next.translated ?? ''),
  };

  if (current.status === 'failed' || next.status === 'failed') {
    merged.status = 'failed';
    merged.translationError = current.translationError || next.translationError;
  } else if (current.status || next.status) {
    merged.status = current.status || next.status;
  }

  return [...sorted.slice(0, index), merged, ...sorted.slice(index + 2)];
}

export function getSubtitleEditMetrics(subtitle, options = {}) {
  const maxTextLength = Number(options.maxTextLength) || DEFAULT_MAX_TEXT_LENGTH;
  const maxDuration = Number(options.maxDuration) || DEFAULT_MAX_DURATION;
  const maxCps = Number(options.maxCps) || DEFAULT_MAX_CPS;
  const original = cleanSubtitleText(subtitle?.original ?? subtitle?.text ?? '');
  const translated = cleanSubtitleText(subtitle?.translated ?? '');
  const visibleText = translated || original;
  const start = toNumber(subtitle?.start, 0);
  const end = toNumber(subtitle?.end, start);
  const duration = roundSeconds(Math.max(0, end - start));
  const length = visibleText.length;
  const cps = duration > 0 ? roundSeconds(length / duration) : length;
  const warnings = [];

  if (length > maxTextLength) {
    warnings.push('long-text');
  }
  if (duration > maxDuration) {
    warnings.push('long-duration');
  }
  if (cps > maxCps) {
    warnings.push('high-cps');
  }

  return {
    duration,
    length,
    cps,
    warnings,
  };
}

function shiftSubtitle(subtitle, deltaSeconds) {
  const delta = Number(deltaSeconds) || 0;
  const start = roundSeconds(Math.max(0, Number(subtitle.start || 0) + delta));
  const rawEnd = roundSeconds(Math.max(0, Number(subtitle.end || 0) + delta));

  return {
    ...subtitle,
    start,
    end: roundSeconds(Math.max(rawEnd, start + 0.001)),
  };
}

function isShortSubtitle(subtitle, maxDuration, maxLength) {
  if (!subtitle) {
    return false;
  }

  const start = toNumber(subtitle.start, 0);
  const end = toNumber(subtitle.end, start);
  const text = cleanSubtitleText(subtitle.translated || subtitle.original || subtitle.text || '');
  return end - start <= maxDuration || text.length <= maxLength;
}

function mergeSubtitleRun(subtitles) {
  const first = subtitles[0];
  const last = subtitles[subtitles.length - 1];
  const merged = {
    ...first,
    start: roundSeconds(toNumber(first.start, 0)),
    end: roundSeconds(Math.max(...subtitles.map((subtitle) => toNumber(subtitle.end, 0)))),
    original: cleanSubtitleText(subtitles.map((subtitle) => subtitle.original ?? subtitle.text ?? '').join(' ')),
    translated: cleanSubtitleText(subtitles.map((subtitle) => subtitle.translated ?? '').join(' ')),
  };

  const failed = subtitles.find((subtitle) => subtitle.status === 'failed');
  if (failed) {
    merged.status = 'failed';
    merged.translationError = failed.translationError;
  } else {
    merged.status = last.status || first.status;
    delete merged.translationError;
  }

  return merged;
}

function roundSeconds(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function splitTextInHalf(value) {
  const text = cleanSubtitleText(value);
  if (!text) {
    return ['', ''];
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    const midpoint = Math.ceil(text.length / 2);
    return [text.slice(0, midpoint).trim(), text.slice(midpoint).trim()];
  }

  const midpoint = Math.ceil(words.length / 2);
  return [
    cleanSubtitleText(words.slice(0, midpoint).join(' ')),
    cleanSubtitleText(words.slice(midpoint).join(' ')),
  ];
}

function joinSubtitleText(first, second) {
  return cleanSubtitleText([first, second].filter(Boolean).join(' '));
}
