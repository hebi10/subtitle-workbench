import {
  buildChunkPlan,
  createTranslationFailureLogDownload,
  createSubtitleDownloads,
  formatTimestamp,
  formatVtt,
  getTranslationFailures,
  mergeSubtitles,
  normalizeTranscriptionSegments,
  secondsToClock,
  splitLongSubtitles,
  sortSubtitles,
} from './core.js';
import { BrowserFfmpeg } from './ffmpeg-pipeline.js';
import { mapWithConcurrency } from './limited-concurrency.js';
import { createJobRunner } from './job-runner.js';
import { createJobHistoryEntry } from './job-history.js';
import { createEditHistory, commitEdit, undoEdit, redoEdit } from './edit-history.js';
import { OPENAI_DEFAULTS, requestTranscription, translateSubtitles } from './openai.js';
import { createCredentialController } from './credential-controller.js';
import { getStartRequirement } from './credential-ui-state.js';
import {
  canStartSubtitleJob,
  getExportSummary,
  getGeneratePreparationStatus,
  previewLimitLabel,
  visibleSubtitlePreview,
} from './ui-state.js';
import {
  findActiveSubtitle,
  formatSubtitleForMode,
  parseSubtitleFileText,
} from './subtitle-player.js';
import {
  filterSubtitles,
  getSubtitleEditMetrics,
  mergeShortSubtitles,
  mergeSubtitleWithNext,
  shiftSubtitleAt,
  shiftSubtitles,
  splitSubtitleAt,
  updateSubtitleTimingAt,
  updateSubtitleTextAt,
  updateSpeakerAt,
} from './subtitle-editor.js';

const STEPS = [
  ['load', 'ffmpeg 로드'],
  ['extract', '오디오 추출'],
  ['silence', '무음 분석'],
  ['split', '오디오 분할'],
  ['transcribe', '음성 인식'],
  ['translate', '번역'],
  ['output', '파일 생성'],
  ['done', '완료'],
];

const TRANSCRIPTION_CONCURRENCY = 2;

const state = {
  file: null,
  selectedFiles: [],
  fileUrl: null,
  vttUrl: null,
  downloadUrls: [],
  duration: 0,
  subtitles: [],
  playerSubtitles: [],
  activeSubtitleIndex: -1,
  editorSelectedCueIndex: -1,
  editorVisibleCueIndices: [],
  subtitleOffsetSeconds: 0,
  ffmpeg: null,
  results: [],
  activeResultId: null,
  nextResultId: 1,
  editHistory: createEditHistory(),
  outputFileName: '',
  isBusy: false,
  editorQuery: '',
  editorStatus: 'all',
  pipelineResultId: null,
  retryController: null,
};

const refs = {
  workspace: document.querySelector('.workspace'),
  overallProgress: document.querySelector('#overallProgress'),
  translationRecovery: document.querySelector('#translationRecovery'),
  translationRecoveryText: document.querySelector('#translationRecoveryText'),
  retryTranslationButton: document.querySelector('#retryTranslationButton'),
  attachMediaFile: document.querySelector('#attachMediaFile'),
  mediaPlayer: document.querySelector('#mediaPlayer'),
  mediaEmptyState: document.querySelector('#mediaEmptyState'),
  generatePlayerMount: document.querySelector('#generatePlayerMount'),
  editPlayerMount: document.querySelector('#editPlayerMount'),
  jobResults: document.querySelector('#jobResults'),
  jobResultSelect: document.querySelector('#jobResultSelect'),
  exportResultSelect: document.querySelector('#exportResultSelect'),
  exportFileName: document.querySelector('#exportFileName'),
  exportResultStatus: document.querySelector('#exportResultStatus'),
  exportWorkflowStatus: document.querySelector('#exportWorkflowStatus'),
  exportLanguage: document.querySelector('#exportLanguage'),
  exportSyncSummary: document.querySelector('#exportSyncSummary'),
  exportDownloadStatus: document.querySelector('#exportDownloadStatus'),
  exportBuildError: document.querySelector('#exportBuildError'),
  exportBuildErrorText: document.querySelector('#exportBuildErrorText'),
  retryExportButton: document.querySelector('#retryExportButton'),
  batchSummary: document.querySelector('#batchSummary'),
  undoEdit: document.querySelector('#undoEdit'),
  redoEdit: document.querySelector('#redoEdit'),
  editHistoryStatus: document.querySelector('#editHistoryStatus'),
  tabButtons: document.querySelectorAll('[data-tab-target]'),
  tabPanels: document.querySelectorAll('[data-tab-panel]'),
  fileInput: document.querySelector('#videoFile'),
  dropzone: document.querySelector('#dropzone'),
  fileMeta: document.querySelector('#fileMeta'),
  videoPreview: document.querySelector('#videoPreview'),
  subtitleFileInput: document.querySelector('#subtitleFile'),
  subtitleFileMeta: document.querySelector('#subtitleFileMeta'),
  subtitleDisplayMode: document.querySelector('#subtitleDisplayMode'),
  subtitleSyncReset: document.querySelector('#subtitleSyncReset'),
  subtitleOffsetValue: document.querySelector('#subtitleOffsetValue'),
  subtitlePanel: document.querySelector('#subtitlePanel'),
  subtitlePrimary: document.querySelector('#subtitlePrimary'),
  subtitleSecondary: document.querySelector('#subtitleSecondary'),
  settingsForm: document.querySelector('#settingsForm'),
  connectionModeInputs: document.querySelectorAll('input[name="connectionMode"]'),
  proxyUrlField: document.querySelector('#proxyUrlField'),
  connectionHelp: document.querySelector('#connectionHelp'),
  startButton: document.querySelector('#startButton'),
  cancelButton: document.querySelector('#cancelButton'),
  apiKey: document.querySelector('#apiKey'),
  proxyUrl: document.querySelector('#proxyUrl'),
  rememberCredentials: document.querySelector('#rememberCredentials'),
  credentialPassphraseFields: document.querySelector('#credentialPassphraseFields'),
  localPassphrase: document.querySelector('#localPassphrase'),
  localPassphraseConfirmationField: document.querySelector('#localPassphraseConfirmationField'),
  localPassphraseConfirmation: document.querySelector('#localPassphraseConfirmation'),
  saveCredentialButton: document.querySelector('#saveCredentialButton'),
  unlockCredentialButton: document.querySelector('#unlockCredentialButton'),
  deleteCredentialButton: document.querySelector('#deleteCredentialButton'),
  credentialStatus: document.querySelector('#credentialStatus'),
  credentialError: document.querySelector('#credentialError'),
  startRequirement: document.querySelector('#startRequirement'),
  generateFileStatus: document.querySelector('#generateFileStatus'),
  generateConnectionStatus: document.querySelector('#generateConnectionStatus'),
  generateLanguageStatus: document.querySelector('#generateLanguageStatus'),
  generateWorkflowStatus: document.querySelector('#generateWorkflowStatus'),
  sourceLanguage: document.querySelector('#sourceLanguage'),
  targetLanguage: document.querySelector('#targetLanguage'),
  customTargetLanguage: document.querySelector('#customTargetLanguage'),
  customTargetLanguageField: document.querySelector('#customTargetLanguageField'),
  sttModel: document.querySelector('#sttModel'),
  translationModel: document.querySelector('#translationModel'),
  noiseDb: document.querySelector('#noiseDb'),
  silenceDuration: document.querySelector('#silenceDuration'),
  targetMinutes: document.querySelector('#targetMinutes'),
  minMinutes: document.querySelector('#minMinutes'),
  maxMinutes: document.querySelector('#maxMinutes'),
  searchMinutes: document.querySelector('#searchMinutes'),
  paddingSeconds: document.querySelector('#paddingSeconds'),
  maxSubtitleChars: document.querySelector('#maxSubtitleChars'),
  maxSubtitleSeconds: document.querySelector('#maxSubtitleSeconds'),
  maxSubtitleCps: document.querySelector('#maxSubtitleCps'),
  audioBitrate: document.querySelector('#audioBitrate'),
  translationEnabled: document.querySelector('#translationEnabled'),
  progressText: document.querySelector('#progressText'),
  progressBar: document.querySelector('#progressBar'),
  durationValue: document.querySelector('#durationValue'),
  runPanel: document.querySelector('#runPanel'),
  statusBadge: document.querySelector('#statusBadge'),
  stepList: document.querySelector('#stepList'),
  errorBox: document.querySelector('#errorBox'),
  chunksList: document.querySelector('#chunksList'),
  chunkSummary: document.querySelector('#chunkSummary'),
  downloads: document.querySelector('#downloads'),
  translationFailureSummary: document.querySelector('#translationFailureSummary'),
  subtitleCount: document.querySelector('#subtitleCount'),
  previewBody: document.querySelector('#previewBody'),
  previewLimit: document.querySelector('#previewLimit'),
  logOutput: document.querySelector('#logOutput'),
  editorSearch: document.querySelector('#editorSearch'),
  editorStatusFilter: document.querySelector('#editorStatusFilter'),
  editorGlobalOffset: document.querySelector('#editorGlobalOffset'),
  applyGlobalOffset: document.querySelector('#applyGlobalOffset'),
  mergeShortSubtitles: document.querySelector('#mergeShortSubtitles'),
  editorBody: document.querySelector('#editorBody'),
  editorCount: document.querySelector('#editorCount'),
  editorCueContext: document.querySelector('#editorCueContext'),
  editorWorkspaceStatus: document.querySelector('#editorWorkspaceStatus'),
  editorCuePosition: document.querySelector('#editorCuePosition'),
  editorCueTiming: document.querySelector('#editorCueTiming'),
  editorCueSpeaker: document.querySelector('#editorCueSpeaker'),
  editorCueOriginal: document.querySelector('#editorCueOriginal'),
  editorCueTranslated: document.querySelector('#editorCueTranslated'),
  editorPrevCue: document.querySelector('#editorPrevCue'),
  editorNextCue: document.querySelector('#editorNextCue'),
  editorFocusCue: document.querySelector('#editorFocusCue'),
  exportSubtitleCount: document.querySelector('#exportSubtitleCount'),
};

const credentialController = createCredentialController({
  controls: {
    apiKey: refs.apiKey,
    connectionModeInputs: refs.connectionModeInputs,
    proxyUrl: refs.proxyUrl,
    rememberCredentials: refs.rememberCredentials,
    credentialPassphraseFields: refs.credentialPassphraseFields,
    localPassphrase: refs.localPassphrase,
    localPassphraseConfirmationField: refs.localPassphraseConfirmationField,
    localPassphraseConfirmation: refs.localPassphraseConfirmation,
    saveCredentialButton: refs.saveCredentialButton,
    unlockCredentialButton: refs.unlockCredentialButton,
    deleteCredentialButton: refs.deleteCredentialButton,
    credentialStatus: refs.credentialStatus,
    credentialError: refs.credentialError,
  },
  // The old credential store is only touched by the explicit deletion action.
  storage: { removeItem: (key) => window.localStorage.removeItem(key) },
  getConnectionMode,
  isPipelineBusy: () => state.isBusy,
  onStateChange: updateStartButtonState,
});

const jobRunner = createJobRunner({
  runJob: async (file, { index, total, settings, signal }) => {
    await selectFile(file);
    signal.throwIfAborted();
    const validationError = validateRun(settings);
    if (validationError) throw new Error(validationError);
    refs.fileMeta.textContent = `${index + 1}/${total} · ${file.name} · ${formatBytes(file.size)}`;
    const onAbort = () => state.ffmpeg?.terminate();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await runPipelineForCurrentFile({ batchIndex: index + 1, batchCount: total }, settings, signal);
    } finally {
      signal.removeEventListener('abort', onAbort);
      await state.ffmpeg?.cleanup();
    }
  },
  onComplete: (file, subtitles) => {
    const settings = getSettings();
    const entry = state.results.find((result) => result.id === state.pipelineResultId);
    if (entry) {
      finishTranslation(entry, subtitles, false);
    } else {
      saveNewResult(subtitles, file.name, {
        outputLanguage: settings.translationEnabled ? settings.targetLanguage : settings.sourceLanguage || 'original',
      });
    }
  },
  onError: (file, error) => {
    showError(`${file.name}: ${formatRunError(error)}`);
    markActiveStepFailed();
  },
  onBusy: setBusy,
});

restoreConnectionSettings();
credentialController.initialize();
renderSteps();
renderDownloadPlaceholders();
renderEditor();
updateConnectionMode();
setRunState('idle');
renderSubtitlePlayer();
updateStartButtonState();
bindEvents();
renderResultSelector();
updateEditControls();
updateTranslationControls();

function bindEvents() {
  window.addEventListener('pagehide', () => {
    refs.apiKey.value = '';
    state.retryController?.abort();
    jobRunner.cancel();
    state.ffmpeg?.terminate();
  });
  refs.settingsForm.addEventListener('submit', (event) => event.preventDefault());
  refs.retryTranslationButton.addEventListener('click', retryTranslation);
  refs.attachMediaFile.addEventListener('change', () => {
    const [file] = refs.attachMediaFile.files;
    if (file) attachMediaToResult(file);
  });
  ['importSubtitlesEmpty', 'importSubtitlesExport'].forEach((id) => {
    document.getElementById(id).addEventListener('click', () => refs.subtitleFileInput.click());
  });
  ['goGenerateEmpty', 'goGenerateExport'].forEach((id) => {
    document.getElementById(id).addEventListener('click', () => {
      activateTab('generate');
      refs.fileInput.focus();
    });
  });
  [refs.maxSubtitleChars, refs.maxSubtitleSeconds, refs.maxSubtitleCps].forEach((field) => {
    field.addEventListener('input', renderEditor);
  });
  refs.jobResultSelect.addEventListener('change', () => restoreResult(refs.jobResultSelect.value));
  refs.exportResultSelect.addEventListener('change', () => restoreResult(refs.exportResultSelect.value));
  refs.retryExportButton.addEventListener('click', refreshDownloadsForCurrentOffset);
  refs.downloads.addEventListener('click', (event) => {
    const link = event.target.closest('a.download-link[download]');
    if (!link) return;
    const format = link.download.split('.').at(-1).toUpperCase();
    refs.exportDownloadStatus.dataset.state = 'requested';
    refs.exportDownloadStatus.dataset.format = format;
    refs.exportDownloadStatus.textContent = `${link.download} 다운로드 요청됨 · 실제 저장 여부는 브라우저 다운로드 내역에서 확인하세요.`;
  });
  refs.undoEdit.addEventListener('click', () => restoreEdit('undo'));
  refs.redoEdit.addEventListener('click', () => restoreEdit('redo'));
  refs.translationEnabled.addEventListener('change', updateTranslationControls);
  refs.targetLanguage.addEventListener('change', updateTranslationControls);
  [refs.sourceLanguage, refs.targetLanguage, refs.translationEnabled].forEach((field) => {
    field.addEventListener('change', updateStartButtonState);
  });
  refs.customTargetLanguage.addEventListener('input', updateStartButtonState);
  refs.tabButtons.forEach((button) => {
    button.addEventListener('keydown', (event) => {
      const tabs = [...refs.tabButtons];
      const index = tabs.indexOf(button);
      const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      activateTab(tabs[next].dataset.tabTarget);
      tabs[next].focus();
    });
    button.addEventListener('click', () => {
      activateTab(button.dataset.tabTarget);
    });
  });

  refs.fileInput.addEventListener('change', () => {
    const files = [...refs.fileInput.files];
    if (files.length > 0) {
      selectFiles(files);
    }
  });

  refs.subtitleFileInput.addEventListener('change', () => {
    handleSubtitleFileSelect();
  });

  refs.videoPreview.addEventListener('timeupdate', () => {
    renderSubtitlePlayer();
  });

  refs.videoPreview.addEventListener('seeked', () => {
    renderSubtitlePlayer();
  });

  ['loadedmetadata', 'durationchange', 'canplay'].forEach((eventName) => {
    refs.videoPreview.addEventListener(eventName, () => {
      syncVideoDurationFromPreview();
      renderSubtitlePlayer();
    });
  });

  refs.subtitleDisplayMode.addEventListener('change', () => {
    renderSubtitlePlayer();
  });

  document.querySelectorAll('[data-sync-adjust]').forEach((button) => {
    button.addEventListener('click', () => {
      adjustSubtitleSync(Number(button.dataset.syncAdjust));
    });
  });

  refs.subtitleSyncReset.addEventListener('click', () => {
    resetSubtitleSync();
  });

  refs.editorSearch.addEventListener('input', () => {
    state.editorQuery = refs.editorSearch.value;
    renderEditor();
  });

  refs.editorStatusFilter.addEventListener('change', () => {
    state.editorStatus = refs.editorStatusFilter.value;
    renderEditor();
  });

  refs.editorPrevCue.addEventListener('click', () => moveEditorCueSelection(-1));
  refs.editorNextCue.addEventListener('click', () => moveEditorCueSelection(1));
  refs.editorFocusCue.addEventListener('click', focusSelectedEditorCue);

  refs.editorBody.addEventListener('focusin', (event) => {
    const row = event.target.closest('[data-cue-index]');
    if (row) selectEditorCue(Number(row.dataset.cueIndex));
  });

  refs.editorBody.addEventListener('input', (event) => {
    const index = Number(event.target.dataset.editIndex);
    if (index !== state.editorSelectedCueIndex || state.isBusy) return;
    if (event.target.dataset.editField === 'original') {
      refs.editorCueOriginal.textContent = event.target.value || '원문 없음';
    } else if (event.target.dataset.editField === 'translated') {
      refs.editorCueTranslated.textContent = event.target.value || '번역 없음';
    }
  });

  refs.applyGlobalOffset.addEventListener('click', () => {
    applyGlobalSubtitleOffset();
  });

  refs.mergeShortSubtitles.addEventListener('click', () => {
    applyEdit(mergeShortSubtitles(state.subtitles, {
      maxTextLength: Number(refs.maxSubtitleChars.value || 42),
      maxMergedDuration: Number(refs.maxSubtitleSeconds.value || 4.5),
    }));
  });

  refs.editorBody.addEventListener('change', (event) => {
    if (state.isBusy) return;
    const field = event.target.dataset.editField;
    const timeField = event.target.dataset.timeField;
    const index = Number(event.target.dataset.editIndex);
    if (!Number.isInteger(index)) {
      return;
    }

    if (field) {
      state.subtitles = updateSubtitleTextAt(state.subtitles, index, field, event.target.value);
    } else if (timeField) {
      state.subtitles = updateSubtitleTimingAt(state.subtitles, index, {
        [timeField]: event.target.value,
      });
    } else if (event.target.dataset.speakerEdit === 'true') {
      state.subtitles = updateSpeakerAt(state.subtitles, index, event.target.value);
    } else {
      return;
    }
    applyEdit(state.subtitles);
  });

  refs.editorBody.addEventListener('click', (event) => {
    if (state.isBusy) return;
    const row = event.target.closest('[data-cue-index]');
    if (row) selectEditorCue(Number(row.dataset.cueIndex));
    const actionButton = event.target.closest('[data-editor-action]');
    if (actionButton) {
      handleEditorAction(actionButton);
      return;
    }

    const button = event.target.closest('[data-shift-index]');
    if (!button) {
      return;
    }

    const index = Number(button.dataset.shiftIndex);
    const delta = Number(button.dataset.shiftDelta);
    applyEdit(shiftSubtitleAt(state.subtitles, index, delta));
  });

  refs.dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (state.isBusy) return;
    refs.dropzone.classList.add('is-over');
  });

  refs.dropzone.addEventListener('dragleave', () => {
    refs.dropzone.classList.remove('is-over');
  });

  refs.dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    refs.dropzone.classList.remove('is-over');
    if (state.isBusy) return;
    const files = [...event.dataTransfer.files];
    if (files.length > 0) {
      selectFiles(files);
    }
  });

  refs.startButton.addEventListener('click', () => {
    runPipeline();
  });

  refs.cancelButton.addEventListener('click', () => {
    if (state.retryController) state.retryController.abort();
    else jobRunner.cancel();
    setProgress(0, '중단 요청됨', 'running');
  });

  refs.connectionModeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      updateConnectionMode();
      persistCurrentConnection();
      updateStartButtonState();
    });
  });

  refs.apiKey.addEventListener('input', () => {
    updateStartButtonState();
  });

  refs.proxyUrl.addEventListener('input', () => {
    persistCurrentConnection();
    updateStartButtonState();
  });

  refs.rememberCredentials.addEventListener('change', () => {
    credentialController.render();
  });

  refs.saveCredentialButton.addEventListener('click', () => {
    credentialController.save();
  });

  refs.unlockCredentialButton.addEventListener('click', () => {
    credentialController.unlock();
  });

  refs.deleteCredentialButton.addEventListener('click', () => {
    credentialController.deleteCredential();
  });
}

function activateTab(tabName) {
  const mount = tabName === 'edit' ? refs.editPlayerMount : refs.generatePlayerMount;
  if (refs.mediaPlayer.parentElement !== mount) mount.append(refs.mediaPlayer);
  refs.tabButtons.forEach((button) => {
    const active = button.dataset.tabTarget === tabName;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  refs.tabPanels.forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.tabPanel === tabName);
    panel.hidden = panel.dataset.tabPanel !== tabName;
  });
}

function getConnectionMode() {
  return refs.settingsForm.querySelector('input[name="connectionMode"]:checked')?.value ?? 'worker';
}

function updateConnectionMode() {
  const mode = getConnectionMode();
  const isWorker = mode === 'worker';

  refs.proxyUrlField.hidden = !isWorker;
  refs.connectionHelp.textContent = isWorker
    ? '직접 배포했거나 신뢰하는 Worker의 URL을 입력하세요. Worker는 API 키와 음성을 전달받습니다. Worker가 없다면 브라우저 직접 호출을 선택할 수 있습니다.'
    : '사용자 API 키를 브라우저에서 OpenAI로 직접 전송합니다. CORS로 막히면 Worker를 사용하세요.';
  credentialController.render();
}

function getActiveApiKey() {
  return credentialController.getActiveApiKey();
}

function updateStartButtonState() {
  renderTranslationRecovery();
  const hasFile = Boolean(state.file);
  const hasDuration = Number.isFinite(state.duration) && state.duration > 0;
  const activeApiKey = getActiveApiKey();
  const connectionMode = getConnectionMode();

  refs.startRequirement.textContent = getStartRequirement({
    hasFile,
    hasDuration,
    hasApiKey: Boolean(activeApiKey),
    connectionMode,
    proxyUrl: refs.proxyUrl.value,
  });

  refs.startButton.disabled = !canStartSubtitleJob({
    hasFile: hasFile && hasDuration,
    isBusy: state.isBusy,
    connectionMode,
    apiKey: activeApiKey,
    proxyUrl: refs.proxyUrl.value,
  });

  const preparation = getGeneratePreparationStatus({
    hasFile,
    hasDuration,
    hasApiKey: Boolean(String(activeApiKey ?? '').trim()),
    connectionMode,
    proxyUrl: refs.proxyUrl.value,
    sourceLanguage: refs.sourceLanguage.selectedOptions[0]?.textContent,
    translationEnabled: refs.translationEnabled.checked,
    targetLanguage: refs.targetLanguage.selectedOptions[0]?.textContent,
    isCustomTarget: refs.targetLanguage.value === 'custom',
    customTargetLanguage: refs.customTargetLanguage.value,
  });
  refs.generateFileStatus.textContent = preparation.file;
  refs.generateConnectionStatus.textContent = preparation.connection;
  refs.generateLanguageStatus.textContent = preparation.language;
  const next = state.isBusy
    ? { state: 'running', text: '자막 생성 진행 중 · 오른쪽 진행 상태에서 처리 과정을 확인하세요.' }
    : refs.statusBadge.dataset.state === 'failed'
      ? { state: 'error', text: '생성 또는 번역 오류 · 상단 오류와 저장된 원문을 확인한 뒤 다시 시도하세요.' }
      : !hasFile
        ? { state: 'empty', text: '다음 단계 · 영상 또는 오디오 파일을 선택하세요.' }
        : !hasDuration
          ? { state: 'blocked', text: '파일 길이 확인 필요 · 지원되는 파일인지 확인한 뒤 다시 선택하세요.' }
          : refs.startButton.disabled
            ? { state: 'blocked', text: '연결 정보 확인 필요 · 생성 전 확인에서 API 연결 및 언어 설정을 점검하세요.' }
            : { state: 'ready', text: '생성 준비 완료 · 자막 생성 시작을 누르면 진행 상태를 확인할 수 있습니다.' };
  refs.generateWorkflowStatus.dataset.state = next.state;
  if (refs.generateWorkflowStatus.textContent !== next.text) refs.generateWorkflowStatus.textContent = next.text;
}

function restoreConnectionSettings() {
  refs.proxyUrl.value = '';
}

function persistCurrentConnection() {
  // Connection settings and credentials stay in this page only.
}

async function handleSubtitleFileSelect() {
  if (state.isBusy) return;
  const [file] = refs.subtitleFileInput.files;
  if (!file) {
    return;
  }

  clearError();
  setBusy(true);

  try {
    const text = await file.text();
    const subtitles = parseSubtitleFileText(text, file.name);
    saveNewResult(subtitles, file.name);
    activateTab('edit');
  } catch (error) {
    refs.subtitleFileInput.value = '';
    showError(error?.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function selectFiles(files) {
  if (state.isBusy || files.length === 0) return;
  const entry = state.results.find((result) => result.id === state.activeResultId);
  if (files.length === 1 && entry && !entry.sourceFile && state.subtitles.length > 0) {
    await attachMediaToResult(files[0]);
    return;
  }
  setBusy(true);
  try {
  state.selectedFiles = files;
  await selectFile(files[0]);

  if (files.length > 1) {
    refs.fileMeta.textContent = `${files.length}개 파일 선택 · 첫 파일: ${files[0].name}`;
  }
  } finally {
    setBusy(false);
  }
}

async function attachMediaToResult(file) {
  if (state.isBusy) return;
  setBusy(true);
  try {
    state.selectedFiles = [file];
    await selectFile(file, { clearOutputs: false });
    const entry = state.results.find((result) => result.id === state.activeResultId);
    if (entry) {
      entry.sourceFile = file;
      entry.duration = state.duration;
      entry.fileSize = file.size;
    }
    syncSubtitleOutputs();
  } finally {
    refs.attachMediaFile.value = '';
    setBusy(false);
  }
}

async function selectFile(file, options = {}) {
  clearError();
  if (options.clearOutputs !== false) {
    clearOutputs();
  }
  state.file = file;
  state.duration = 0;
  updateStartButtonState();
  refs.fileMeta.textContent = `${file.name} · ${formatBytes(file.size)}`;

  if (state.fileUrl) {
    URL.revokeObjectURL(state.fileUrl);
  }

  state.fileUrl = URL.createObjectURL(file);
  refs.videoPreview.src = state.fileUrl;
  renderSubtitlePlayer();

  try {
    state.duration = await readVideoDuration(refs.videoPreview);
    refs.durationValue.textContent = secondsToClock(state.duration);
  } catch {
    refs.durationValue.textContent = '길이 확인 실패';
    showError('브라우저가 이 영상의 길이를 읽지 못했습니다. 모바일 갤러리 영상이면 MP4(H.264)로 저장하거나 다른 브라우저에서 다시 시도해 주세요.');
  }

  updateStartButtonState();
}

async function runPipeline() {
  if (state.isBusy) return;
  const files = state.selectedFiles.length > 0 ? [...state.selectedFiles] : state.file ? [state.file] : [];
  const settings = getSettings();
  const validationError = validateRun(settings);
  if (validationError) { showError(validationError); return; }
  clearError();
  refs.batchSummary.textContent = `${files.length}개 파일 처리 중`;
  const summary = await jobRunner.run(files, settings);
  refs.batchSummary.textContent = `${summary.cancelled ? '중단 · ' : ''}완료 ${summary.completed}개 · 실패 ${summary.failed}개 · 미처리 ${summary.pending}개`;
  setRunState(summary.cancelled ? 'cancelled' : summary.failed ? 'failed' : 'done');
  if (summary.cancelled) refs.progressText.textContent = '중단됨 · 완료된 결과는 작업 결과에서 확인하세요.';
  else if (summary.failed) refs.progressText.textContent = '작업 실패 · 오류를 확인한 뒤 다시 실행하세요.';
}

async function runPipelineForCurrentFile(batchInfo, settings, signal) {
  clearError();
  clearOutputs();
  resetStepStatuses();
  setRunState('running');
  if (batchInfo) {
    setProgress(1, `배치 ${batchInfo.batchIndex}/${batchInfo.batchCount} 준비 중 · ${state.file.name}`);
  }

  state.ffmpeg ??= new BrowserFfmpeg({
    onLog: appendLog,
  });

  setStep('load', 'active');
  const wasFfmpegLoaded = Boolean(state.ffmpeg.loaded);
  setStepProgress('load', wasFfmpegLoaded ? 100 : 10);
  setProgress(
    4,
    wasFfmpegLoaded
      ? 'ffmpeg.wasm 준비 완료 · 캐시된 런타임 사용'
      : 'ffmpeg.wasm 로드 중 · 최초 실행은 시간이 걸릴 수 있음',
  );
  await state.ffmpeg.load();
  if (!wasFfmpegLoaded) {
    setProgress(8, 'ffmpeg.wasm 로드 완료 · 오디오 처리 준비 중');
  }
  completeStep('load');
  signal.throwIfAborted();

  setStep('extract', 'active');
  setStepProgress('extract', 10);
  setProgress(12, 'ffmpeg 처리 중 · 영상에서 16kHz 오디오 추출');
  const inputName = await state.ffmpeg.writeInput(state.file);
  const audioName = await state.ffmpeg.extractAudio({
    inputName,
    bitrate: settings.audioBitrate,
  });
  completeStep('extract');
  signal.throwIfAborted();

  setStep('silence', 'active');
  setStepProgress('silence', 10);
  setProgress(24, 'ffmpeg 처리 중 · 무음 구간 분석');
  const silences = await state.ffmpeg.detectSilence({
    audioName,
    noiseDb: settings.noiseDb,
    silenceDuration: settings.silenceDuration,
  });
  completeStep('silence');
  signal.throwIfAborted();

  const textOnlyModel = settings.sttModel === 'gpt-transcribe';
  const chunks = buildChunkPlan({
    duration: state.duration,
    silences,
    targetSeconds: textOnlyModel ? 30 : settings.targetSeconds,
    minSeconds: textOnlyModel ? 20 : settings.minSeconds,
    maxSeconds: textOnlyModel ? 40 : settings.maxSeconds,
    searchRadiusSeconds: textOnlyModel ? 10 : settings.searchRadiusSeconds,
    paddingSeconds: settings.paddingSeconds,
  });

  renderChunks(chunks);
  setStep('split', 'active');
  setStepProgress('split', 0);
  setProgress(30, `${chunks.length}개 오디오 조각 준비 중`);

  const chunkAudios = [];
  let preparedChunks = 0;

  for await (const chunkAudio of state.ffmpeg.splitAudio({
    audioName,
    chunks,
    bitrate: settings.audioBitrate,
  })) {
    signal.throwIfAborted();
    chunkAudios.push(chunkAudio);
    preparedChunks += 1;
    markChunk(chunkAudio.index, '전사 대기');
    setStepProgress('split', (preparedChunks / Math.max(chunks.length, 1)) * 100);
    setProgress(
      30 + (preparedChunks / Math.max(chunks.length, 1)) * 5,
      `오디오 조각 준비 중 ${preparedChunks}/${chunks.length}`,
    );
  }

  completeStep('split');
  signal.throwIfAborted();

  const chunkSubtitleGroups = [];
  let completedChunks = 0;
  const activeConcurrency = Math.min(TRANSCRIPTION_CONCURRENCY, Math.max(chunkAudios.length, 1));

  setStep('transcribe', 'active');
  setStepProgress('transcribe', 0);
  setProgress(35, `음성 인식 준비 중 · 동시 ${activeConcurrency}개까지 처리`);

  await mapWithConcurrency(chunkAudios, TRANSCRIPTION_CONCURRENCY, async (chunkAudio, index, taskSignal) => {
    signal.throwIfAborted();
    markChunk(chunkAudio.index, '음성 인식 중');

    const transcription = await requestTranscription({
      audioBlob: chunkAudio.audioBlob,
      fileName: chunkAudio.fileName,
      settings,
      signal: taskSignal,
    });
    taskSignal.throwIfAborted();

    const localSegments = normalizeTranscriptionSegments(
      transcription,
      chunkAudio.extractEnd - chunkAudio.extractStart,
      {
        maxTextLength: settings.maxSubtitleChars,
        maxDuration: settings.maxSubtitleSeconds,
        maxCps: settings.maxSubtitleCps,
      },
    );
    const chunkSubtitleGroup = {
      fileName: chunkAudio.fileName,
      startTime: chunkAudio.startTime,
      coreStartTime: chunkAudio.coreStartTime,
      coreEndTime: chunkAudio.coreEndTime,
      subtitles: localSegments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        original: segment.original ?? segment.text ?? '',
        translated: '',
        ...(segment.speaker ? { speaker: segment.speaker, speakerScope: chunkAudio.index } : {}),
        ...(textOnlyModel && !transcription?.words?.length && !transcription?.segments?.length ? { timingAccuracy: 'estimated' } : {}),
      })),
    };
    chunkSubtitleGroups.push(chunkSubtitleGroup);
    const mergedChunkSubtitles = mergeSubtitles([chunkSubtitleGroup]);
    completedChunks += 1;
    markChunk(chunkAudio.index, `${mergedChunkSubtitles.length}개 세그먼트`);
    renderPreview(sortSubtitles(mergeSubtitles(chunkSubtitleGroups)));
    setStepProgress('transcribe', (completedChunks / Math.max(chunks.length, 1)) * 100);
    setProgress(
      35 + (completedChunks / Math.max(chunks.length, 1)) * 42,
      `음성 인식 중 ${completedChunks}/${chunks.length} · 동시 ${activeConcurrency}개`,
    );
    return chunkSubtitleGroup;
  }, { signal });

  completeStep('transcribe');
  signal.throwIfAborted();

  let finalSubtitles = mergeSubtitles(chunkSubtitleGroups, { maxTextLength: Number.MAX_SAFE_INTEGER });

  if (settings.translationEnabled) {
    const checkpoint = saveNewResult(finalSubtitles, state.file.name, {
      translationPending: true,
      outputLanguage: settings.sourceLanguage || 'original',
      translationSettings: { targetLanguage: settings.targetLanguage, maxSubtitleChars: settings.maxSubtitleChars },
    });
    state.pipelineResultId = checkpoint.id;
    setStep('translate', 'active');
    setStepProgress('translate', 0);
    finalSubtitles = await translateSubtitles({
      subtitles: finalSubtitles,
      settings,
      signal,
      onProgress: ({ batchIndex, batchCount }) => {
        setStepProgress('translate', (batchIndex / Math.max(batchCount, 1)) * 100);
        setProgress(80 + (batchIndex / Math.max(batchCount, 1)) * 14, `번역 중 ${batchIndex}/${batchCount}`);
      },
    });
    completeStep('translate');
  } else {
    finalSubtitles = finalSubtitles.map((subtitle) => ({
      ...subtitle,
      translated: subtitle.original,
      status: 'skipped',
    }));
    setStep('translate', 'done');
  }

  finalSubtitles = splitLongSubtitles(finalSubtitles, settings.maxSubtitleChars);

  setStep('output', 'active');
  setStepProgress('output', 50);
  setProgress(96, '자막 파일 정리 중');
  completeStep('output');
  completeStep('done');
  setProgress(100, batchInfo ? `배치 ${batchInfo.batchIndex}/${batchInfo.batchCount} 완료` : '완료', 'done');
  return sortSubtitles(finalSubtitles);
}

function getSettings() {
  persistCurrentConnection();
  const connectionMode = getConnectionMode();

  return {
    connectionMode,
    apiKey: getActiveApiKey(),
    proxyUrl: connectionMode === 'worker' ? refs.proxyUrl.value.trim() : '',
    apiBaseUrl: OPENAI_DEFAULTS.apiBaseUrl,
    sourceLanguage: refs.sourceLanguage.value,
    targetLanguage: refs.targetLanguage.value === 'custom'
      ? refs.customTargetLanguage.value.trim() || 'ko'
      : refs.targetLanguage.value,
    sttModel: refs.sttModel.value.trim() || OPENAI_DEFAULTS.sttModel,
    translationModel: refs.translationModel.value.trim() || OPENAI_DEFAULTS.translationModel,
    translationBatchSize: 30,
    noiseDb: Number(refs.noiseDb.value || -35),
    silenceDuration: Number(refs.silenceDuration.value || 0.6),
    targetSeconds: Number(refs.targetMinutes.value || 7) * 60,
    minSeconds: Number(refs.minMinutes.value || 3) * 60,
    maxSeconds: Number(refs.maxMinutes.value || 15) * 60,
    searchRadiusSeconds: Number(refs.searchMinutes.value || 4) * 60,
    paddingSeconds: Number(refs.paddingSeconds.value || 0.5),
    maxSubtitleChars: Number(refs.maxSubtitleChars.value || 42),
    maxSubtitleSeconds: Number(refs.maxSubtitleSeconds.value || 4.5),
    maxSubtitleCps: Number(refs.maxSubtitleCps.value || 18),
    audioBitrate: refs.audioBitrate.value,
    translationEnabled: refs.translationEnabled.checked,
  };
}

function saveNewResult(subtitles, fileName, options = {}) {
  const entry = createJobHistoryEntry({
    fileName, fileSize: state.file?.size, duration: state.duration, subtitles,
  });
  entry.id = String(state.nextResultId++);
  entry.sourceFile = state.file;
  entry.editHistory = createEditHistory(entry.subtitles);
  entry.offsetSeconds = 0;
  entry.outputLanguage = options.outputLanguage || 'original';
  entry.translationPending = options.translationPending || false;
  entry.translationSettings = options.translationSettings;
  state.results.push(entry);
  state.activeResultId = entry.id;
  state.outputFileName = fileName;
  state.editHistory = entry.editHistory;
  state.subtitles = state.editHistory.present;
  state.editorSelectedCueIndex = -1;
  setPlayerSubtitles(state.subtitles, `${fileName} · ${state.subtitles.length}개`, { resetOffset: true });
  syncSubtitleOutputs();
  return entry;
}

function finishTranslation(entry, subtitles, preserveHistory = true) {
  entry.translationPending = getTranslationFailures(subtitles).length > 0;
  entry.outputLanguage = entry.translationSettings?.targetLanguage || 'original';
  state.editHistory = preserveHistory
    ? commitEdit(state.editHistory, sortSubtitles(subtitles))
    : createEditHistory(sortSubtitles(subtitles));
  state.subtitles = state.editHistory.present;
  syncSubtitleOutputs();
}

function renderTranslationRecovery() {
  const entry = state.results.find((result) => result.id === state.activeResultId);
  refs.translationRecovery.hidden = !entry?.translationPending;
  if (!entry?.translationPending) return;
  refs.translationRecoveryText.textContent = `원문 자막을 보존했습니다. 지금 다운로드하거나 ${entry.translationSettings.targetLanguage} 번역만 다시 시도할 수 있습니다. 새로고침하면 작업 결과가 사라지므로 먼저 다운로드해 주세요.`;
  refs.retryTranslationButton.disabled = !canStartSubtitleJob({
    hasFile: true, isBusy: state.isBusy, connectionMode: getConnectionMode(),
    apiKey: getActiveApiKey(), proxyUrl: refs.proxyUrl.value,
  });
}

async function retryTranslation() {
  const entry = state.results.find((result) => result.id === state.activeResultId);
  if (state.isBusy || !entry?.translationPending || refs.retryTranslationButton.disabled) return;
  const settings = { ...getSettings(), ...entry.translationSettings };
  const controller = new AbortController();
  state.retryController = controller;
  clearError();
  setBusy(true);
  setProgress(0, '저장된 원문 번역 중');
  try {
    const translated = await translateSubtitles({
      subtitles: state.subtitles, settings, signal: controller.signal,
      onProgress: ({ batchIndex, batchCount }) => setProgress(100 * batchIndex / Math.max(1, batchCount), `번역 중 ${batchIndex}/${batchCount}`),
    });
    controller.signal.throwIfAborted();
    finishTranslation(entry, splitLongSubtitles(translated, settings.maxSubtitleChars));
    setProgress(100, entry.translationPending ? '일부 번역 실패 · 원문 보존' : '번역 완료', entry.translationPending ? 'failed' : 'done');
  } catch (error) {
    const cancelled = controller.signal.aborted;
    setProgress(0, cancelled ? '번역 중단 · 원문 보존' : '번역 실패 · 원문 보존', cancelled ? 'cancelled' : 'failed');
    if (!cancelled) showError(formatRunError(error));
  } finally {
    state.retryController = null;
    setBusy(false);
  }
}

function saveCurrentResult() {
  const entry = state.results.find((result) => result.id === state.activeResultId);
  if (!entry) return;
  entry.subtitles = state.subtitles.map((subtitle) => ({ ...subtitle }));
  entry.subtitleCount = entry.subtitles.length;
  entry.editHistory = state.editHistory;
  entry.offsetSeconds = state.subtitleOffsetSeconds;
}

function renderResultSelector() {
  refs.jobResults.hidden = state.results.length === 0;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '확인할 결과 선택';
  placeholder.disabled = true;
  const options = state.results.map((entry, index) => {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = `${index + 1}. ${entry.fileName} · 자막 ${entry.subtitleCount}개${entry.translationPending ? ' · 번역 대기' : ''}`;
    return option;
  });
  refs.jobResultSelect.replaceChildren(placeholder, ...options);
  const exportPlaceholder = placeholder.cloneNode(true);
  exportPlaceholder.textContent = '선택할 작업 없음';
  refs.exportResultSelect.replaceChildren(exportPlaceholder, ...options.map((option) => option.cloneNode(true)));
  refs.jobResultSelect.value = state.activeResultId ?? '';
  refs.exportResultSelect.value = state.activeResultId ?? '';
  refs.jobResultSelect.disabled = state.isBusy;
  refs.exportResultSelect.disabled = state.isBusy || state.results.length === 0;
}

async function restoreResult(id) {
  if (state.isBusy) return;
  const entry = state.results.find((result) => result.id === id);
  if (!entry) return;
  saveCurrentResult();
  setBusy(true);
  try {
    clearError();
    clearOutputs();
    state.file = entry.sourceFile;
    state.selectedFiles = entry.sourceFile ? [entry.sourceFile] : [];
    state.duration = entry.duration;
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = entry.sourceFile ? URL.createObjectURL(entry.sourceFile) : null;
    if (state.fileUrl) refs.videoPreview.src = state.fileUrl;
    else { refs.videoPreview.removeAttribute('src'); refs.videoPreview.load(); }
    refs.fileMeta.textContent = entry.sourceFile
      ? `${entry.sourceFile.name} · ${formatBytes(entry.sourceFile.size)}`
      : '자막 파일 · 영상 또는 오디오를 선택해 미리 볼 수 있습니다.';
    refs.durationValue.textContent = secondsToClock(state.duration);
    state.activeResultId = entry.id;
    state.outputFileName = entry.fileName;
    state.editHistory = entry.editHistory;
    state.subtitles = state.editHistory.present;
    state.editorSelectedCueIndex = -1;
    state.subtitleOffsetSeconds = entry.offsetSeconds;
    setPlayerSubtitles(state.subtitles, `${entry.fileName} · ${entry.subtitleCount}개`);
    syncSubtitleOutputs();
    setProgress(100, '저장된 작업 결과', 'done');
  } finally {
    setBusy(false);
  }
}

function applyEdit(subtitles) {
  if (state.isBusy) return;
  state.editHistory = commitEdit(state.editHistory, sortSubtitles(subtitles));
  state.subtitles = state.editHistory.present;
  syncSubtitleOutputs();
}

function restoreEdit(direction) {
  if (state.isBusy) return;
  state.editHistory = direction === 'undo' ? undoEdit(state.editHistory) : redoEdit(state.editHistory);
  state.subtitles = state.editHistory.present;
  syncSubtitleOutputs();
}

function updateEditControls() {
  refs.undoEdit.disabled = state.isBusy || state.editHistory.past.length === 0;
  refs.redoEdit.disabled = state.isBusy || state.editHistory.future.length === 0;
  refs.editHistoryStatus.textContent = state.editHistory.past.length || state.editHistory.future.length
    ? `실행 취소 ${state.editHistory.past.length}단계 · 다시 실행 ${state.editHistory.future.length}단계`
    : '편집 이력이 없습니다.';
  [refs.applyGlobalOffset, refs.mergeShortSubtitles].forEach((button) => {
    button.disabled = state.isBusy || state.subtitles.length === 0;
  });
  refs.editorBody.querySelectorAll('input, textarea, button').forEach((control) => {
    control.disabled = state.isBusy;
  });
  updateEditorCueNavigation();
}

function updateTranslationControls() {
  refs.targetLanguage.disabled = state.isBusy || !refs.translationEnabled.checked;
  refs.customTargetLanguageField.hidden = refs.targetLanguage.value !== 'custom';
  refs.customTargetLanguage.disabled = refs.targetLanguage.disabled;
}

function validateRun(settings) {
  const startRequirement = getStartRequirement({
    hasFile: Boolean(state.file),
    hasDuration: Number.isFinite(state.duration) && state.duration > 0,
    hasApiKey: Boolean(settings.apiKey),
    connectionMode: settings.connectionMode,
    proxyUrl: settings.proxyUrl,
  });
  if (startRequirement) {
    return startRequirement;
  }

  if (settings.minSeconds >= settings.maxSeconds) {
    return '최소 분할 시간은 최대 분할 시간보다 작아야 합니다.';
  }

  return '';
}

function renderSteps() {
  refs.stepList.replaceChildren(
    ...STEPS.map(([id, label]) => {
      const item = document.createElement('li');
      item.dataset.step = id;
      item.dataset.status = 'idle';
      item.dataset.progress = '0';

      const labelText = document.createElement('span');
      labelText.className = 'step-label';
      labelText.textContent = label;
      item.append(labelText);

      if (id !== 'done') {
        const percent = document.createElement('span');
        percent.className = 'step-percent';
        percent.textContent = '0%';
        item.append(percent);
      }

      return item;
    }),
  );
}

function setStep(id, status) {
  const item = refs.stepList.querySelector(`[data-step="${id}"]`);
  if (item) {
    item.dataset.status = status;
    if (status === 'done') {
      setStepProgress(id, 100);
    }
  }
}

function completeStep(id) {
  setStep(id, 'done');
}

function setStepProgress(id, percent) {
  const item = refs.stepList.querySelector(`[data-step="${id}"]`);
  const percentNode = item?.querySelector('.step-percent');
  if (!item || !percentNode) {
    return;
  }

  const value = Math.round(Math.max(0, Math.min(100, Number(percent) || 0)));
  item.dataset.progress = String(value);
  percentNode.textContent = `${value}%`;
}

function resetStepStatuses() {
  refs.stepList.querySelectorAll('li').forEach((item) => {
    item.dataset.status = 'idle';
    setStepProgress(item.dataset.step, 0);
  });
}

function syncVideoDurationFromPreview() {
  const duration = refs.videoPreview.duration;
  if (!state.file || !Number.isFinite(duration) || duration <= 0) {
    return false;
  }

  state.duration = duration;
  refs.durationValue.textContent = secondsToClock(duration);
  clearError();
  updateStartButtonState();
  return true;
}

function markActiveStepFailed() {
  const active = refs.stepList.querySelector('[data-status="active"]');
  if (active) {
    active.dataset.status = 'failed';
  }
}

function renderChunks(chunks) {
  refs.chunkSummary.textContent = `${chunks.length}개`;
  if (refs.chunksList.parentElement) {
    refs.chunksList.parentElement.open = false;
  }

  refs.chunksList.replaceChildren(
    ...chunks.map((chunk) => {
      const item = document.createElement('div');
      item.className = 'chunk-item';
      item.dataset.chunk = String(chunk.index);

      const title = document.createElement('strong');
      title.textContent = `${chunk.index + 1}. ${secondsToClock(chunk.start)} - ${secondsToClock(chunk.end)}`;

      const meta = document.createElement('span');
      meta.textContent = `${chunk.cutReason === 'silence' ? '무음 기준' : chunk.cutReason === 'forced' ? '강제 분할' : '마지막 조각'} · 대기`;

      item.append(title, meta);
      return item;
    }),
  );
}

function markChunk(index, text) {
  const item = refs.chunksList.querySelector(`[data-chunk="${index}"] span`);
  if (item) {
    item.textContent = text;
  }
}

function renderPreview(subtitles) {
  const visible = visibleSubtitlePreview(subtitles);
  refs.subtitleCount.textContent = `${subtitles.length}개`;
  refs.previewLimit.textContent = previewLimitLabel(subtitles.length);

  if (visible.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.className = 'empty-cell';
    cell.colSpan = 3;
    cell.textContent = '생성된 자막이 없습니다.';
    row.append(cell);
    refs.previewBody.replaceChildren(row);
    return;
  }

  refs.previewBody.replaceChildren(
    ...visible.map((subtitle) => {
      const row = document.createElement('tr');
      const time = document.createElement('td');
      const original = document.createElement('td');
      const translated = document.createElement('td');

      time.textContent = `${formatTimestamp(subtitle.start, ',')} - ${formatTimestamp(subtitle.end, ',')}`;
      original.textContent = `${subtitle.speaker ? `[${subtitle.speaker}] ` : ''}${subtitle.original}`;
      translated.textContent = subtitle.translated || '';

      row.append(time, original, translated);
      return row;
    }),
  );
}

function updateEditorWorkspaceStatus() {
  const total = state.subtitles.length;
  const visible = state.editorVisibleCueIndices.length;
  const next = !total
    ? { state: 'empty', text: '편집할 자막이 없습니다. 자막 파일을 불러오거나 생성 탭에서 만들어 주세요.' }
    : !visible
      ? { state: 'filtered', text: '검색·필터에 맞는 자막이 없습니다. 검색어 또는 필터를 변경해 주세요. 원본 자막은 유지됩니다.' }
      : { state: 'ready', text: `검수 자막 ${visible} / ${total}개 · ${state.file
          ? '영상·오디오 연결됨 · 선택한 자막과 재생 시점을 대조할 수 있습니다.'
          : '영상 미연결 · 자막 텍스트와 시간을 편집할 수 있습니다.'}` };
  refs.editorWorkspaceStatus.dataset.state = next.state;
  if (refs.editorWorkspaceStatus.textContent !== next.text) refs.editorWorkspaceStatus.textContent = next.text;
}

function renderEditor() {
  const expandedCues = new Set(
    [...refs.editorBody.querySelectorAll('details.cue-more[open]')]
      .map((details) => details.closest('[data-cue-index]').dataset.cueIndex),
  );
  const focusedControl = refs.editorBody.contains(document.activeElement) ? document.activeElement : null;
  const focusedData = focusedControl ? { ...focusedControl.dataset } : null;
  const filtered = filterSubtitles(state.subtitles, {
    query: state.editorQuery,
    status: state.editorStatus,
    maxTextLength: Number(refs.maxSubtitleChars.value || 42),
    maxDuration: Number(refs.maxSubtitleSeconds.value || 4.5),
    maxCps: Number(refs.maxSubtitleCps.value || 18),
  });
  refs.editorCount.textContent =
    filtered.length === state.subtitles.length
      ? `${state.subtitles.length}개`
      : `${filtered.length}/${state.subtitles.length}개`;

  const sorted = sortSubtitles(state.subtitles);
  state.editorVisibleCueIndices = filtered.map((subtitle) => sorted.indexOf(subtitle));
  if (!state.editorVisibleCueIndices.includes(state.editorSelectedCueIndex)) {
    state.editorSelectedCueIndex = state.editorVisibleCueIndices[0] ?? -1;
  }
  updateEditorWorkspaceStatus();

  if (filtered.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.className = 'empty-cell';
    cell.colSpan = 4;
    cell.textContent = state.subtitles.length === 0 ? '편집할 자막이 없습니다.' : '필터에 맞는 자막이 없습니다.';
    row.append(cell);
    refs.editorBody.replaceChildren(row);
    renderEditorCueContext();
    return;
  }

  refs.editorBody.replaceChildren(
    ...filtered.map((subtitle) => {
      const index = sorted.indexOf(subtitle);
      const row = document.createElement('tr');
      row.dataset.cueIndex = String(index);
      row.setAttribute('aria-label', `${index + 1}번 자막`);
      if (index === state.editorSelectedCueIndex) row.classList.add('is-selected-cue');
      const time = document.createElement('td');
      const original = document.createElement('td');
      const translated = document.createElement('td');
      const sync = document.createElement('td');

      if (index === state.activeSubtitleIndex) {
        row.classList.add('is-active-cue');
      }

      const metrics = getSubtitleEditMetrics(subtitle, {
        maxTextLength: Number(refs.maxSubtitleChars.value || 42),
        maxDuration: Number(refs.maxSubtitleSeconds.value || 4.5),
        maxCps: Number(refs.maxSubtitleCps.value || 18),
      });
      time.append(
        createTimeInput(index, 'start', subtitle.start),
        createTimeInput(index, 'end', subtitle.end),
        createCueWarnings(metrics),
      );
      const speakerLabel = document.createElement('label');
      speakerLabel.className = 'time-edit-group';
      speakerLabel.textContent = '화자';
      const speakerInput = document.createElement('input');
      speakerInput.type = 'text';
      speakerInput.maxLength = 32;
      speakerInput.placeholder = '미지정';
      speakerInput.value = subtitle.speaker || '';
      speakerInput.dataset.editIndex = String(index);
      speakerInput.dataset.speakerEdit = 'true';
      speakerInput.setAttribute('aria-label', `${index + 1}번 자막 화자`);
      speakerLabel.append(speakerInput);
      time.append(speakerLabel);
      if (subtitle.timingAccuracy === 'estimated') {
        const note = document.createElement('small');
        note.textContent = '시간 추정 · 실제 영상과 확인 필요';
        time.append(note);
      }

      const originalInput = createSubtitleTextarea(index, 'original', subtitle.original);
      const translatedInput = createSubtitleTextarea(index, 'translated', subtitle.translated);
      const originalLabel = document.createElement('label');
      originalLabel.className = 'cue-text-field';
      originalLabel.textContent = '원문';
      originalLabel.append(originalInput);
      const translatedLabel = document.createElement('label');
      translatedLabel.className = 'cue-text-field';
      translatedLabel.textContent = '번역';
      translatedLabel.append(translatedInput);
      original.append(originalLabel);
      translated.append(translatedLabel);

      if (subtitle.status === 'failed') {
        const token = document.createElement('span');
        token.className = `status-token ${subtitle.status}`;
        token.textContent = subtitle.status === 'failed' ? '번역 실패' : subtitle.status;
        translated.append(token);
      }

      sync.className = 'sync-cell';
      const actionGroup = document.createElement('div');
      actionGroup.className = 'cue-actions';
      actionGroup.append(
        createEditorActionButton(index, 'seek', '이동'),
        createEditorActionButton(index, 'split', '분할'),
      );
      const more = document.createElement('details');
      more.className = 'cue-more';
      more.open = expandedCues.has(String(index));
      const summary = document.createElement('summary');
      summary.textContent = '병합·싱크 조절';
      summary.setAttribute('aria-label', `${index + 1}번 자막 병합·싱크 조절`);
      const extraActions = document.createElement('div');
      extraActions.className = 'cue-extra-actions';
      extraActions.append(
        createEditorActionButton(index, 'merge-prev', '이전 병합'),
        createEditorActionButton(index, 'merge-next', '다음 병합'),
      );
      const shiftGroup = document.createElement('div');
      shiftGroup.className = 'cue-shifts';
      shiftGroup.append(
        createShiftButton(index, -0.1, '-0.1초'),
        createShiftButton(index, 0.1, '+0.1초'),
        createShiftButton(index, -0.5, '-0.5초'),
        createShiftButton(index, 0.5, '+0.5초'),
      );
      more.append(summary, extraActions, shiftGroup);
      sync.append(actionGroup, more);

      row.append(time, original, translated, sync);
      return row;
    }),
  );
  if (focusedData && Object.keys(focusedData).length > 0) {
    const replacement = [...refs.editorBody.querySelectorAll('input, textarea, button')].find((element) =>
      Object.entries(focusedData).every(([key, value]) => element.dataset[key] === value),
    );
    replacement?.focus({ preventScroll: true });
  }
  renderEditorCueContext();
}

function updateEditorCueNavigation() {
  const position = state.editorVisibleCueIndices.indexOf(state.editorSelectedCueIndex);
  refs.editorPrevCue.disabled = state.isBusy || position <= 0;
  refs.editorNextCue.disabled = state.isBusy || position < 0 || position >= state.editorVisibleCueIndices.length - 1;
  refs.editorFocusCue.disabled = state.isBusy || position < 0;
}

function renderEditorCueContext() {
  const cue = sortSubtitles(state.subtitles)[state.editorSelectedCueIndex];
  if (!cue || !state.editorVisibleCueIndices.includes(state.editorSelectedCueIndex)) {
    refs.editorCueContext.hidden = true;
    updateEditorCueNavigation();
    return;
  }
  refs.editorCueContext.hidden = false;
  refs.editorCuePosition.textContent = `자막 ${state.editorSelectedCueIndex + 1} / ${state.subtitles.length}개 · 필터 표시 ${state.editorVisibleCueIndices.length}개`;
  refs.editorCueTiming.textContent = `${formatTimestamp(cue.start)} – ${formatTimestamp(cue.end)}`;
  refs.editorCueSpeaker.textContent = cue.speaker || '미지정';
  refs.editorCueOriginal.textContent = cue.original || '원문 없음';
  refs.editorCueTranslated.textContent = cue.translated || (cue.status === 'failed' ? '번역 실패 · 원문 보존' : '번역 없음');
  refs.editorBody.querySelectorAll('[data-cue-index]').forEach((row) => {
    row.classList.toggle('is-selected-cue', Number(row.dataset.cueIndex) === state.editorSelectedCueIndex);
  });
  updateEditorCueNavigation();
}

function selectEditorCue(index) {
  if (state.isBusy || !state.editorVisibleCueIndices.includes(index)) return;
  state.editorSelectedCueIndex = index;
  renderEditorCueContext();
}

function moveEditorCueSelection(direction) {
  if (state.isBusy) return;
  const position = state.editorVisibleCueIndices.indexOf(state.editorSelectedCueIndex);
  const next = state.editorVisibleCueIndices[position + direction];
  if (position < 0 || next === undefined) return;
  selectEditorCue(next);
}

function focusSelectedEditorCue() {
  if (state.isBusy) return;
  const row = refs.editorBody.querySelector(`[data-cue-index="${state.editorSelectedCueIndex}"]`);
  const textarea = row?.querySelector('[data-edit-field="original"]');
  if (!textarea) return;
  textarea.scrollIntoView({ block: 'center', behavior: 'auto' });
  textarea.focus({ preventScroll: true });
}

function createSubtitleTextarea(index, field, value) {
  const textarea = document.createElement('textarea');
  textarea.className = 'subtitle-textarea';
  textarea.dataset.editIndex = String(index);
  textarea.dataset.editField = field;
  textarea.value = value ?? '';
  textarea.setAttribute('aria-label', `${index + 1}번 자막 ${field === 'original' ? '원문' : '번역'}`);
  return textarea;
}

function createTimeInput(index, field, value) {
  const label = document.createElement('label');
  label.className = 'time-edit-group';
  label.textContent = field === 'start' ? '시작' : '끝';

  const input = document.createElement('input');
  input.className = 'subtitle-time-input';
  input.type = 'number';
  input.min = '0';
  input.step = '0.001';
  input.dataset.editIndex = String(index);
  input.dataset.timeField = field;
  input.value = String(Number(value ?? 0));
  input.setAttribute('aria-label', `${index + 1}번 자막 ${field === 'start' ? '시작' : '끝'} 시간 (초)`);
  label.append(input);
  return label;
}

function createCueWarnings(metrics) {
  const wrap = document.createElement('div');
  wrap.className = 'cue-warnings';
  const labels = {
    'long-text': `길이 ${metrics.length}자`,
    'long-duration': `${metrics.duration.toFixed(1)}초`,
    'high-cps': `CPS ${metrics.cps.toFixed(1)}`,
  };

  metrics.warnings.forEach((warning) => {
    const token = document.createElement('span');
    token.className = 'cue-warning';
    token.textContent = labels[warning] ?? warning;
    wrap.append(token);
  });

  return wrap;
}

function createEditorActionButton(index, action, label) {
  const button = document.createElement('button');
  button.className = 'ghost-button';
  button.type = 'button';
  button.dataset.editorAction = action;
  button.dataset.editIndex = String(index);
  button.textContent = label;
  return button;
}

function createShiftButton(index, delta, label) {
  const button = document.createElement('button');
  button.className = 'ghost-button';
  button.type = 'button';
  button.dataset.shiftIndex = String(index);
  button.dataset.shiftDelta = String(delta);
  button.textContent = label;
  return button;
}

function handleEditorAction(button) {
  if (state.isBusy) return;
  const index = Number(button.dataset.editIndex);
  if (!Number.isInteger(index)) {
    return;
  }

  if (button.dataset.editorAction === 'seek') {
    const subtitle = sortSubtitles(state.subtitles)[index];
    if (subtitle) {
      refs.videoPreview.currentTime = Math.max(0, Number(subtitle.start || 0) + state.subtitleOffsetSeconds);
      renderSubtitlePlayer();
    }
    return;
  }

  if (button.dataset.editorAction === 'split') {
    state.subtitles = splitSubtitleAt(state.subtitles, index);
  } else if (button.dataset.editorAction === 'merge-prev') {
    state.subtitles = mergeSubtitleWithNext(state.subtitles, index - 1);
  } else if (button.dataset.editorAction === 'merge-next') {
    state.subtitles = mergeSubtitleWithNext(state.subtitles, index);
  } else {
    return;
  }

  applyEdit(state.subtitles);
}

function applyGlobalSubtitleOffset() {
  if (state.isBusy) return;
  const delta = Number(refs.editorGlobalOffset.value);
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.001 || state.subtitles.length === 0) {
    return;
  }

  state.subtitles = shiftSubtitles(state.subtitles, delta);
  refs.editorGlobalOffset.value = '0';
  applyEdit(state.subtitles);
}

function syncSubtitleOutputs() {
  state.subtitles = sortSubtitles(state.subtitles);
  state.playerSubtitles = sortSubtitles(state.subtitles);
  renderPreview(state.subtitles);
  renderEditor();
  renderSubtitlePlayer();
  refreshDownloadsForCurrentOffset();
  saveCurrentResult();
  renderResultSelector();
  updateEditControls();
  renderTranslationRecovery();
}

function setPlayerSubtitles(subtitles, label, options = {}) {
  if (options.resetOffset) {
    state.subtitleOffsetSeconds = 0;
  }

  state.playerSubtitles = sortSubtitles(subtitles);
  refs.subtitleFileMeta.textContent = label;
  renderSubtitlePlayer();
  refreshDownloadsForCurrentOffset();
}

function clearPlayerSubtitles() {
  state.playerSubtitles = [];
  state.subtitleOffsetSeconds = 0;
  refs.subtitleFileInput.value = '';
  refs.subtitleFileMeta.textContent = 'SRT, VTT, JSON 자막 파일을 다시 불러올 수 있습니다.';
  renderSubtitlePlayer();
}

function adjustSubtitleSync(deltaSeconds) {
  const nextOffset = state.subtitleOffsetSeconds + (Number(deltaSeconds) || 0);
  state.subtitleOffsetSeconds = Math.round(nextOffset * 10) / 10;
  renderSubtitlePlayer();
  refreshDownloadsForCurrentOffset();
}

function resetSubtitleSync() {
  state.subtitleOffsetSeconds = 0;
  renderSubtitlePlayer();
  refreshDownloadsForCurrentOffset();
}

function renderSubtitlePlayer() {
  updateEditorWorkspaceStatus();
  const hasMedia = Boolean(state.file);
  refs.videoPreview.hidden = !hasMedia;
  refs.subtitlePanel.hidden = !hasMedia || state.playerSubtitles.length === 0;
  refs.mediaEmptyState.hidden = hasMedia;
  refs.mediaEmptyState.textContent = state.playerSubtitles.length > 0
    ? '자막을 확인할 영상이나 오디오를 생성 탭에서 선택해 주세요.'
    : '영상이나 오디오를 선택하면 이곳에서 미리 볼 수 있습니다.';
  refs.subtitleOffsetValue.textContent = `${state.subtitleOffsetSeconds.toFixed(1)}초`;

  const activeSubtitle = findActiveSubtitle(
    state.playerSubtitles,
    refs.videoPreview.currentTime || 0,
    state.subtitleOffsetSeconds,
  );
  const nextActiveIndex = activeSubtitle ? state.playerSubtitles.indexOf(activeSubtitle) : -1;
  if (nextActiveIndex !== state.activeSubtitleIndex) {
    state.activeSubtitleIndex = nextActiveIndex;
    refs.editorBody.querySelectorAll('[data-cue-index]').forEach((row) => {
      row.classList.toggle('is-active-cue', Number(row.dataset.cueIndex) === nextActiveIndex);
    });
  }
  const mode = refs.subtitleDisplayMode.value;
  const { primary, secondary } = formatSubtitleForMode(activeSubtitle, mode);

  if (primary) {
    refs.subtitlePanel.dataset.active = 'true';
    refs.subtitlePrimary.textContent = primary;
    refs.subtitleSecondary.textContent = secondary;
    refs.subtitleSecondary.hidden = !secondary;
    return;
  }

  refs.subtitlePanel.dataset.active = 'false';
  refs.subtitlePrimary.textContent =
    state.playerSubtitles.length > 0
      ? '현재 시간에 표시할 자막이 없습니다.'
      : '자막 파일을 선택하거나 자막을 생성하면 여기에 표시됩니다.';
  refs.subtitleSecondary.textContent = '';
  refs.subtitleSecondary.hidden = true;
}

function renderExportOverview() {
  const entry = state.results.find((item) => item.id === state.activeResultId);
  const summary = getExportSummary({
    fileName: entry?.fileName || state.outputFileName,
    subtitleCount: state.subtitles.length,
    failedCount: getTranslationFailures(state.subtitles).length,
    translationPending: Boolean(entry?.translationPending),
    language: entry?.outputLanguage,
    offsetSeconds: state.subtitleOffsetSeconds,
  });
  refs.exportFileName.textContent = summary.fileName;
  refs.exportResultStatus.textContent = summary.status.label;
  refs.exportResultStatus.dataset.state = summary.status.state;
  refs.exportLanguage.textContent = summary.language;
  refs.exportSyncSummary.textContent = summary.sync;
  if (!refs.exportBuildError.hidden) {
    refs.exportResultStatus.textContent = '파일 준비 오류 · 재시도 필요';
    refs.exportResultStatus.dataset.state = 'error';
  }
  const next = !refs.exportBuildError.hidden
    ? { state: 'error', text: '파일 준비 오류 · 기존 자막과 편집 내용은 유지됩니다. 파일 다시 준비를 선택하세요.' }
    : !state.subtitles.length
      ? { state: 'empty', text: '내려받을 자막이 없습니다. 기존 자막을 불러오거나 생성 탭에서 작업하세요.' }
      : entry?.translationPending
        ? { state: 'partial', text: '부분 번역 결과 · 현재 페이지에 남아 있는 원문으로 SRT·VTT·JSON을 내려받을 수 있습니다.' }
        : getTranslationFailures(state.subtitles).length
          ? { state: 'partial', text: '번역 오류가 포함되어 있습니다. 원문 자막을 확인한 뒤 파일을 내려받으세요.' }
          : { state: 'ready', text: '자막 파일 준비 완료 · SRT를 먼저 권장합니다. 실제 저장 여부는 브라우저 다운로드 내역에서 확인하세요.' };
  refs.exportWorkflowStatus.dataset.state = next.state;
  if (refs.exportWorkflowStatus.textContent !== next.text) refs.exportWorkflowStatus.textContent = next.text;
}

function renderDownloads(subtitles) {
  state.downloadUrls.forEach((url) => URL.revokeObjectURL(url));
  state.downloadUrls = [];
  refs.exportBuildError.hidden = true;
  refs.exportDownloadStatus.textContent = '';
  refs.exportDownloadStatus.dataset.state = 'preparing';
  refs.exportDownloadStatus.dataset.format = '';

  try {
    const files = createExportFiles(subtitles);
    refs.downloads.replaceChildren(
      ...files.map((file) => createDownloadLink(file)),
      createDownloadSyncMeta(),
    );
    refs.exportDownloadStatus.dataset.state = 'ready';
    refs.exportDownloadStatus.textContent = '파일 준비 완료 · 다운로드 버튼을 눌러 기기에 저장하세요.';
  } catch {
    state.downloadUrls.forEach((url) => URL.revokeObjectURL(url));
    state.downloadUrls = [];
    refs.downloads.replaceChildren(...createDownloadPlaceholders(), createDownloadSyncMeta());
    refs.exportBuildError.hidden = false;
    refs.exportBuildErrorText.textContent = '자막 파일을 준비하지 못했습니다. 기존 자막과 편집 내용은 유지됩니다. 파일을 다시 준비해 주세요.';
    refs.exportDownloadStatus.dataset.state = 'error';
    refs.exportDownloadStatus.textContent = '파일 준비 오류 · 아직 다운로드를 요청할 수 없습니다.';
  }
  renderTranslationFailureSummary(subtitles);
  renderExportOverview();
}

function createExportFiles(subtitles) {
  const files = createSubtitleDownloads(subtitles, state.outputFileName || state.file?.name, {
    offsetSeconds: state.subtitleOffsetSeconds,
    language: state.results.find((entry) => entry.id === state.activeResultId)?.outputLanguage || 'original',
  });
  const failureLogFile = createTranslationFailureLogDownload(subtitles, state.outputFileName || state.file?.name);
  if (failureLogFile) {
    files.push(failureLogFile);
  }

  return files;
}

function createDownloadPlaceholders() {
  return ['SRT 다운로드', 'VTT 다운로드', 'JSON 다운로드'].map((label) => {
    const button = document.createElement('button');
    button.className = 'download-placeholder';
    button.type = 'button';
    button.disabled = true;
    button.textContent = label;
    return button;
  });
}

function renderDownloadPlaceholders() {
  state.downloadUrls.forEach((url) => URL.revokeObjectURL(url));
  state.downloadUrls = [];
  refs.downloads.replaceChildren(...createDownloadPlaceholders(), createDownloadSyncMeta());
  refs.exportBuildError.hidden = true;
  refs.exportDownloadStatus.textContent = '저장할 자막이 생기면 다운로드 버튼이 활성화됩니다.';
  renderTranslationFailureSummary([]);
  renderExportOverview();
}

function createDownloadLink(file) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
  state.downloadUrls.push(url);
  const link = document.createElement('a');
  link.className = 'download-link';
  link.classList.add(file.name.toLowerCase().endsWith('.srt') ? 'download-link--primary' :
    file.name.endsWith('.translation-failures.json') ? 'download-link--log' : 'download-link--secondary');
  link.href = url;
  link.download = file.name;
  link.role = 'button';
  link.textContent = file.label;
  return link;
}

function renderTranslationFailureSummary(subtitles) {
  const failures = getTranslationFailures(subtitles);
  if (failures.length === 0) {
    refs.translationFailureSummary.hidden = true;
    refs.translationFailureSummary.textContent = '';
    return;
  }

  const reasons = [...new Set(failures.map((failure) => failure.reason).filter(Boolean))].slice(0, 3);
  refs.translationFailureSummary.hidden = false;
  refs.translationFailureSummary.textContent = `번역 실패 ${failures.length}개 · 원인: ${reasons.join(' / ')}`;
}

function refreshDownloadsForCurrentOffset() {
  refs.exportSubtitleCount.textContent = `${state.subtitles.length}개`;
  ['editorEmptyActions', 'exportEmptyActions'].forEach((id) => {
    document.getElementById(id).hidden = state.subtitles.length > 0;
  });
  saveCurrentResult();
  if (state.subtitles.length > 0) {
    renderDownloads(state.subtitles);
    return;
  }

  renderDownloadPlaceholders();
}

function createDownloadSyncMeta() {
  const meta = document.createElement('span');
  meta.className = 'download-sync-meta';
  meta.textContent = `현재 싱크 보정: ${state.subtitleOffsetSeconds.toFixed(1)}초`;
  return meta;
}

function attachVttTrack(subtitles) {
  if (state.vttUrl) {
    URL.revokeObjectURL(state.vttUrl);
  }

  refs.videoPreview.querySelectorAll('track[data-generated]').forEach((track) => track.remove());

  state.vttUrl = URL.createObjectURL(new Blob([formatVtt(subtitles)], { type: 'text/vtt;charset=utf-8' }));
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = '한국어 자막';
  track.srclang = 'ko';
  track.src = state.vttUrl;
  track.default = true;
  track.dataset.generated = 'true';
  refs.videoPreview.append(track);

  track.addEventListener('load', () => {
    track.track.mode = 'showing';
  });
}

function clearOutputs() {
  saveCurrentResult();
  state.activeResultId = null;
  state.pipelineResultId = null;
  state.editHistory = createEditHistory();
  state.outputFileName = '';
  if (state.vttUrl) {
    URL.revokeObjectURL(state.vttUrl);
    state.vttUrl = null;
  }
  refs.videoPreview.querySelectorAll('track[data-generated]').forEach((track) => track.remove());
  state.downloadUrls.forEach((url) => URL.revokeObjectURL(url));
  state.downloadUrls = [];
  state.subtitles = [];
  state.activeSubtitleIndex = -1;
  state.editorSelectedCueIndex = -1;
  state.editorVisibleCueIndices = [];
  renderDownloadPlaceholders();
  refs.chunksList.replaceChildren();
  if (refs.chunksList.parentElement) {
    refs.chunksList.parentElement.open = false;
  }
  refs.chunkSummary.textContent = '없음';
  refs.subtitleCount.textContent = '0개';
  refs.logOutput.textContent = '';
  renderPreview([]);
  renderEditor();
  clearPlayerSubtitles();
  setProgress(0, '대기 중', 'idle');
  renderResultSelector();
  updateEditControls();
  renderTranslationRecovery();
}

function setProgress(percent, text, runState = 'running') {
  refs.overallProgress.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, percent))));
  refs.overallProgress.setAttribute('aria-valuetext', text);
  refs.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  refs.progressText.textContent = text;
  setRunState(runState);
}

function setRunState(runState) {
  refs.workspace.classList.toggle('is-idle', runState === 'idle');
  refs.workspace.classList.toggle('has-progress', runState !== 'idle');
  const labels = {
    idle: '대기',
    running: '진행 중',
    done: '완료',
    failed: '실패',
    cancelled: '중단',
  };

  refs.runPanel.dataset.runState = runState;
  refs.statusBadge.dataset.state = runState;
  refs.statusBadge.textContent = labels[runState] ?? labels.idle;
}

function setBusy(isBusy) {
  state.isBusy = isBusy;
  refs.cancelButton.disabled = !isBusy;
  refs.settingsForm.querySelectorAll('input, select').forEach((field) => {
    field.disabled = isBusy;
  });
  refs.fileInput.disabled = isBusy;
  refs.subtitleFileInput.disabled = isBusy;
  refs.attachMediaFile.disabled = isBusy;
  ['importSubtitlesEmpty', 'importSubtitlesExport', 'goGenerateEmpty', 'goGenerateExport'].forEach((id) => {
    document.getElementById(id).disabled = isBusy;
  });
  refs.jobResultSelect.disabled = isBusy;
  refs.exportResultSelect.disabled = isBusy || state.results.length === 0;
  refs.dropzone.setAttribute('aria-disabled', String(isBusy));
  document.querySelectorAll('[data-sync-adjust], #subtitleSyncReset').forEach((button) => {
    button.disabled = isBusy;
  });
  updateEditControls();
  updateTranslationControls();
  updateConnectionMode();
  updateStartButtonState();
}

function appendLog(message) {
  const lines = `${refs.logOutput.textContent}\n${message}`.trim().split('\n').slice(-220);
  refs.logOutput.textContent = lines.join('\n');
}

function clearError() {
  refs.errorBox.hidden = true;
  refs.errorBox.textContent = '';
}

function showError(message) {
  refs.errorBox.hidden = false;
  refs.errorBox.textContent = message;
}

function formatRunError(error) {
  if (error?.status === 401) return 'API 키가 거부되었습니다. 키를 확인한 뒤 다시 실행하세요.';
  if (error?.status === 403) return '요청 권한이 없습니다. API 권한과 Worker 허용 Origin을 확인하세요.';
  if (error?.status === 429) return '요청 한도에 도달했습니다. API 사용 한도를 확인하고 잠시 후 다시 실행하세요.';
  const message = error?.message || String(error);
  if (message.includes('Failed to fetch')) {
    return `${message} 브라우저 직접 호출 CORS 문제일 수 있으니 Worker 프록시 URL로 다시 시도해 주세요.`;
  }
  return message;
}

function readVideoDuration(video) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('durationchange', onLoaded);
      video.removeEventListener('canplay', onLoaded);
      video.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        return;
      }

      cleanup();
      resolve(video.duration);
    };
    const onError = () => {
      cleanup();
      reject(new Error('metadata failed'));
    };
    const timeoutId = window.setTimeout(onError, 15000);
    const intervalId = window.setInterval(onLoaded, 200);

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('durationchange', onLoaded);
    video.addEventListener('canplay', onLoaded);
    video.addEventListener('error', onError, { once: true });
    onLoaded();
  });
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes) || 0;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
