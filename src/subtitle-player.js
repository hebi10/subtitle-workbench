import { cleanSubtitleText, sortSubtitles } from './core.js';

const TIME_LINE_SEPARATOR = /\s+-->\s+/;
const CUE_TIME_TAG_PATTERN = /<\d{1,2}:\d{2}:\d{2}[,.]\d{3}>/g;
const HTML_TAG_PATTERN = /<\/?[^>]+>/g;

export function parseSrt(text) {
  return parseCueBlocks(text);
}

export function parseVtt(text) {
  return parseCueBlocks(text, { skipHeaders: true });
}

export function parseJsonSubtitles(text) {
  const data = JSON.parse(String(text ?? ''));
  return sortSubtitles(readJsonSubtitles(data));
}

export function parseSubtitleFileText(text, fileName = '') {
  const extension = String(fileName).toLowerCase().split('.').pop();
  const content = String(text ?? '').replace(/^\uFEFF/, '').trimStart();

  if (extension === 'srt') {
    return parseSrt(content);
  }

  if (extension === 'vtt' || content.startsWith('WEBVTT')) {
    return parseVtt(content);
  }

  if (extension === 'json' || content.startsWith('[') || content.startsWith('{')) {
    return parseJsonSubtitles(content);
  }

  throw new Error('지원하지 않는 자막 파일 형식입니다. SRT, VTT, JSON 파일을 선택해 주세요.');
}

export function findActiveSubtitle(subtitles, currentTime, offsetSeconds = 0) {
  const effectiveTime = toNumber(currentTime, 0) - toNumber(offsetSeconds, 0);

  return (
    sortSubtitles(subtitles).find((subtitle) => {
      const start = toNumber(subtitle.start, 0);
      const end = toNumber(subtitle.end, start);
      return effectiveTime >= start && effectiveTime < end;
    }) ?? null
  );
}

export function formatSubtitleForMode(subtitle, mode = 'translated') {
  if (!subtitle) {
    return { primary: '', secondary: '' };
  }

  const original = cleanSubtitleText(subtitle.original ?? subtitle.text ?? '');
  const translated = cleanSubtitleText(subtitle.translated ?? '');

  if (mode === 'original') {
    return {
      primary: original || translated,
      secondary: '',
    };
  }

  if (mode === 'both') {
    const primary = translated || original;
    const secondary = translated && original && translated !== original ? original : '';
    return { primary, secondary };
  }

  return {
    primary: translated || original,
    secondary: '',
  };
}

function parseCueBlocks(text, options = {}) {
  const blocks = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/);
  const subtitles = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0 || shouldSkipVttBlock(lines, options)) {
      continue;
    }

    const timeLineIndex = lines.findIndex((line) => TIME_LINE_SEPARATOR.test(line));
    if (timeLineIndex < 0) {
      continue;
    }

    const timing = parseTimingLine(lines[timeLineIndex]);
    if (!timing) {
      continue;
    }

    const textLines = lines.slice(timeLineIndex + 1);
    const original = normalizeCueText(textLines.join('\n'));
    if (!original) {
      continue;
    }

    subtitles.push({
      start: timing.start,
      end: timing.end,
      original,
      translated: '',
    });
  }

  return sortSubtitles(subtitles);
}

function shouldSkipVttBlock(lines, options) {
  if (!options.skipHeaders) {
    return false;
  }

  const first = lines[0]?.toUpperCase() ?? '';
  return (
    first.startsWith('WEBVTT') ||
    first.startsWith('NOTE') ||
    first === 'STYLE' ||
    first === 'REGION'
  );
}

function parseTimingLine(line) {
  const [startText, endTextWithSettings] = String(line).split(TIME_LINE_SEPARATOR);
  const endText = endTextWithSettings?.trim().split(/\s+/)[0];
  const start = parseTimestampToSeconds(startText);
  const end = parseTimestampToSeconds(endText);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }

  return {
    start: roundSeconds(start),
    end: roundSeconds(end),
  };
}

function parseTimestampToSeconds(value) {
  const parts = String(value ?? '')
    .trim()
    .replace(',', '.')
    .split(':');

  if (parts.length < 2 || parts.length > 3) {
    return NaN;
  }

  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length === 1 ? Number(parts.pop()) : 0;

  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return NaN;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function readJsonSubtitles(data) {
  if (Array.isArray(data)) {
    return data.flatMap((item) => readJsonItem(item, 0));
  }

  if (data && typeof data === 'object') {
    if (Array.isArray(data.subtitles)) {
      return readJsonItem(data, 0);
    }

    for (const key of ['items', 'cues', 'segments']) {
      if (Array.isArray(data[key])) {
        return data[key].flatMap((item) => readJsonItem(item, 0));
      }
    }
  }

  return [];
}

function readJsonItem(item, offsetSeconds) {
  if (!item || typeof item !== 'object') {
    return [];
  }

  if (Array.isArray(item.subtitles)) {
    const nextOffset = toNumber(item.startTime ?? item.extractStart ?? item.start, offsetSeconds);
    return item.subtitles.flatMap((subtitle) => readJsonItem(subtitle, nextOffset));
  }

  const normalized = normalizeJsonSubtitle(item, offsetSeconds);
  return normalized ? [normalized] : [];
}

function normalizeJsonSubtitle(subtitle, offsetSeconds) {
  const localStart = toNumber(subtitle.start ?? subtitle.from ?? subtitle.begin, NaN);
  const localEnd = toNumber(subtitle.end ?? subtitle.to ?? subtitle.finish, NaN);

  if (!Number.isFinite(localStart)) {
    return null;
  }

  const start = roundSeconds(offsetSeconds + localStart);
  const end = roundSeconds(Math.max(offsetSeconds + (Number.isFinite(localEnd) ? localEnd : localStart), start + 0.001));
  const original = cleanSubtitleText(subtitle.original ?? subtitle.text ?? subtitle.content ?? '');
  const translated = cleanSubtitleText(subtitle.translated ?? subtitle.translation ?? '');

  if (!original && !translated) {
    return null;
  }

  return {
    start,
    end,
    original,
    translated,
  };
}

function normalizeCueText(text) {
  return cleanSubtitleText(
    String(text ?? '')
      .replace(CUE_TIME_TAG_PATTERN, '')
      .replace(HTML_TAG_PATTERN, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>'),
  );
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundSeconds(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
