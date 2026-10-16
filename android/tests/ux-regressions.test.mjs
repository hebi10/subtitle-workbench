import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { before, after } from 'node:test';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const artifacts = join(root, 'output/android-improvements-ui');
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
let server;
let browser;
let baseUrl;

before(async () => {
  if (!enabled) return;
  await mkdir(artifacts, { recursive: true });
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const paths = {
      '/': 'android/web/index.html', '/app.js': 'android/web/app.js', '/styles.css': 'android/web/styles.css',
      '/shared/core.js': 'src/core.js', '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
      '/shared/edit-history.js': 'src/edit-history.js', '/shared/subtitle-player.js': 'src/subtitle-player.js',
    };
    if (!paths[pathname]) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
      res.end(await readFile(join(root, paths[pathname])));
    } catch { res.writeHead(500).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function withApp(action) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
  try {
    await page.goto(baseUrl);
    await page.locator('.job').first().waitFor();
    await action(page);
    assert.deepEqual(errors, [], 'browser must not throw during the tested flow');
  } finally { await context.close(); }
}

const regression = (name, action) => test(name, { skip: !enabled }, () => withApp(action));
const jobCard = (page, jobId) => page.locator(`.job[data-job-id="${jobId}"]:visible`);
const selectedCue = (page) => page.locator('.cue').filter({ has: page.locator('.cue-summary[aria-expanded="true"]') });

async function openEditor(page) {
  await jobCard(page, 'complete-1').getByRole('button', { name: '자막 편집', exact: true }).click();
  await page.locator('.cue').first().waitFor();
}

async function openEditorTools(page) {
  if (!(await page.locator('#editorTools').evaluate((node) => node.open))) await page.locator('#editorTools > summary').click();
}

async function holdNextSave(page) {
  await page.evaluate(() => {
    const postMessage = window.Native.postMessage.bind(window.Native);
    window.Native.postMessage = (raw) => {
      const call = JSON.parse(raw);
      if (call.method !== 'saveCues') return postMessage(raw);
      window.Native.postMessage = postMessage;
      window.heldSave = call;
      window.releaseSave = () => { postMessage(raw); };
    };
  });
}

async function refreshWithChangedProgress(page) {
  const next = await page.evaluate(() => {
    const job = window.mockNative.jobs.find((job) => job.id === 'partial-1');
    job.progress.elapsedMs = (job.progress.elapsedMs || 0) + 1000;
    window.nativeEvent({ type: 'status' });
    return job.progress.elapsedMs;
  });
  await page.waitForFunction((elapsed) => {
    const seconds = Math.floor(elapsed / 1000);
    const clock = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
    return document.querySelector('.job[data-job-id="partial-1"]')?.textContent.includes(clock);
  }, next);
}

async function assertInViewport(locator, label) {
  assert.equal(await locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const nav = document.querySelector('.app-nav')?.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= (nav?.top ?? innerHeight) && rect.width > 0 && rect.height > 0;
  }), true, label);
}

regression('only the selected cue expands and page navigation reveals the first cue', async (page) => {
  await openEditor(page);
  assert.equal(await page.locator('.cue').count(), 12);
  assert.equal(await page.locator('.cue textarea:visible').count(), 2, 'only one cue exposes original and translated editors');
  assert.equal(await selectedCue(page).getAttribute('data-index'), '0');
  await page.locator('.cue[data-index="10"] .cue-summary').click();
  assert.equal(await selectedCue(page).getAttribute('data-index'), '10');
  assert.equal(await page.locator('.cue-detail').count(), 1);
  await page.locator('#nextPage').click();
  const next = page.locator('.cue[data-index="12"]');
  assert.equal(await selectedCue(page).getAttribute('data-index'), '12');
  assert.equal(await next.evaluate((node) => document.activeElement === node || node.contains(document.activeElement)), true);
  await assertInViewport(next.locator('.cue-summary'), 'next page first cue must be on screen');
  await page.locator('#prevPage').click();
  assert.equal(await selectedCue(page).getAttribute('data-index'), '0');
  await assertInViewport(page.locator('.cue[data-index="0"] .cue-summary'), 'previous page first cue must be on screen');
  for (const width of [320, 390, 800]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `compact editor overflow at ${width}px`);
    await page.screenshot({ path: join(artifacts, `compact-editor-${width}.png`), fullPage: true });
    if (width === 390) await page.screenshot({ path: join(artifacts, 'compact-editor-viewport-390.png') });
  }
});

regression('preview waits for the edited subtitle to finish saving', async (page) => {
  await openEditor(page);
  await holdNextSave(page);
  await page.locator('.cue textarea').first().fill('미리보기 전에 저장할 원문');
  await page.locator('#preview').click();
  await page.waitForFunction(() => window.heldSave || window.mockNative.calls.some((call) => call.method === 'preview'));
  assert.equal(await page.evaluate(() => window.mockNative.calls.some((call) => call.method === 'preview')), false, 'preview must not open while save is unresolved');
  await page.evaluate(() => window.releaseSave());
  await page.waitForFunction(() => window.mockNative.calls.some((call) => call.method === 'preview'));
  assert.equal(await page.evaluate(() => window.mockNative.cues['complete-1'][0].original), '미리보기 전에 저장할 원문');
});

regression('play from selected cue waits for persistence and uses the cue timestamp', async (page) => {
  await openEditor(page);
  await openEditorTools(page);
  await page.locator('#cueJump').fill('#11');
  await page.locator('#jumpForm button').click();
  await holdNextSave(page);
  await selectedCue(page).locator('textarea').first().fill('선택 위치 재생 전에 저장할 원문');
  await selectedCue(page).getByRole('button', { name: '여기부터 재생', exact: true }).click();
  await page.waitForFunction(() => window.heldSave || window.mockNative.calls.some((call) => call.method === 'preview'));
  assert.equal(await page.evaluate(() => window.mockNative.calls.some((call) => call.method === 'preview')), false);
  await page.evaluate(() => window.releaseSave());
  await page.waitForFunction(() => window.mockNative.calls.some((call) => call.method === 'preview'));
  assert.deepEqual(await page.evaluate(() => window.mockNative.calls.find((call) => call.method === 'preview').params), { jobId: 'complete-1', positionMs: 30000 });
  assert.equal(await page.evaluate(() => window.mockNative.cues['complete-1'][10].original), '선택 위치 재생 전에 저장할 원문');
});

regression('save failure and retry remain visible while editing a deep cue', async (page) => {
  await openEditor(page);
  await page.evaluate(() => { window.mockNative.failSave = true; });
  const deepCue = page.locator('.cue[data-index="10"]');
  if (await deepCue.locator('.cue-summary').count()) await deepCue.locator('.cue-summary').click();
  await deepCue.locator('textarea').first().fill('실패 후에도 보존할 초안');
  await page.locator('#retrySave').waitFor({ state: 'visible' });
  assert.ok(await page.evaluate(() => window.scrollY > 400), 'failure must be checked away from the editor heading');
  await assertInViewport(page.locator('#saveStatus'), 'save failure must be visible at the editing position');
  await assertInViewport(page.locator('#retrySave'), 'retry action must be visible at the editing position');
  await page.screenshot({ path: join(artifacts, 'save-failure-390.png') });
  const draft = deepCue.locator('textarea').first();
  await draft.focus();
  await draft.evaluate((node) => {
    window.draftNode = node;
    node.setSelectionRange(1, 4);
    node.dispatchEvent(new CompositionEvent('compositionstart', { data: '초안' }));
  });
  await refreshWithChangedProgress(page);
  assert.equal(await draft.inputValue(), '실패 후에도 보존할 초안');
  assert.equal(await draft.evaluate((node) => node === document.activeElement), true);
  assert.deepEqual(await draft.evaluate((node) => [node === window.draftNode, node.selectionStart, node.selectionEnd]), [true, 1, 4], 'polling retains the composing DOM node and selection');
  await draft.dispatchEvent('compositionend', { data: '초안' });
  await deepCue.getByRole('button', { name: '여기부터 재생', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('appMessage').textContent.includes('테스트 저장 실패'));
  assert.equal(await page.evaluate(() => window.mockNative.calls.some((call) => call.method === 'preview')), false);
  await assertInViewport(page.locator('#appMessage'), 'blocked preview reason must be visible where the action was taken');
  await page.locator('#navJobs').click();
  await page.waitForFunction(() => document.getElementById('appMessage').textContent.includes('테스트 저장 실패'));
  assert.equal(await page.locator('#editorView').isVisible(), true, 'failed save blocks leaving the editor');
  await assertInViewport(page.locator('#appMessage'), 'blocked navigation reason must remain visible');
  await page.locator('#preview').click();
  await page.waitForFunction(() => !document.getElementById('preview').disabled);
  await page.waitForFunction(() => document.getElementById('appMessage').textContent.includes('테스트 저장 실패'));
  assert.equal(await page.evaluate(() => window.mockNative.calls.some((call) => call.method === 'preview')), false, 'header preview must also stop on save failure');
  await draft.focus();
  await page.evaluate(() => { window.mockNative.failSave = false; });
  await page.locator('#retrySave').click();
  await page.locator('#retrySave').waitFor({ state: 'hidden' });
  assert.equal((await page.locator('#appMessage').getAttribute('class')).includes('error'), false, 'successful retry clears the obsolete global save error');
  assert.equal(await page.evaluate(() => window.mockNative.cues['complete-1'][10].original), '실패 후에도 보존할 초안');
  await page.evaluate(() => window.nativeEvent({ type: 'notice', message: '현재 위치의 완료 알림' }));
  await assertInViewport(page.locator('#appMessage'), 'general feedback must remain visible at deep scroll');
  await page.locator('#navJobs').click();
  assert.equal(await page.locator('#jobsView').isVisible(), true);
});

regression('jump, search and issue filters select relevant cues and explain every detected issue', async (page) => {
  await page.evaluate(() => {
    const cues = window.mockNative.cues['complete-1'];
    cues[1].original = '';
    cues[2].start = 5;
    cues[3].translationError = '모델 응답 오류';
    cues[4].end = cues[4].start;
    cues[5].translated = '';
  });
  await openEditor(page);
  await openEditorTools(page);
  await page.locator('#cueJump').fill('#27');
  await page.locator('#jumpForm button').click();
  assert.equal(await selectedCue(page).getAttribute('data-index'), '26');
  await assertInViewport(selectedCue(page).locator('.cue-summary'), 'jump target summary must be on screen');
  await page.locator('#cueJump').fill('00:00:03');
  await page.locator('#jumpForm button').click();
  assert.equal(await selectedCue(page).getAttribute('data-index'), '1');
  await page.locator('#cueSearch').fill('테스트 번역 자막 27');
  assert.equal(await selectedCue(page).getAttribute('data-index'), '26');
  assert.equal(await page.locator('#cueSearch').evaluate((node) => document.activeElement === node), true, 'typing search must retain focus');
  await page.locator('#cueSearch').fill('');
  await page.locator('#cueFilter').selectOption('issues');
  assert.equal(await page.locator('.cue').count(), 4);
  assert.equal(await selectedCue(page).getAttribute('data-index'), '1');
  for (const [index, reason] of [[1, /원문/], [2, /겹/], [3, /번역.*오류|모델 응답 오류/], [4, /시간|종료/]]) {
    const issue = page.locator(`.cue[data-index="${index}"] .cue-issues`);
    assert.match(await issue.innerText(), reason);
    assert.equal(await issue.isVisible(), true, 'issue reason must be visible even when its editor is collapsed');
  }
  await page.locator('#cueFilter').selectOption('untranslated');
  assert.equal(await page.locator('.cue').count(), 1);
  assert.equal(await selectedCue(page).getAttribute('data-index'), '5');
});

regression('unsaved global settings survive polling but only saved settings create new jobs', async (page) => {
  await page.locator('#navSettings').click();
  await page.locator('#defaultSettings > summary').click();
  await page.locator('#sourceLanguage').selectOption('en');
  await page.locator('#targetLanguage').selectOption('ja');
  await page.locator('#advancedSettings summary').click();
  await page.locator('#translationModel').fill('saved-model');
  await page.locator('#settingsForm button[type="submit"]').click();
  await page.waitForFunction(() => document.getElementById('settingsStatus').textContent.includes('기기에 저장했습니다'));
  await page.locator('#translationModel').fill('unsaved-model');
  assert.match(await page.locator('#settingsStatus').textContent(), /저장하지|미저장/);
  assert.doesNotMatch(await page.locator('#settingsStatus').textContent(), /기기에 저장했습니다/);
  await refreshWithChangedProgress(page);
  assert.equal(await page.locator('#translationModel').inputValue(), 'unsaved-model');
  assert.equal(await page.locator('#translationModel').evaluate((node) => document.activeElement === node), true);
  assert.equal(await page.locator('#advancedSettings').getAttribute('open'), '');
  await page.locator('#navVideo').click();
  await page.locator('#pickVideo').click();
  await jobCard(page, 'ready-1').waitFor();
  assert.deepEqual(await page.evaluate(() => window.mockNative.calls.find((call) => call.method === 'pickVideo').params.settings), {
    sourceLanguage: 'en', targetLanguage: 'ja', translate: true, translationModel: 'saved-model',
  });
  await page.locator('#navSettings').click();
  assert.equal(await page.locator('#translationModel').inputValue(), 'unsaved-model');
  await page.locator('#discardSettings').click();
  assert.equal(await page.locator('#translationModel').inputValue(), 'saved-model');
});

regression('prepared settings retain typed drafts, apply only to that job and can be discarded', async (page) => {
  await page.locator('#navVideo').click();
  await page.locator('#pickVideo').click();
  const ready = jobCard(page, 'ready-1');
  await ready.waitFor();
  await ready.getByText('준비 설정 변경', { exact: true }).click();
  const form = ready.locator('form.prepared-settings');
  await form.locator('[name="sourceLanguage"]').selectOption('ja');
  await form.locator('[name="targetLanguage"]').selectOption('en');
  await form.locator('[name="translationModel"]').fill('prepared-draft ');
  await refreshWithChangedProgress(page);
  assert.equal(await form.locator('[name="translationModel"]').inputValue(), 'prepared-draft ');
  assert.equal(await form.locator('[name="translationModel"]').evaluate((node) => document.activeElement === node), true);
  assert.equal(await form.isVisible(), true);
  await page.screenshot({ path: join(artifacts, 'prepared-settings-390.png'), fullPage: true });
  await ready.getByRole('button', { name: '생성 시작', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('appMessage').textContent.includes('아직 적용하지 않은'));
  assert.equal(await page.evaluate(() => window.mockNative.calls.some((call) => call.method === 'resume')), false, 'pending prepared settings must be applied or discarded before generation');
  await form.getByRole('button', { name: '이 작업에 적용', exact: true }).click();
  await page.waitForFunction(() => window.mockNative.jobs.find((job) => job.id === 'ready-1').settings.translationModel === 'prepared-draft');
  assert.equal(await page.evaluate(() => window.mockNative.settings.translationModel), 'gpt-6-luna', 'job edits must not overwrite global defaults');
  await page.waitForFunction(() => document.querySelector('.job[data-job-id="ready-1"] .prepared-summary').textContent.includes('일본어'));
  await ready.locator('.job-inspection summary').click();
  const savedDetails = await ready.locator('.job-inspection').innerText();
  assert.match(savedDetails, /prepared-draft/, 'expanded processing settings must reflect the saved model');
  assert.match(savedDetails, /일본어/, 'expanded processing settings must reflect the saved source language');
  assert.match(savedDetails, /영어/, 'expanded processing settings must reflect the saved target language');
  if (!(await form.isVisible())) await ready.getByText('준비 설정 변경', { exact: true }).click();
  await form.locator('[name="translationModel"]').fill('discard-me');
  await form.getByRole('button', { name: '변경 취소', exact: true }).click();
  if (!(await form.isVisible())) await ready.getByText('준비 설정 변경', { exact: true }).click();
  assert.equal(await form.locator('[name="translationModel"]').inputValue(), 'prepared-draft');
});

regression('prepared source replacement preserves the old job on cancel or failure and cancel requires confirmation', async (page) => {
  await page.locator('#navVideo').click();
  await page.locator('#pickVideo').click();
  const ready = jobCard(page, 'ready-1');
  await ready.waitFor();
  await ready.getByText('준비 설정 변경', { exact: true }).click();
  const beforeJob = await page.evaluate(() => JSON.stringify(window.mockNative.jobs.find((job) => job.id === 'ready-1')));
  const beforeCount = await page.evaluate(() => window.mockNative.jobs.length);
  await page.evaluate(() => { window.mockNative.cancelNextPick = true; });
  await ready.getByRole('button', { name: '다른 영상 선택', exact: true }).click();
  await page.waitForFunction(() => !window.mockNative.cancelNextPick);
  assert.equal(await page.evaluate(() => JSON.stringify(window.mockNative.jobs.find((job) => job.id === 'ready-1'))), beforeJob);
  assert.equal(await page.evaluate(() => window.mockNative.jobs.length), beforeCount);
  await page.evaluate(() => { window.mockNative.failNextPick = true; });
  await ready.getByRole('button', { name: '다른 영상 선택', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('appMessage').textContent.includes('테스트 영상 선택 실패'));
  assert.equal(await page.evaluate(() => JSON.stringify(window.mockNative.jobs.find((job) => job.id === 'ready-1'))), beforeJob);
  await ready.getByRole('button', { name: '다른 영상 선택', exact: true }).click();
  await page.waitForFunction(() => window.mockNative.calls.filter((call) => call.method === 'pickVideo' && call.params.replaceJobId === 'ready-1').length === 3);
  await page.waitForFunction(() => document.querySelector('.job[data-job-id="ready-1"] button')?.disabled === false);
  assert.equal(await page.evaluate(() => window.mockNative.jobs.length), beforeCount, 'successful replacement must retain one prepared job');
  await ready.getByRole('button', { name: '준비 취소', exact: true }).click();
  assert.equal(await page.evaluate(() => window.mockNative.calls.some((call) => call.method === 'cancelPrepared')), false);
  await page.screenshot({ path: join(artifacts, 'prepared-cancel-390.png'), fullPage: true });
  await ready.getByRole('button', { name: '준비 취소 확인', exact: true }).click();
  await ready.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.mockNative.jobs.length), beforeCount - 1);
  await page.locator('#navJobs').click();
  assert.equal(await jobCard(page, 'partial-1').getByRole('button', { name: '준비 취소', exact: true }).count(), 0);
});

regression('active jobs lead the home view, details stay collapsed and refresh preserves opened detail focus', async (page) => {
  assert.equal(await page.locator('.job').first().getAttribute('data-job-id'), 'partial-1');
  const active = jobCard(page, 'partial-1');
  const inspection = active.locator('details.job-inspection');
  assert.equal(await inspection.getAttribute('open'), null);
  assert.equal(await active.locator('.job-details').isVisible(), false);
  await page.locator('#navVideo').click();
  assert.ok(await page.locator('.connection-summary').evaluate((node) => node.getBoundingClientRect().height) < 160, 'connected API summary should leave space for work');
  await page.locator('#navJobs').click();
  await inspection.locator('summary').click();
  await active.getByRole('button', { name: '자막 보기', exact: true }).focus();
  await refreshWithChangedProgress(page);
  assert.equal(await inspection.getAttribute('open'), '');
  assert.equal(await active.getByRole('button', { name: '자막 보기', exact: true }).evaluate((node) => document.activeElement === node), true);
  await page.evaluate(() => { window.mockNative.jobs.find((job) => job.id === 'partial-1').status = 'running'; });
  await refreshWithChangedProgress(page);
  await inspection.locator('summary').focus();
  await refreshWithChangedProgress(page);
  assert.equal(await inspection.locator('summary').evaluate((node) => document.activeElement === node), true, 'progress polling must retain keyboard focus on the expanded details summary');
});

regression('new video selection stays visible above a long completed job history', async (page) => {
  await page.evaluate(() => {
    const completed = window.mockNative.jobs.find((job) => job.id === 'complete-1');
    window.mockNative.jobs.push(...Array.from({ length: 20 }, (_, index) => ({
      ...completed, id: `history-${index}`, name: `완료된 영상 ${index + 1}.mp4`,
    })));
    window.nativeEvent({ type: 'status' });
  });
  await page.waitForFunction(() => document.querySelectorAll('#jobsView .job').length === 4);
  assert.match(await page.locator('#jobsPageInfo').textContent(), /1\s*\/\s*6/);
  await page.locator('#navVideo').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await assertInViewport(page.locator('#pickVideo'), 'new video selection must be reachable without scrolling through completed history');
});

regression('completed card exports the correct SRT without replacing the currently loaded editor', async (page) => {
  await jobCard(page, 'partial-1').getByRole('button', { name: '자막 보기', exact: true }).click();
  await page.locator('#editorView').waitFor({ state: 'visible' });
  const editorName = await page.locator('#editorName').textContent();
  await page.locator('#navJobs').click();
  await jobCard(page, 'complete-1').getByRole('button', { name: 'SRT 저장', exact: true }).click();
  await page.waitForFunction(() => window.mockNative.calls.some((call) => call.method === 'export'));
  const exported = await page.evaluate(() => window.mockNative.calls.find((call) => call.method === 'export').params);
  assert.equal(exported.mime, 'application/x-subrip');
  assert.equal(exported.name, '150분 인터뷰 테스트.srt');
  assert.match(exported.text, /00:01:18,000 --> 00:01:20,800\n테스트 번역 자막 27/);
  assert.equal(await page.locator('#jobsView').isVisible(), true);
  assert.equal(await page.locator('#editorName').textContent(), editorName);
  await page.waitForFunction(() => document.getElementById('appMessage').textContent.includes('저장'));
  await assertInViewport(page.locator('#appMessage'), 'direct export feedback must be visible at the completed card');
  await page.evaluate(() => { window.mockNative.cancelNextExport = true; });
  await jobCard(page, 'complete-1').getByRole('button', { name: 'SRT 저장', exact: true }).click();
  await page.waitForFunction(() => !window.mockNative.cancelNextExport);
  assert.doesNotMatch(await page.locator('#appMessage').textContent(), /저장했습니다|완료했습니다/);
});

regression('a thousand cue job keeps jump and filtering bounded to the selected page', async (page) => {
  await page.evaluate(() => {
    window.mockNative.cues['complete-1'] = Array.from({ length: 1000 }, (_, index) => ({
      start: index * 3, end: index * 3 + 2.8,
      original: `Long original ${index + 1}`, translated: index === 999 ? '' : `장편 번역 ${index + 1}`,
    }));
  });
  await openEditor(page);
  assert.equal(await page.locator('#cueCount').textContent(), '1000개');
  await openEditorTools(page);
  await page.locator('#cueJump').fill('#999');
  await page.locator('#jumpForm button').click();
  assert.equal(await selectedCue(page).getAttribute('data-index'), '998');
  assert.ok(await page.locator('.cue').count() <= 12);
  assert.equal(await page.locator('.cue textarea').count(), 2);
  await assertInViewport(selectedCue(page).locator('.cue-summary'), 'deep jump must reveal selected cue without rendering all 1000 editors');
  await page.locator('#cueFilter').selectOption('untranslated');
  assert.equal(await page.locator('.cue').count(), 1);
  assert.equal(await selectedCue(page).getAttribute('data-index'), '999');
  assert.equal(await page.locator('#nextPage').isDisabled(), true);
});

regression('editing a filtered cue time keeps that cue selected after it moves to a later page', async (page) => {
  await page.evaluate(() => {
    window.mockNative.cues['complete-1'] = Array.from({ length: 40 }, (_, index) => ({
      start: index * 3, end: index * 3 + 2.8,
      original: index < 13 ? '' : `Original ${index + 1}`, translated: `검수 자막 ${index + 1}`,
    }));
  });
  await openEditor(page);
  await openEditorTools(page);
  await page.locator('#cueFilter').selectOption('issues');
  assert.equal(await selectedCue(page).getAttribute('data-index'), '0');
  const start = selectedCue(page).getByLabel('시작 (초)', { exact: true });
  await start.fill('1000');
  await start.press('Tab');
  assert.equal(await selectedCue(page).getAttribute('data-index'), '39', 'the edited issue must remain selected after time sorting changes its page');
  assert.equal(await selectedCue(page).locator('textarea').nth(1).inputValue(), '검수 자막 1');
  assert.match(await page.locator('#pageInfo').textContent(), /2 \/ 2/);
});
