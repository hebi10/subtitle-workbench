export const PREVIEW_SUBTITLE_LIMIT = 20;

export function canStartSubtitleJob({ hasFile, isBusy, connectionMode, apiKey, proxyUrl }) {
  if (!hasFile || isBusy || !String(apiKey ?? '').trim()) {
    return false;
  }

  return connectionMode === 'worker'
    ? Boolean(String(proxyUrl ?? '').trim())
    : true;
}

export function visibleSubtitlePreview(subtitles, limit = PREVIEW_SUBTITLE_LIMIT) {
  return [...(subtitles ?? [])].slice(0, limit);
}

export function previewLimitLabel(totalCount, limit = PREVIEW_SUBTITLE_LIMIT) {
  const total = Number(totalCount) || 0;

  if (total === 0) {
    return '';
  }

  if (total > limit) {
    return `처음 ${limit}개만 표시합니다. 전체 자막은 다운로드 파일에서 확인하세요.`;
  }

  return `전체 ${total}개 표시`;
}
