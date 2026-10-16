import { sortSubtitles, formatSrt, formatVtt, toSubtitleJson, sanitizeFileBase } from '../shared/core.js';
import { updateSubtitleTextAt, updateSubtitleTimingAt, splitSubtitleAt, mergeSubtitleWithNext } from '../shared/subtitle-editor.js';
import { createEditHistory, commitEdit, undoEdit, redoEdit } from '../shared/edit-history.js';
import { parseSubtitleFileText } from '../shared/subtitle-player.js';

const $ = (id) => document.getElementById(id);
const pending = new Map();
const pageSession = typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('');
const PAGE_SIZE = 12;
const DEFAULT_TRANSLATION_MODEL = 'gpt-6-luna';
const statusNames = { queued: '대기 중', running: '생성 중', paused: '일시정지', error: '처리 오류', completed: '완료' };
const languageNames = { auto: '자동 감지', ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', es: '스페인어', fr: '프랑스어', de: '독일어' };
let serial = 0;
let jobs = [];
let current = null;
let history = createEditHistory();
let page = 0;
let revision = 0;
let savedRevision = 0;
let saveTimer;
let saveFlight;
let refreshing = false;
let view = 'jobs';
let jobFingerprint = '';
let changingJob = false;
let settingsHydrated = false;
let settingsTouched = false;
let connection = { hasKey: false, keyCheck: null };
let checkingConnection = false;
let connectionError = '';
const busyNodes = new WeakSet();
const jobActionsInFlight = new Set();

export function nativeCall(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!window.Native?.postMessage) { reject(new Error('Android 앱에서 열어 주세요. 네이티브 연결을 찾을 수 없습니다.')); return; }
    const id = `web-${pageSession}-${++serial}`;
    const timeoutMs = method === 'checkConnection' ? 65000 : ['pickVideo', 'importSubtitles', 'export', 'preview'].includes(method) ? 600000 : 30000;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('앱 응답이 지연되었습니다. 작업 목록을 새로고침한 뒤 다시 시도해 주세요.')); }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
    try { window.Native.postMessage(JSON.stringify({ id, method, params })); }
    catch (error) { clearTimeout(timeout); pending.delete(id); reject(error); }
  });
}

window.nativeResult = (response) => {
  const item = pending.get(response?.id);
  if (!item) return;
  clearTimeout(item.timeout);
  pending.delete(response.id);
  if (response.error) item.reject(new Error(typeof response.error === 'string' ? response.error : response.error.message || '앱 요청을 처리하지 못했습니다.'));
  else item.resolve(response.result);
};
window.nativeEvent = (event) => {
  if (event?.type === 'error') message(event.message || event.error || '앱 작업을 처리하지 못했습니다.', true);
  else if (event?.type === 'notice') message(event.message || '작업 상태가 변경되었습니다.');
  if (!document.hidden) void refresh();
};
window.handleNativeBack = () => {
  if (view === 'jobs') return false;
  void show('jobs').catch((error) => message(error.message || String(error), true));
  return true;
};

function message(text, error = false) {
  $('appMessage').textContent = text;
  $('appMessage').classList.toggle('error', error);
  $('appMessage').hidden = !text;
}
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, action, disabled = false) {
  const node = el('button', text);
  node.type = 'button'; node.disabled = disabled;
  node.addEventListener('click', () => run(node, action));
  return node;
}
async function run(node, action) {
  if (busyNodes.has(node)) return;
  const wasDisabled = node.disabled;
  busyNodes.add(node);
  node.disabled = true;
  try { message(''); await action(); }
  catch (error) { message(error.message || String(error), true); }
  finally { busyNodes.delete(node); if (node.isConnected) node.disabled = wasDisabled; syncEditorButtons(); syncConnection(); }
}
const editable = () => current?.status === 'completed';
const dirty = () => revision !== savedRevision;

async function show(next) {
  if (view === 'editor' && next !== 'editor') await flushSave();
  view = next;
  for (const name of ['jobs', 'editor', 'settings']) $(`${name}View`).hidden = name !== next;
  $('navJobs').toggleAttribute('aria-current', next !== 'settings');
  $('navSettings').toggleAttribute('aria-current', next === 'settings');
  window.scrollTo(0, 0);
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const state = await nativeCall('status');
    if (!settingsHydrated) {
      settingsHydrated = true;
      if (!settingsTouched && state.settings) hydrateSettings(state.settings);
    }
    jobs = Array.isArray(state.jobs) ? state.jobs : [];
    connection = { hasKey: Boolean(state.hasKey), keyCheck: state.keyCheck || null };
    syncConnection();
    const fingerprint = JSON.stringify([jobs, connection.hasKey, readSettings().translationModel]);
    if (fingerprint !== jobFingerprint) { renderJobs(); jobFingerprint = fingerprint; }
    if (current && !changingJob) {
      const latest = jobs.find((job) => job.id === current.id);
      if (latest) {
        const changed = current.status !== latest.status || current.completedChunks !== latest.completedChunks || current.stage !== latest.stage || current.progress?.lastSavedAt !== latest.progress?.lastSavedAt;
        const wasReadOnly = !editable();
        current = latest;
        if (changed && wasReadOnly && !dirty() && view === 'editor') {
          const loaded = await nativeCall('loadJob', { jobId: latest.id });
          if (current?.id === latest.id && !changingJob && !dirty()) {
            current = loaded.job; history = createEditHistory(sortSubtitles(loaded.cues || [])); renderCues();
          }
        }
        syncEditorButtons();
      }
    }
  } catch (error) { message(error.message, true); }
  finally { refreshing = false; }
}

function renderJobs() {
  const focused = document.activeElement;
  const focusedJobId = focused?.closest('#jobList .job')?.dataset.jobId;
  const focusedButtonLabel = focused?.tagName === 'BUTTON' ? focused.textContent : null;
  const fragment = document.createDocumentFragment();
  if (!jobs.length) fragment.append(el('p', '아직 작업이 없습니다. 영상을 선택하거나 자막 파일을 불러오세요.', 'empty'));
  for (const job of jobs) {
    const article = el('article', undefined, 'job');
    article.dataset.jobId = job.id;
    article.append(el('h3', job.name));
    const state = el('div', undefined, 'job-state');
    const total = Number(job.totalChunks) || 0;
    const done = Number(job.completedChunks) || 0;
    const ready = job.status === 'paused' && job.stage === 'ready';
    const settings = job.settings || {};
    const detail = job.progress || {};
    const durationMs = nonnegative(job.durationMs);
    state.append(el('span', ready ? '준비됨' : statusNames[job.status] || job.status), el('span', `${formatDuration(durationMs)} · ${total}구간`));
    article.append(state);
    const measured = typeof detail.percent === 'number' && Number.isFinite(detail.percent);
    const percent = job.status === 'completed' ? 100 : Math.min(100, Math.max(0, measured ? detail.percent : total ? done / total * 100 : 0));
    const progress = el('progress'); progress.max = 100; progress.value = percent;
    progress.setAttribute('aria-label', `${job.name} 처리 진행률`);
    if (!ready) {
      const label = el('div', undefined, 'job-progress-label');
      label.append(el('span', measured ? '저장된 결과 기준' : '저장 완료 구간 기준'), el('strong', `${Number(percent.toFixed(1))}%`));
      article.append(label, progress);
      const processedMs = nonnegative(detail.processedMs);
      article.append(el('p', typeof detail.processedMs === 'number' ? `처리 완료 ${formatDuration(processedMs)} / ${formatDuration(durationMs)}` : `${done} / ${total}구간 저장 완료`, 'hint'));
    }
    const details = el('dl', undefined, 'job-details');
    const row = (label, value) => { const line = el('div'); line.append(el('dt', label), el('dd', value)); details.append(line); };
    if (ready) {
      row('원본 언어', languageNames[settings.sourceLanguage] || settings.sourceLanguage || '자동 감지');
      row('번역 언어', settings.translate === false ? '번역 안 함' : languageNames[settings.targetLanguage] || settings.targetLanguage || '한국어');
    } else {
      if (detail.currentChunk) row('현재 구간', `${Math.min(total || detail.currentChunk, detail.currentChunk)} / ${total}`);
      if (typeof detail.transcribedChunks === 'number') row('저장 결과', `전사 ${detail.transcribedChunks} / ${total} · ${settings.translate === false ? '번역 안 함' : `번역 ${nonnegative(detail.translatedChunks)} / ${total}`}`);
      if (nonnegative(detail.batchTotal)) row('현재 번역', `${nonnegative(detail.batchCompleted)} / ${detail.batchTotal}묶음 저장`);
      if (['extracting', 'extract'].includes(job.stage) && job.status === 'running') row('오디오 추출', typeof detail.extractionPercent === 'number' && Number.isFinite(detail.extractionPercent) ? `${Math.max(0, Math.min(100, detail.extractionPercent))}%` : '진행률을 기다리는 중');
      if (typeof detail.elapsedMs === 'number') row('경과 시간', formatDuration(detail.elapsedMs));
      row('마지막 저장', detail.lastSavedAt ? formatSavedAt(detail.lastSavedAt) : done ? '저장 시각 기록 없음' : '아직 저장된 결과 없음');
    }
    row('번역 모델', settings.translate === false ? '번역 안 함' : settings.translationModel || '기존 작업 설정');
    article.append(details);
    if (job.stage && job.status === 'running') article.append(el('p', detail.message || stageLabel(job.stage), 'hint'));
    if (ready) article.append(el('p', '생성 시작 시 추출한 오디오와 번역할 자막을 OpenAI로 전송합니다. API 사용 요금은 본인 계정에 청구됩니다. 긴 영상일수록 시간과 비용이 늘어납니다.', 'job-ready-note'));
    if (!ready && ['paused', 'error'].includes(job.status)) article.append(el('p', '저장된 결과를 유지하고 남은 구간부터 이어갑니다.', 'hint'));
    if (job.error) article.append(el('p', job.error, 'job-error'));
    const actions = el('div', undefined, 'job-actions');
    if (!ready) actions.append(button(job.status === 'completed' ? '자막 편집' : '현재 자막 보기', () => openJob(job.id)));
    if (['running', 'queued'].includes(job.status)) actions.append(button('일시정지', () => runJobAction(job.id, async () => { await nativeCall('pause', { jobId: job.id }); await refresh(); }), jobActionsInFlight.has(job.id)));
    if (['paused', 'error'].includes(job.status)) {
      const start = button(ready ? '생성 시작' : '이어하기', () => resumeJob(job.id), !connection.hasKey || jobActionsInFlight.has(job.id));
      if (ready) start.classList.add('primary');
      actions.append(start);
      const selectedModel = readSettings().translationModel;
      if (!ready && settings.translate !== false && settings.translationModel && selectedModel !== settings.translationModel) {
        article.append(el('p', `현재 선택 모델: ${selectedModel}. 이 모델로 이어하면 남은 번역에만 적용됩니다.`, 'hint job-model-note'));
        actions.append(button('현재 모델로 이어하기', () => resumeJob(job.id, selectedModel), !connection.hasKey || jobActionsInFlight.has(job.id)));
      }
      if (!connection.hasKey || job.status === 'error') actions.append(button('API 설정 확인', () => show('settings')));
    }
    article.append(actions); fragment.append(article);
  }
  $('jobList').replaceChildren(fragment);
  if (focusedJobId && focusedButtonLabel) {
    const restoredJob = Array.from($('jobList').children).find((node) => node.dataset.jobId === focusedJobId);
    Array.from(restoredJob?.querySelectorAll('button') || []).find((node) => node.textContent === focusedButtonLabel && !node.disabled)?.focus({ preventScroll: true });
  }
}
async function runJobAction(jobId, action) {
  if (jobActionsInFlight.has(jobId)) return;
  jobActionsInFlight.add(jobId);
  renderJobs();
  try { await action(); }
  finally { jobActionsInFlight.delete(jobId); renderJobs(); }
}
async function resumeJob(jobId, translationModel) {
  await runJobAction(jobId, async () => {
    if (current?.id === jobId) await flushSave();
    await nativeCall('resume', { jobId, ...(translationModel ? { translationModel } : {}) });
    await refresh();
  });
}
function nonnegative(value) { return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0; }
function formatDuration(ms) {
  const seconds = Math.floor(nonnegative(ms) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
}
function formatSavedAt(value) {
  if (!value) return '아직 저장된 결과 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '저장 시각 확인 불가' : new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}
function stageLabel(stage) {
  return ({ extracting: '오디오 구간 추출 중', transcribing: '음성 인식 중', translating: '자막 번역 중', extract: '오디오 구간 추출 중', transcribe: '음성 인식 중', translate: '자막 번역 중' })[stage] || `진행 단계: ${stage}`;
}

async function openJob(jobId) {
  if (changingJob) return;
  changingJob = true;
  try {
    await flushSave();
    const loaded = await nativeCall('loadJob', { jobId });
    setLoadedJob(loaded);
    await show('editor');
  } finally { changingJob = false; }
}
function setLoadedJob({ job, cues }) {
  clearTimeout(saveTimer);
  current = job; history = createEditHistory(sortSubtitles(cues || []), 30);
  revision = 0; savedRevision = 0; page = 0;
  $('cueSearch').value = '';
  $('cueFilter').value = 'all';
  $('cueJump').value = '';
  $('jumpHint').textContent = '시:분:초 또는 #자막번호를 입력하세요.';
  $('editorName').textContent = current.name;
  $('saveStatus').textContent = '저장된 자막';
  $('saveStatus').classList.remove('error-text');
  $('retrySave').hidden = true;
  renderCues();
}

function changed(cues, render = true) {
  if (!editable()) return;
  history = commitEdit(history, cues);
  revision += 1;
  scheduleSave();
  if (render) renderCues(); else syncEditorButtons();
}
function scheduleSave() {
  clearTimeout(saveTimer);
  $('saveStatus').textContent = '변경 내용을 저장합니다…';
  $('saveStatus').classList.remove('error-text');
  saveTimer = setTimeout(() => { void flushSave().catch(() => {}); }, 650);
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (saveFlight) await saveFlight;
  if (!dirty() || !current) return;
  const jobId = current.id;
  const savingRevision = revision;
  const cues = history.present.map((cue) => ({ ...cue }));
  $('saveStatus').textContent = '기기에 저장 중…';
  const request = nativeCall('saveCues', { jobId, cues });
  saveFlight = request;
  try {
    await request;
    if (current?.id === jobId) { savedRevision = savingRevision; $('saveStatus').textContent = '기기에 저장됨'; $('retrySave').hidden = true; $('saveStatus').classList.remove('error-text'); }
  } catch (error) {
    $('saveStatus').textContent = `저장하지 못했습니다: ${error.message}`;
    $('saveStatus').classList.add('error-text'); $('retrySave').hidden = false;
    throw error;
  } finally { if (saveFlight === request) saveFlight = null; }
  if (dirty()) await flushSave();
}

function filteredIndices() {
  const query = $('cueSearch').value.trim().toLocaleLowerCase();
  const filter = $('cueFilter').value;
  return history.present.flatMap((cue, index) => {
    const matchesText = !query || `${cue.original || ''} ${cue.translated || ''}`.toLocaleLowerCase().includes(query);
    const issue = Boolean(cue.translationError) || !(cue.original || '').trim() || !(cue.end > cue.start) || (index > 0 && cue.start < history.present[index - 1].end);
    const matchesFilter = filter === 'all' || (filter === 'untranslated' ? !(cue.translated || '').trim() : issue);
    return matchesText && matchesFilter ? [index] : [];
  });
}
function syncEditorButtons() {
  $('undo').disabled = !editable() || !history.past.length;
  $('redo').disabled = !editable() || !history.future.length;
  $('readOnlyNote').hidden = !current || editable();
  $('preview').disabled = !current?.uri;
  $('exportNote').textContent = editable() ? '번역이 없는 자막은 원문으로 내보냅니다.' : '현재까지 저장된 부분 자막을 내보냅니다. 번역이 없으면 원문을 사용합니다.';
  document.querySelectorAll('[data-export]').forEach((node) => { node.disabled = !history.present.length; });
  document.querySelectorAll('#cueList input, #cueList textarea, #cueList [data-edit]').forEach((node) => { node.disabled = !editable(); });
  document.querySelectorAll('[data-last]').forEach((node) => { node.disabled = true; });
  const pages = Math.max(1, Math.ceil(filteredIndices().length / PAGE_SIZE));
  $('prevPage').disabled = page === 0;
  $('nextPage').disabled = page >= pages - 1;
}
function field(labelText, tag, value, update, type) {
  const label = el('label', labelText);
  const input = el(tag); input.value = value ?? ''; input.disabled = !editable();
  if (type) { input.type = type; input.min = '0'; input.step = '0.001'; input.inputMode = 'decimal'; }
  input.addEventListener(type ? 'change' : 'input', () => update(input));
  label.append(input); return label;
}
function renderCues() {
  const indices = filteredIndices();
  const pages = Math.max(1, Math.ceil(indices.length / PAGE_SIZE));
  page = Math.min(page, pages - 1);
  $('cueCount').textContent = `${history.present.length}개`;
  $('pageInfo').textContent = `${page + 1} / ${pages} · ${indices.length}개`;
  $('prevPage').disabled = page === 0;
  $('nextPage').disabled = page >= pages - 1;
  const fragment = document.createDocumentFragment();
  if (!indices.length) fragment.append(el('p', history.present.length ? '검색·필터 조건에 맞는 자막이 없습니다.' : '아직 저장된 자막이 없습니다.', 'empty'));
  for (const index of indices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const cue = history.present[index];
    const row = el('article', undefined, 'cue'); row.dataset.index = index; row.tabIndex = -1;
    row.append(el('h3', `자막 ${index + 1}`));
    const times = el('div', undefined, 'cue-times');
    for (const [key, label] of [['start', '시작 (초)'], ['end', '종료 (초)']]) {
      times.append(field(label, 'input', cue[key], (input) => {
        if (!input.value || !Number.isFinite(Number(input.value))) { input.value = history.present[index][key]; return; }
        const next = updateSubtitleTimingAt(history.present, index, { [key]: Number(input.value) });
        changed(sortSubtitles(next));
      }, 'number'));
    }
    row.append(times);
    for (const [key, label] of [['original', '원문'], ['translated', '번역']]) {
      row.append(field(label, 'textarea', cue[key], (input) => {
        // Keep the focused DOM node and its exact draft, including trailing spaces and IME input.
        const next = updateSubtitleTextAt(history.present, index, key, input.value);
        next[index] = { ...next[index], [key]: input.value };
        changed(next, false);
      }));
    }
    const actions = el('div', undefined, 'cue-actions');
    actions.append(button('여기부터 재생', () => nativeCall('preview', { jobId: current.id, positionMs: Math.round(history.present[index].start * 1000) }), !current.uri));
    row.append(actions);
    const details = el('details'); details.append(el('summary', '자막 분할 · 병합'));
    const editing = el('div', undefined, 'cue-actions');
    const split = button('중간에서 분할', () => changed(splitSubtitleAt(history.present, index)), !editable()); split.dataset.edit = '';
    const merge = button('다음 자막과 병합', () => changed(mergeSubtitleWithNext(history.present, index)), !editable() || index === history.present.length - 1); merge.dataset.edit = '';
    if (index === history.present.length - 1) merge.dataset.last = '';
    editing.append(split, merge); details.append(editing); row.append(details);
    if (cue.translationError) row.append(el('p', `번역 오류: ${cue.translationError}`, 'hint'));
    fragment.append(row);
  }
  $('cueList').replaceChildren(fragment);
  syncEditorButtons();
  document.querySelectorAll('[data-last]').forEach((node) => { node.disabled = true; });
}

function readSettings() {
  return { sourceLanguage: $('sourceLanguage').value, targetLanguage: $('targetLanguage').value, translate: $('translate').checked, translationModel: $('translationModel').value.trim() || DEFAULT_TRANSLATION_MODEL };
}
function translationState() { $('targetLanguage').disabled = !$('translate').checked; $('translationModel').disabled = !$('translate').checked; syncConnection(); }
function syncConnection() {
  const selected = readSettings();
  const checked = connection.keyCheck;
  const matches = checked && !connectionError && (!selected.translate || checked.translationModel === selected.translationModel);
  const running = jobs.some((job) => ['running', 'queued'].includes(job.status));
  $('keyHint').hidden = connection.hasKey;
  $('keyStatus').textContent = connection.hasKey ? `API 키가 암호화되어 저장되어 있습니다.${running ? ' 키를 바꾸거나 삭제하려면 작업을 일시정지해 주세요.' : ''}` : '저장된 API 키가 없습니다. 본인의 키를 입력해 주세요.';
  $('connectionSummary').textContent = !connection.hasKey ? '본인의 OpenAI API 키를 연결해 시작하세요.' : connectionError ? '연결 확인 실패 · 설정을 확인해 주세요.' : matches ? 'API 키 인증 · 모델 접근 확인됨' : 'API 키 저장됨 · 연결 미확인';
  $('activeModel').textContent = $('settingsModel').textContent = selected.translate ? `번역 모델: ${selected.translationModel}` : '번역 안 함 · 음성 인식: whisper-1';
  if (!checkingConnection) $('connectionStatus').textContent = connectionError || (matches ? `키 인증 · 모델 접근 확인 (${formatSavedAt(checked.checkedAt)}). 결제 상태나 잔액을 확인한 것은 아닙니다.` : '연결 확인은 키 인증과 선택 모델 접근만 검사합니다. 결제 상태나 잔액은 확인하지 않습니다.');
  $('connectionStatus').classList.toggle('error-text', Boolean(connectionError));
  for (const [node, disabled] of [[$('pickVideo'), !connection.hasKey], [$('checkConnection'), !connection.hasKey || checkingConnection], [$('requestClearKey'), !connection.hasKey || running], [$('clearKey'), !connection.hasKey || running], [$('keyForm').querySelector('[type="submit"]'), running]]) {
    if (!busyNodes.has(node)) node.disabled = disabled;
  }
}
function hydrateSettings(settings) {
  for (const key of ['sourceLanguage', 'targetLanguage', 'translationModel']) {
    if (typeof settings[key] === 'string' && settings[key]) {
      if ($(key).tagName === 'SELECT' && !Array.from($(key).options).some((option) => option.value === settings[key])) {
        const option = el('option', settings[key]); option.value = settings[key]; $(key).append(option);
      }
      $(key).value = settings[key];
    }
  }
  $('translate').checked = settings.translate !== false;
  translationState();
}
translationState();
$('settingsForm').addEventListener('input', () => { settingsTouched = true; connectionError = ''; syncConnection(); });
$('settingsForm').addEventListener('change', () => { settingsTouched = true; connectionError = ''; syncConnection(); });
$('translate').addEventListener('change', translationState);
$('settingsForm').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(event.submitter, async () => {
    $('settingsStatus').textContent = '설정 저장 중…';
    try {
      await nativeCall('setSettings', { settings: readSettings() });
      connectionError = '';
      await refresh();
      $('settingsStatus').textContent = '다음 작업의 설정을 기기에 저장했습니다.';
    } catch (error) {
      $('settingsStatus').textContent = '설정을 저장하지 못했습니다. 다시 시도해 주세요.';
      throw error;
    }
  });
});
$('keyForm').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(event.submitter, async () => { const key = $('apiKey').value.trim(); if (!key) throw new Error('API 키를 입력해 주세요.'); await nativeCall('setKey', { key }); $('apiKey').value = ''; connectionError = ''; await refresh(); message('API 키를 암호화해 저장했습니다. 연결 확인으로 키와 모델 접근을 검사할 수 있습니다.'); });
});
$('jumpForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('cueJump').value.trim();
  let index = -1;
  if (/^#\d+$/.test(value)) index = Number(value.slice(1)) - 1;
  else if (/^\d{1,3}:[0-5]\d:[0-5]\d(?:\.\d{1,3})?$/.test(value)) {
    const [hours, minutes, seconds] = value.split(':').map(Number);
    const at = hours * 3600 + minutes * 60 + seconds;
    index = history.present.findIndex((cue) => cue.end > at);
  } else {
    $('jumpHint').textContent = '시간은 01:20:00, 자막 번호는 #245 형식으로 입력해 주세요.';
    return;
  }
  if (index < 0 || index >= history.present.length) { $('jumpHint').textContent = '해당 위치에 저장된 자막이 없습니다. 시간이나 번호를 확인해 주세요.'; return; }
  $('cueSearch').value = ''; $('cueFilter').value = 'all'; page = Math.floor(index / PAGE_SIZE); renderCues();
  const target = $('cueList').querySelector(`[data-index="${index}"]`);
  target?.focus(); target?.scrollIntoView({ block: 'start' });
  $('jumpHint').textContent = `자막 ${index + 1}로 이동했습니다. 검색과 필터를 전체로 변경했습니다.`;
});
for (const [id, action] of Object.entries({
  navJobs: () => show('jobs'), navSettings: () => show('settings'), openConnection: () => show('settings'), backToJobs: () => show('jobs'), refreshJobs: refresh,
  pickVideo: async () => { await flushSave(); const selected = await nativeCall('pickVideo', { settings: readSettings() }); await refresh(); if (selected) message('영상이 준비되었습니다. 길이와 설정을 확인하고 생성 시작을 눌러 주세요.'); },
  openApiKeyPage: () => nativeCall('openApiKeyPage'),
  checkConnection: async () => {
    checkingConnection = true; connectionError = '';
    $('connectionStatus').textContent = '키 인증과 선택 모델 접근을 확인하고 있습니다…';
    try { await nativeCall('checkConnection', { settings: readSettings() }); await refresh(); }
    catch (error) { connectionError = `연결을 확인하지 못했습니다: ${error.message}`; throw error; }
    finally { checkingConnection = false; syncConnection(); }
  },
  requestClearKey: () => { $('confirmClearKey').hidden = false; $('cancelClearKey').focus(); },
  cancelClearKey: () => { $('confirmClearKey').hidden = true; $('requestClearKey').focus(); },
  clearKey: async () => { await nativeCall('clearKey'); $('apiKey').value = ''; connectionError = ''; $('confirmClearKey').hidden = true; await refresh(); message('이 기기에 저장된 API 키를 삭제했습니다.'); },
  jumpToExport: () => { $('exportSection').focus(); $('exportSection').scrollIntoView({ block: 'start' }); },
  importSubtitles: async () => { await flushSave(); const file = await nativeCall('importSubtitles'); if (!file) return; const cues = parseSubtitleFileText(file.text, file.name); if (!cues.length) throw new Error('읽을 수 있는 자막이 없습니다. SRT, VTT 또는 JSON 형식을 확인해 주세요.'); setLoadedJob(await nativeCall('importCues', { name: file.name, cues })); await show('editor'); await refresh(); },
  preview: () => nativeCall('preview', { jobId: current.id, positionMs: 0 }), retrySave: flushSave,
  prevPage: () => { page -= 1; renderCues(); }, nextPage: () => { page += 1; renderCues(); },
  undo: () => { if (!editable()) return; history = undoEdit(history); revision += 1; scheduleSave(); renderCues(); },
  redo: () => { if (!editable()) return; history = redoEdit(history); revision += 1; scheduleSave(); renderCues(); },
})) $(id).addEventListener('click', (event) => { void run(event.currentTarget, action); });
$('cueSearch').addEventListener('input', () => { page = 0; renderCues(); });
$('cueFilter').addEventListener('change', () => { page = 0; renderCues(); });
document.querySelectorAll('[data-export]').forEach((node) => node.addEventListener('click', () => run(node, async () => {
  await flushSave();
  const format = node.dataset.export;
  const text = format === 'json' ? toSubtitleJson(history.present) : format === 'vtt' ? formatVtt(history.present) : formatSrt(history.present);
  const mime = { srt: 'application/x-subrip', vtt: 'text/vtt', json: 'application/json' }[format];
  const result = await nativeCall('export', { name: `${sanitizeFileBase(current.name)}.${format}`, mime, text });
  if (result !== null && result !== false) message('자막 내보내기 요청을 완료했습니다.');
})));
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); else void flushSave().catch(() => {}); });
setInterval(() => { if (!document.hidden) void refresh(); }, 3500);
void refresh();
