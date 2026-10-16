import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { before, after } from 'node:test';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const artifacts = join(root, 'output/android-four-tabs-ui');
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
    await page.waitForFunction(() => window.mockNative?.calls.some((call) => call.method === 'status') && document.querySelector('.job'));
    await action(page);
    assert.deepEqual(errors, [], 'browser must not throw during the tested flow');
  } finally { await context.close(); }
}

const regression = (name, action) => test(name, { skip: !enabled }, () => withApp(action));
const tabs = [['navVideo', 'videoView'], ['navJobs', 'jobsView'], ['navResults', 'resultsView'], ['navSettings', 'settingsView']];

// Catches missing routes, a tab retaining the previous screen, and ambiguous active navigation.
regression('four persistent tabs show exactly one primary view', async (page) => {
  assert.deepEqual(await page.locator('.app-nav button').allTextContents(), ['영상 추가', '작업', '결과', '설정']);
  for (const [button, view] of tabs) {
    await page.locator(`#${button}`).click();
    await page.locator(`#${view}`).waitFor({ state: 'visible' });
    assert.equal(await page.locator(`#${view}`).isVisible(), true, `${button} must reveal ${view}`);
    assert.equal(await page.locator('.app-nav [aria-current="page"]').count(), 1);
    assert.equal(await page.locator(`#${button}`).getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('#videoView:visible, #jobsView:visible, #resultsView:visible, #settingsView:visible, #editorView:visible').count(), 1);
    assert.equal(await page.locator('.app-nav button:visible').count(), 4, 'all four destinations stay available');
  }
});

async function addSecondResult(page) {
  await page.evaluate(() => {
    const source = window.mockNative.jobs.find((job) => job.id === 'complete-1');
    window.mockNative.jobs.push({ ...source, id: 'complete-2', name: '두 번째 영상.mp4' });
    window.mockNative.cues['complete-2'] = [{ start: 7, end: 9, original: 'Second original', translated: '두 번째 결과만 저장' }];
    window.nativeEvent({ type: 'status' });
  });
  await page.waitForFunction(() => document.querySelector('#resultJobSelector option[value="complete-2"]'));
}

async function holdNextSave(page) {
  await page.evaluate(() => {
    const postMessage = window.Native.postMessage.bind(window.Native);
    window.Native.postMessage = (raw) => {
      if (JSON.parse(raw).method !== 'saveCues') return postMessage(raw);
      window.Native.postMessage = postMessage;
      window.heldSave = JSON.parse(raw);
      window.releaseSave = () => postMessage(raw);
    };
  });
}

async function assertFirstFold(page, selector) {
  const nav = await page.locator('.app-nav').boundingBox();
  for (const locator of await page.locator(selector).all()) {
    const box = await locator.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= nav.y, `${selector} must be actionable above the navigation without scrolling`);
  }
}

// Catches accidental exports/preview from the previously loaded editor instead of the selected result.
regression('results preview, edit and every export target the selected job without requiring an editor visit', async (page) => {
  await addSecondResult(page);
  await page.locator('#navResults').click();
  await page.locator('#resultJobSelector').selectOption('complete-2');
  await page.locator('#resultPreview').click();
  await page.waitForFunction(() => window.mockNative.calls.some((call) => call.method === 'preview'));
  assert.deepEqual(await page.evaluate(() => window.mockNative.calls.find((call) => call.method === 'preview').params), { jobId: 'complete-2', positionMs: 0 });
  assert.equal(await page.locator('#editorView').isVisible(), false);
  for (const format of ['SRT', 'VTT', 'JSON']) {
    await page.locator('#exportSection').getByRole('button', { name: `${format} 저장`, exact: true }).click();
    await page.waitForFunction((extension) => window.mockNative.calls.some((call) => call.method === 'export' && call.params.name.endsWith(extension)), `.${format.toLowerCase()}`);
  }
  const exports = await page.evaluate(() => window.mockNative.calls.filter((call) => call.method === 'export').map((call) => call.params));
  assert.deepEqual(exports.map((item) => item.name), ['두 번째 영상.srt', '두 번째 영상.vtt', '두 번째 영상.json']);
  for (const item of exports) assert.match(item.text, /두 번째 결과만 저장/);
  await page.locator('#editResult').click();
  await page.locator('#editorView').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#editorName').textContent(), '두 번째 영상.mp4');
  assert.equal(await page.locator('.cue textarea').first().inputValue(), 'Second original');
  assert.equal(await page.locator('#navResults').getAttribute('aria-current'), 'page');
});

// Catches lost edits when leaving the editor to save a result or changing the selected result.
regression('result navigation waits for dirty cues and switching results keeps the saved original job', async (page) => {
  await addSecondResult(page);
  await page.locator('#jobsView .job[data-job-id="complete-1"]').getByRole('button', { name: '자막 편집', exact: true }).click();
  await holdNextSave(page);
  await page.locator('.cue textarea').first().fill('결과 이동 전에 보존할 원문');
  await page.locator('#jumpToExport').click();
  await page.waitForFunction(() => window.heldSave);
  assert.equal(await page.locator('#editorView').isVisible(), true, 'pending save keeps the original editor available');
  assert.equal(await page.locator('#resultsView').isVisible(), false);
  await page.evaluate(() => window.releaseSave());
  await page.locator('#resultsView').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#resultJobSelector').inputValue(), 'complete-1');
  assert.equal(await page.locator('#exportSection').evaluate((node) => document.activeElement === node), true);
  await page.locator('#resultJobSelector').selectOption('complete-2');
  await page.locator('#exportSection').getByRole('button', { name: 'SRT 저장', exact: true }).click();
  await page.waitForFunction(() => window.mockNative.calls.some((call) => call.method === 'export'));
  assert.equal(await page.evaluate(() => window.mockNative.cues['complete-1'][0].original), '결과 이동 전에 보존할 원문');
  assert.equal(await page.evaluate(() => window.mockNative.cues['complete-2'][0].original), 'Second original');
  assert.match(await page.evaluate(() => window.mockNative.calls.find((call) => call.method === 'export').params.text), /두 번째 결과만 저장/);
});

// Catches any route bypassing the save-error guard and discarding the active draft.
regression('failed saves block all four tabs and result navigation until retry succeeds', async (page) => {
  await page.locator('#jobsView .job[data-job-id="complete-1"]').getByRole('button', { name: '자막 편집', exact: true }).click();
  await page.evaluate(() => { window.mockNative.failSave = true; });
  await page.locator('.cue textarea').first().fill('저장 실패 후 탭을 눌러도 보존');
  await page.locator('#retrySave').waitFor({ state: 'visible' });
  for (const selector of ['#navVideo', '#navJobs', '#navResults', '#navSettings', '#jumpToExport']) {
    await page.locator(selector).click();
    await page.waitForFunction((selector) => !document.querySelector(selector).disabled, selector);
    await page.waitForFunction(() => document.getElementById('appMessage').textContent.includes('테스트 저장 실패'));
    assert.equal(await page.locator('#editorView').isVisible(), true, `${selector} must not discard the draft`);
    assert.equal(await page.locator('.cue textarea').first().inputValue(), '저장 실패 후 탭을 눌러도 보존');
  }
  await page.evaluate(() => { window.mockNative.failSave = false; });
  await page.locator('#retrySave').click();
  await page.locator('#retrySave').waitFor({ state: 'hidden' });
  await page.locator('#navResults').click();
  await page.locator('#resultsView').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.mockNative.cues['complete-1'][0].original), '저장 실패 후 탭을 눌러도 보존');
});

// Catches unbounded history rendering and status polling unexpectedly returning the user to page one.
regression('job history renders four cards per page and polling preserves the selected page', async (page) => {
  await page.evaluate(() => {
    const completed = window.mockNative.jobs.find((job) => job.id === 'complete-1');
    window.mockNative.jobs.push(...Array.from({ length: 20 }, (_, index) => ({ ...completed, id: `history-${index}`, name: `완료 영상 ${index + 1}.mp4` })));
    window.nativeEvent({ type: 'status' });
  });
  await page.waitForFunction(() => document.querySelectorAll('#jobsView .job').length === 4);
  assert.equal(await page.locator('#jobsView .job').first().getAttribute('data-job-id'), 'partial-1');
  await page.locator('#nextJobs').click();
  const ids = await page.locator('#jobsView .job').evaluateAll((nodes) => nodes.map((node) => node.dataset.jobId));
  assert.match(await page.locator('#jobsPageInfo').textContent(), /2\s*\/\s*6/);
  await page.evaluate(() => { window.mockNative.jobs.find((job) => job.id === 'partial-1').progress.elapsedMs += 1000; window.nativeEvent({ type: 'status' }); });
  await page.waitForFunction(() => window.mockNative.calls.filter((call) => call.method === 'status').length >= 3);
  assert.deepEqual(await page.locator('#jobsView .job').evaluateAll((nodes) => nodes.map((node) => node.dataset.jobId)), ids);
  await page.locator('#navVideo').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await assertFirstFold(page, '#pickVideo');
  await page.locator('#navJobs').click();
  assert.deepEqual(await page.locator('#jobsView .job').evaluateAll((nodes) => nodes.map((node) => node.dataset.jobId)), ids);
  for (let next = 0; next < 4; next += 1) await page.locator('#nextJobs').click();
  assert.equal(await page.locator('#jobsView .job').count(), 2);
  assert.equal(await page.locator('#nextJobs').isDisabled(), true);
  await page.locator('#prevJobs').click();
  assert.equal(await page.locator('#jobsView .job').count(), 4);
  for (let previous = 0; previous < 4; previous += 1) await page.locator('#prevJobs').click();
  assert.equal(await page.locator('#prevJobs').isDisabled(), true);
  assert.match(await page.locator('#jobsPageInfo').textContent(), /1\s*\/\s*6/);
  assert.equal(await page.locator('#jobsView .job').count(), 4);
});

// Catches preparation controls growing the job list or start/resume targeting the wrong prepared job.
regression('prepared jobs remain bounded in video and start routes into job progress', async (page) => {
  await page.locator('#navVideo').click();
  await page.locator('#pickVideo').click();
  await page.locator('#preparedJobs .job[data-job-id="ready-1"]').waitFor();
  await page.locator('#pickVideo').click();
  await page.locator('#preparedJobs .job[data-job-id="ready-2"]').waitFor();
  assert.equal(await page.locator('#preparedJobs .job').count(), 1);
  await page.locator('#preparedJobSelector').selectOption('ready-1');
  await page.locator('#navJobs').click();
  const ready = page.locator('#jobsView .job[data-job-id="ready-1"]');
  assert.equal(await ready.locator('.prepared-settings:visible').count(), 0);
  await ready.getByRole('button', { name: '준비 확인', exact: true }).click();
  assert.equal(await page.locator('#videoView').isVisible(), true);
  assert.equal(await page.locator('#preparedJobSelector').inputValue(), 'ready-1');
  await page.locator('#preparedJobs .job[data-job-id="ready-1"]').getByRole('button', { name: '생성 시작', exact: true }).click();
  await page.locator('#jobsView').waitFor({ state: 'visible' });
  assert.deepEqual(await page.evaluate(() => window.mockNative.calls.filter((call) => call.method === 'resume').map((call) => call.params.jobId)), ['ready-1']);
  await page.locator('#jobsView .job[data-job-id="partial-1"]').getByRole('button', { name: '이어하기', exact: true }).click();
  await page.waitForFunction(() => window.mockNative.calls.filter((call) => call.method === 'resume').length === 2);
  assert.equal(await page.evaluate(() => window.mockNative.calls.filter((call) => call.method === 'resume').at(-1).params.jobId), 'partial-1');
});

// Catches hidden controls becoming unreachable and global settings/details expanding every landing screen.
regression('settings and editor tools start collapsed but retain access to their controls', async (page) => {
  await page.locator('#navSettings').click();
  for (const selector of ['#apiSettings', '#defaultSettings', '#dataSettings']) {
    assert.equal(await page.locator(selector).getAttribute('open'), null);
    await page.locator(`${selector} > summary`).click();
    assert.equal(await page.locator(selector).getAttribute('open'), '');
    await page.locator(`${selector} > summary`).click();
  }
  await page.locator('#defaultSettings > summary').click();
  await page.locator('#sourceLanguage').selectOption('ja');
  await page.locator('#settingsForm button[type="submit"]').click();
  await page.waitForFunction(() => window.mockNative.settings.sourceLanguage === 'ja');
  await page.locator('#navJobs').click();
  await page.locator('#jobsView .job[data-job-id="complete-1"]').getByRole('button', { name: '자막 편집', exact: true }).click();
  assert.equal(await page.locator('#editorTools').getAttribute('open'), null);
  assert.equal(await page.locator('#cueSearch').isVisible(), false);
  await page.locator('#editorTools > summary').click();
  await page.locator('#cueJump').fill('#27');
  await page.locator('#jumpForm button').click();
  assert.equal(await page.locator('.cue-summary[aria-expanded="true"]').locator('..').getAttribute('data-index'), '26');
});

// Catches first-run users being stranded behind collapsed API setup or an empty result screen.
regression('first run opens API setup and empty results route to adding a video', async (page) => {
  await page.addInitScript(() => { window.mockNative.hasKey = false; window.mockNative.jobs = []; });
  await page.reload();
  await page.locator('#videoView').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#pickVideo').isDisabled(), true);
  await page.locator('#navSettings').click();
  assert.equal(await page.locator('#apiSettings').getAttribute('open'), '');
  assert.equal(await page.locator('#apiKey').isVisible(), true);
  assert.equal(await page.locator('#defaultSettings').getAttribute('open'), null);
  await page.locator('#navResults').click();
  await page.locator('#resultEmpty').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#exportSection').isVisible(), false);
  await page.locator('#openResultVideo').click();
  await page.locator('#videoView').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#pickVideo').isVisible(), true);
});

// Catches a pending result load reopening an obsolete destination after the user selects another tab.
regression('a delayed result load cannot override a newer tab selection', async (page) => {
  await page.evaluate(() => { window.mockNative.methodDelays = { loadJob: 300 }; });
  await page.locator('#navResults').click();
  await page.waitForFunction(() => window.mockNative.calls.some((call) => call.method === 'loadJob'));
  await page.locator('#navSettings').click();
  await page.locator('#settingsView').waitFor({ state: 'visible' });
  await page.waitForTimeout(400); // Wait beyond the deliberately delayed native response.
  assert.equal(await page.locator('#settingsView').isVisible(), true);
  assert.equal(await page.locator('#resultsView').isVisible(), false);
  assert.equal(await page.locator('#navSettings').getAttribute('aria-current'), 'page');
});

// Catches inconsistent selected-job data when a slow selection is followed by another selection.
regression('successive result selections keep the latest job after a slow load', async (page) => {
  await addSecondResult(page);
  await page.locator('#navResults').click();
  await page.locator('#resultJobSelector').selectOption('partial-1');
  await page.waitForFunction(() => document.getElementById('resultName').textContent === '이어하기 테스트.mp4');
  await page.evaluate(() => {
    const postMessage = window.Native.postMessage.bind(window.Native);
    window.Native.postMessage = (raw) => {
      const call = JSON.parse(raw);
      if (call.method === 'loadJob') window.mockNative.methodDelays = { loadJob: call.params.jobId === 'complete-1' ? 300 : 20 };
      postMessage(raw);
    };
  });
  await page.locator('#resultJobSelector').selectOption('complete-1');
  assert.equal(await page.locator('#resultJobSelector').isDisabled(), true, 'slow loading locks selection until its response is handled');
  assert.equal(await page.locator('#editResult').isDisabled(), true, 'loading must not allow editing the previous selection');
  assert.equal(await page.locator('#resultPreview').isDisabled(), true, 'loading must not preview the previous selection');
  for (const button of await page.locator('#exportSection [data-export]').all()) assert.equal(await button.isDisabled(), true, 'loading must not export the previous selection');
  await page.locator('#resultJobSelector').selectOption('complete-2');
  await page.waitForFunction(() => document.getElementById('resultName').textContent === '두 번째 영상.mp4');
  await page.waitForTimeout(400); // The older request must now have also completed.
  assert.equal(await page.locator('#resultJobSelector').inputValue(), 'complete-2');
  assert.equal(await page.locator('#resultName').textContent(), '두 번째 영상.mp4');
  await page.locator('#exportSection').getByRole('button', { name: 'SRT 저장', exact: true }).click();
  await page.waitForFunction(() => window.mockNative.calls.some((call) => call.method === 'export'));
  assert.match(await page.evaluate(() => window.mockNative.calls.find((call) => call.method === 'export').params.text), /두 번째 결과만 저장/);
});

// Catches results keeping an obsolete partial snapshot after native persistence or completion.
regression('the selected partial result refreshes saved cues and becomes editable on completion', async (page) => {
  await page.locator('#navResults').click();
  await page.locator('#resultJobSelector').selectOption('partial-1');
  await page.waitForFunction(() => document.getElementById('resultName').textContent === '이어하기 테스트.mp4');
  await page.evaluate(() => {
    const job = window.mockNative.jobs.find((job) => job.id === 'partial-1');
    window.mockNative.cues[job.id].push({ start: 6, end: 8, original: 'Newest original', translated: '새로 저장된 세 번째 자막' });
    job.progress.lastSavedAt += 1000;
    window.nativeEvent({ type: 'status' });
  });
  await page.waitForFunction(() => document.getElementById('resultMeta').textContent.includes('자막 3개'));
  assert.equal(await page.locator('#resultJobSelector').inputValue(), 'partial-1');
  await page.locator('#exportSection').getByRole('button', { name: 'SRT 저장', exact: true }).click();
  await page.waitForFunction(() => window.mockNative.calls.some((call) => call.method === 'export'));
  assert.match(await page.evaluate(() => window.mockNative.calls.find((call) => call.method === 'export').params.text), /새로 저장된 세 번째 자막/);
  await page.evaluate(() => {
    const job = window.mockNative.jobs.find((job) => job.id === 'partial-1');
    job.status = 'completed'; job.stage = 'completed'; job.completedChunks = 22;
    window.nativeEvent({ type: 'status' });
  });
  await page.waitForFunction(() => document.getElementById('resultMeta').textContent.includes('완료'));
  await page.locator('#editResult').click();
  await page.locator('#editorView').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.cue textarea').first().isDisabled(), false);
  assert.equal(await page.locator('#cueCount').textContent(), '3개');
});

// Catches completing metadata enabling edits before the final native cue snapshot arrives.
regression('completion keeps editing locked until the final saved cues arrive', async (page) => {
  await page.locator('#navResults').click();
  await page.locator('#resultJobSelector').selectOption('partial-1');
  await page.waitForFunction(() => document.getElementById('resultName').textContent === '이어하기 테스트.mp4');
  await page.locator('#navJobs').click();
  const previousLoads = await page.evaluate(() => window.mockNative.calls.filter((call) => call.method === 'loadJob').length);
  await page.evaluate(() => {
    const job = window.mockNative.jobs.find((job) => job.id === 'partial-1');
    window.mockNative.cues[job.id].push({ start: 6, end: 8, original: 'Final original', translated: '보존해야 할 마지막 자막' });
    job.status = 'completed'; job.stage = 'completed'; job.completedChunks = 22;
    job.progress.lastSavedAt += 1000;
    window.mockNative.methodDelays = { loadJob: 700 };
    window.nativeEvent({ type: 'status' });
  });
  await page.waitForFunction((count) => window.mockNative.calls.filter((call) => call.method === 'loadJob').length > count, previousLoads);
  await page.locator('#navResults').click();
  await page.locator('#resultsView').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#editResult').isDisabled(), true, 'final metadata must not make the old partial snapshot editable');
  for (const button of await page.locator('#exportSection [data-export]').all()) assert.equal(await button.isDisabled(), true);
  await page.waitForFunction(() => document.getElementById('resultMeta').textContent.includes('자막 3개'));
  await page.locator('#editResult').click();
  await page.locator('.cue textarea').first().fill('완료 후 안전하게 편집한 원문');
  await page.waitForFunction(() => window.mockNative.cues['partial-1'][0].original === '완료 후 안전하게 편집한 원문');
  assert.equal(await page.evaluate(() => window.mockNative.cues['partial-1'].length), 3);
  assert.equal(await page.evaluate(() => window.mockNative.cues['partial-1'][2].translated), '보존해야 할 마지막 자막');
});

// Catches a failed final snapshot being treated as current forever, preventing recovery on the next poll.
regression('a failed completion refresh retries and retains the final cue on the next status update', async (page) => {
  await page.locator('#navResults').click();
  await page.locator('#resultJobSelector').selectOption('partial-1');
  await page.waitForFunction(() => document.getElementById('resultName').textContent === '이어하기 테스트.mp4');
  await page.evaluate(() => {
    const job = window.mockNative.jobs.find((job) => job.id === 'partial-1');
    window.mockNative.cues[job.id].push({ start: 6, end: 8, original: 'Recovered final original', translated: '재시도 후 마지막 자막' });
    job.status = 'completed'; job.stage = 'completed'; job.completedChunks = 22;
    job.progress.lastSavedAt += 1000;
    const postMessage = window.Native.postMessage.bind(window.Native);
    window.Native.postMessage = (raw) => {
      const call = JSON.parse(raw);
      if (call.method !== 'loadJob') return postMessage(raw);
      window.Native.postMessage = postMessage;
      window.mockNative.calls.push(call);
      setTimeout(() => window.nativeResult({ id: call.id, error: '테스트 완료 자막 로드 실패' }), 20);
    };
    window.nativeEvent({ type: 'status' });
  });
  await page.waitForFunction(() => document.getElementById('appMessage').textContent.includes('테스트 완료 자막 로드 실패'));
  const incorrectlyEditable = (await page.locator('#resultMeta').textContent()).includes('완료') && !(await page.locator('#editResult').isDisabled());
  assert.equal(incorrectlyEditable, false, 'failed loading must not expose a stale completed editor');
  await page.evaluate(() => window.nativeEvent({ type: 'status' }));
  await page.waitForFunction(() => document.getElementById('resultMeta').textContent.includes('자막 3개'));
  await page.locator('#editResult').click();
  await page.locator('.cue textarea').first().fill('복구 후 편집');
  await page.waitForFunction(() => window.mockNative.cues['partial-1'][0].original === '복구 후 편집');
  assert.equal(await page.evaluate(() => window.mockNative.cues['partial-1'].length), 3);
});

// Captures responsive layouts while asserting usable first-fold actions and bounded default page height.
regression('four tabs and the editor remain usable at 320, 390 and 800 pixels', async (page) => {
  const measurements = [];
  for (const width of [320, 390, 800]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [button, view] of tabs) {
      await page.locator(`#${button}`).click();
      await page.locator(`#${view}`).waitFor({ state: 'visible' });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${view} overflow at ${width}px`);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      measurements.push({ width, view, height });
      if (width === 390) assert.ok(height <= 1100, `${view} must remain compact at 390px, got ${height}px`);
      const primary = { videoView: '#pickVideo', jobsView: '#jobsView .job:first-child .job-actions button', resultsView: '#exportSection button', settingsView: '#apiSettings > summary' }[view];
      await assertFirstFold(page, primary);
      await page.screenshot({ path: join(artifacts, `${view}-${width}.png`), fullPage: true });
      if (width === 390) await page.screenshot({ path: join(artifacts, `${view}-viewport-${width}.png`) });
    }
    await page.locator('#navJobs').click();
    await page.locator('#jobsView .job[data-job-id="complete-1"]').getByRole('button', { name: '자막 편집', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.locator('.cue').count(), 12);
    assert.equal(await page.locator('.cue-detail').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `editor overflow at ${width}px`);
    measurements.push({ width, view: 'editorView', height: await page.evaluate(() => document.documentElement.scrollHeight) });
    await assertFirstFold(page, '#jumpToExport');
    await page.screenshot({ path: join(artifacts, `editorView-${width}.png`), fullPage: true });
    if (width === 390) await page.screenshot({ path: join(artifacts, `editorView-viewport-${width}.png`) });
  }
  await writeFile(join(artifacts, 'viewport-measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`);
});
