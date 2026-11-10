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

export function getGeneratePreparationStatus({
  hasFile,
  hasDuration,
  hasApiKey,
  connectionMode,
  proxyUrl,
  sourceLanguage,
  translationEnabled,
  targetLanguage,
  isCustomTarget,
  customTargetLanguage,
}) {
  const file = !hasFile ? '파일 선택 필요' : hasDuration ? '길이 확인됨' : '파일 길이 확인 필요';
  const connection = !hasApiKey
    ? 'API 키 입력 필요'
    : connectionMode === 'worker' && !String(proxyUrl ?? '').trim()
      ? 'Worker URL 입력 필요'
      : '정보 입력됨 · 실제 연결 미검증';
  const source = String(sourceLanguage ?? '').trim() || '자동 감지';
  const target = isCustomTarget
    ? String(customTargetLanguage ?? '').trim() || '번역 언어 입력 필요'
    : String(targetLanguage ?? '').trim() || '언어 확인 필요';
  const language = translationEnabled ? `${source} → ${target}` : `${source} · 번역 사용 안 함`;
  return { file, connection, language };
}
