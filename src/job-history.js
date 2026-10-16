import {
  createSubtitleDownloads,
  sanitizeFileBase,
  secondsToClock,
  sortSubtitles,
} from './core.js';
import { createZipDownload } from './zip-download.js';

export function createJobHistoryEntry({
  fileName = 'subtitle-job',
  fileSize = 0,
  duration = 0,
  subtitles = [],
  createdAt = new Date().toISOString(),
} = {}) {
  const sortedSubtitles = sortSubtitles(subtitles).map((subtitle) => ({ ...subtitle }));
  const baseName = sanitizeFileBase(fileName);
  const slug = baseName.toLowerCase().replace(/\s+/g, '-');

  return {
    id: `${slug}-${Date.parse(createdAt) || Date.now()}-${sortedSubtitles.length}`,
    fileName,
    fileSize: Number(fileSize) || 0,
    duration: Number(duration) || 0,
    createdAt,
    subtitleCount: sortedSubtitles.length,
    subtitles: sortedSubtitles,
  };
}

export function createHistoryExportFiles(entry, options = {}) {
  if (!entry || !Array.isArray(entry.subtitles) || entry.subtitles.length === 0) {
    return [];
  }

  const files = createSubtitleDownloads(entry.subtitles, entry.fileName, {
    offsetSeconds: Number(options.offsetSeconds) || 0,
  });
  return [...files, createZipDownload(files, entry.fileName)];
}

export function findReusableHistoryEntry(history, file) {
  if (!file) {
    return null;
  }

  const name = String(file.name ?? '');
  const size = Number(file.size) || 0;
  return (history ?? []).find((entry) => entry.fileName === name && entry.fileSize === size) ?? null;
}

export function upsertJobHistoryEntry(history, entry, limit = 20) {
  if (!entry) {
    return [...(history ?? [])].slice(0, limit);
  }

  const next = (history ?? []).filter(
    (item) => item.fileName !== entry.fileName || item.fileSize !== entry.fileSize,
  );
  return [entry, ...next].slice(0, limit);
}

export function formatJobHistoryMeta(entry) {
  const created = entry?.createdAt ? new Date(entry.createdAt) : null;
  const createdText = created && Number.isFinite(created.getTime())
    ? created.toLocaleString('ko-KR')
    : '';
  const durationText = Number(entry?.duration) > 0 ? secondsToClock(entry.duration) : '길이 미확인';

  return [
    `${entry?.subtitleCount ?? 0}개 자막`,
    durationText,
    createdText,
  ].filter(Boolean).join(' · ');
}
