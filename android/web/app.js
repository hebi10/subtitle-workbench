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
const statusNames = { queued: '대기 중', running: '생성 중', paused: '일시정지', error: '처리 오류', completed: '완료' };
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

export function nativeCall(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!window.Native?.postMessage) { reject(new Error('Android 앱에서 열어 주세요. 네이티브 연결을 찾을 수 없습니다.')); return; }
    const id = `web-${pageSession}-${++serial}`;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('앱 응답이 지연되었습니다. 작업 목록을 새로고침한 뒤 다시 시도해 주세요.')); }, ['pickVideo', 'importSubtitles', 'export', 'preview'].includes(method) ? 600000 : 30000);
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
  const wasDisabled = node.disabled;
  node.disabled = true;
  try { message(''); await action(); }
  catch (error) { message(error.message || String(error), true); }
  finally { if (node.isConnected) node.disabled = wasDisabled; syncEditorButtons(); }
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
    jobs = state.jobs || [];
    $('pickVideo').disabled = !state.hasKey;
    $('keyHint').hidden = Boolean(state.hasKey);
    $('keyStatus').textContent = state.hasKey ? 'API 키가 암호화되어 저장되어 있습니다.' : '저장된 API 키가 없습니다.';
    const fingerprint = JSON.stringify(jobs);
    if (fingerprint !== jobFingerprint) { renderJobs(); jobFingerprint = fingerprint; }
    if (current && !changingJob) {
      const latest = jobs.find((job) => job.id === current.id);
      if (latest) {
        const changed = current.status !== latest.status || current.completedChunks !== latest.completedChunks || current.stage !== latest.stage;
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
  const fragment = document.createDocumentFragment();
  if (!jobs.length) fragment.append(el('p', '아직 작업이 없습니다. 영상을 선택하거나 자막 파일을 불러오세요.', 'empty'));
  for (const job of jobs) {
    const article = el('article', undefined, 'job');
    article.append(el('h3', job.name));
    const state = el('div', undefined, 'job-state');
    const total = Number(job.totalChunks) || 0;
    const done = Number(job.completedChunks) || 0;
    state.append(el('span', statusNames[job.status] || job.status), el('span', `${done} / ${total}구간 · ${Math.ceil((Number(job.durationMs) || 0) / 60000)}분`));
    const progress = el('progress'); progress.max = Math.max(total, 1); progress.value = job.status === 'completed' ? progress.max : done;
    progress.setAttribute('aria-label', `${job.name} 처리 진행률`);
    article.append(state, progress);
    if (job.stage && job.status === 'running') article.append(el('p', stageLabel(job.stage), 'hint'));
    if (job.error) article.append(el('p', job.error, 'job-error'));
    const actions = el('div', undefined, 'job-actions');
    actions.append(button(job.status === 'completed' ? '자막 편집' : '현재 자막 보기', () => openJob(job.id)));
    if (['running', 'queued'].includes(job.status)) actions.append(button('일시정지', async () => { await nativeCall('pause', { jobId: job.id }); await refresh(); }));
    if (['paused', 'error'].includes(job.status)) actions.append(button('이어하기', async () => { if (current?.id === job.id) await flushSave(); await nativeCall('resume', { jobId: job.id }); await refresh(); }));
    article.append(actions); fragment.append(article);
  }
  $('jobList').replaceChildren(fragment);
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
  return history.present.flatMap((cue, index) => !query || `${cue.original || ''} ${cue.translated || ''}`.toLocaleLowerCase().includes(query) ? [index] : []);
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
  if (!indices.length) fragment.append(el('p', history.present.length ? '검색 결과가 없습니다.' : '아직 저장된 자막이 없습니다.', 'empty'));
  for (const index of indices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const cue = history.present[index];
    const row = el('article', undefined, 'cue'); row.dataset.index = index;
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
  return { sourceLanguage: $('sourceLanguage').value, targetLanguage: $('targetLanguage').value, translate: $('translate').checked, translationModel: $('translationModel').value.trim() || 'gpt-5.5' };
}
function translationState() { $('targetLanguage').disabled = !$('translate').checked; $('translationModel').disabled = !$('translate').checked; }
function hydrateSettings(settings) {
  for (const key of ['sourceLanguage', 'targetLanguage', 'translationModel']) {
    if (typeof settings[key] === 'string' && settings[key]) $(key).value = settings[key];
  }
  $('translate').checked = settings.translate !== false;
  translationState();
}
translationState();
$('settingsForm').addEventListener('input', () => { settingsTouched = true; });
$('settingsForm').addEventListener('change', () => { settingsTouched = true; });
$('translate').addEventListener('change', translationState);
$('settingsForm').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(event.submitter, async () => {
    $('settingsStatus').textContent = '설정 저장 중…';
    try {
      await nativeCall('setSettings', { settings: readSettings() });
      $('settingsStatus').textContent = '다음 작업의 설정을 기기에 저장했습니다.';
    } catch (error) {
      $('settingsStatus').textContent = '설정을 저장하지 못했습니다. 다시 시도해 주세요.';
      throw error;
    }
  });
});
$('keyForm').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(event.submitter, async () => { const key = $('apiKey').value.trim(); if (!key) throw new Error('API 키를 입력해 주세요.'); await nativeCall('setKey', { key }); $('apiKey').value = ''; await refresh(); message('API 키를 암호화해 저장했습니다.'); });
});
for (const [id, action] of Object.entries({
  navJobs: () => show('jobs'), navSettings: () => show('settings'), backToJobs: () => show('jobs'), refreshJobs: refresh,
  pickVideo: async () => { await flushSave(); await nativeCall('pickVideo', { settings: readSettings() }); await refresh(); },
  importSubtitles: async () => { await flushSave(); const file = await nativeCall('importSubtitles'); if (!file) return; const cues = parseSubtitleFileText(file.text, file.name); if (!cues.length) throw new Error('읽을 수 있는 자막이 없습니다. SRT, VTT 또는 JSON 형식을 확인해 주세요.'); setLoadedJob(await nativeCall('importCues', { name: file.name, cues })); await show('editor'); await refresh(); },
  preview: () => nativeCall('preview', { jobId: current.id, positionMs: 0 }), retrySave: flushSave,
  prevPage: () => { page -= 1; renderCues(); }, nextPage: () => { page += 1; renderCues(); },
  undo: () => { if (!editable()) return; history = undoEdit(history); revision += 1; scheduleSave(); renderCues(); },
  redo: () => { if (!editable()) return; history = redoEdit(history); revision += 1; scheduleSave(); renderCues(); },
})) $(id).addEventListener('click', (event) => { void run(event.currentTarget, action); });
$('cueSearch').addEventListener('input', () => { page = 0; renderCues(); });
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
