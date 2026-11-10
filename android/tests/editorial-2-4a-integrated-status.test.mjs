import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const output = join(root, 'output/editorial-4a');

test('4-A preserves status, error, recovery, and destructive-confirmation contracts', async () => {
  const [web, native, html] = await Promise.all([
    readFile(join(root, 'src/app.js'), 'utf8'),
    readFile(join(root, 'android/web/app.js'), 'utf8'),
    readFile(join(root, 'android/web/index.html'), 'utf8'),
  ]);
  assert.match(web, /function setRunState\(runState\)/);
  assert.match(web, /function showError\(message\)/);
  assert.match(web, /function retryTranslation\(\)/);
  assert.match(web, /function renderTranslationRecovery\(\)/);
  assert.match(web, /function renderDownloads\(subtitles\)/);
  assert.match(native, /notice\.setAttribute\('role', error \? 'alert' : 'status'\)/);
  assert.match(native, /focusJobAction\(job\.id, '삭제 확인'\)/);
  assert.match(native, /focusJobAction\(job\.id, '기록 삭제'\)/);
  assert.match(native, /pendingDeletionId = '';/);
  assert.match(native, /async function flushSave\(\)/);
  assert.match(native, /async function deleteCompletedJob\(jobId\)/);
  for (const id of ['messageBar', 'appMessage', 'dismissMessage', 'confirmClearKey', 'cancelClearKey',
    'confirmClearReviewRelay', 'cancelClearReviewRelay', 'retrySave', 'saveStatus', 'resultExportStatus']) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, 'missing/duplicate ' + id);
  }
  assert.match(html, /id="appMessage"[^>]+role="status"/);
  assert.match(html, /id="saveStatus" role="status"/);
});

async function withNative(action) {
  const routes = {
    '/': 'android/web/index.html', '/styles.css': 'android/web/styles.css',
    '/app.js': 'android/web/app.js',
    '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
    '/shared/core.js': 'src/core.js',
    '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
    '/shared/edit-history.js': 'src/edit-history.js',
    '/shared/subtitle-player.js': 'src/subtitle-player.js',
  };
  const server = createServer(async (request, response) => {
    const file = routes[new URL(request.url, 'http://localhost').pathname];
    if (!file) { response.writeHead(404).end(); return; }
    try {
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8'
        : file.endsWith('.css') ? 'text/css; charset=utf-8'
        : file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
      response.end(await readFile(join(root, file)));
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, colorScheme: 'light', locale: 'ko-KR',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(13000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() =>
      window.mockNative?.calls.some(call => call.method === 'status') &&
      Boolean(document.querySelector('#jobList .job[data-job-id="complete-1"]'))
    );
    await action(page);
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

test('4-A Android status, export cancel, and deletion confirmations preserve records and keyboard focus', { skip: !enabled }, async () => {
  await withNative(async page => {
    await page.evaluate(() => window.nativeEvent({ type: 'error', message: '테스트 네트워크 오류' }));
    await page.locator('#messageBar').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#appMessage').getAttribute('role'), 'alert');
    assert.match(await page.locator('#appMessage').innerText(), /테스트 네트워크 오류/);
    await page.locator('#dismissMessage').click();
    assert.equal(await page.locator('#messageBar').isVisible(), false);
    assert.equal(await page.locator('#appMessage').getAttribute('role'), 'status');

    await page.locator('#navSettings').click();
    await page.locator('#settingsOpenConnection').click();
    await page.locator('#requestClearKey').click();
    assert.equal(await page.locator('#confirmClearKey').isVisible(), true);
    assert.equal(await page.locator('#cancelClearKey').evaluate(node => node === document.activeElement), true);
    assert.match(await page.locator('#confirmClearKey').innerText(), /저장된 자막은 유지/);
    await page.locator('#cancelClearKey').click();
    assert.equal(await page.locator('#confirmClearKey').isVisible(), false);
    assert.equal(await page.locator('#requestClearKey').evaluate(node => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => window.mockNative.calls.filter(call => call.method === 'clearKey').length), 0);

    await page.locator('#navResults').click();
    await page.locator('#resultContent').waitFor({ state: 'visible' });
    await page.evaluate(() => { window.mockNative.cancelNextExport = true; });
    await page.locator('#exportSection [data-export="srt"]').click();
    await page.waitForFunction(() => document.querySelector('#resultExportStatus').textContent.includes('취소했습니다'));
    assert.match(await page.locator('#resultExportStatus').innerText(), /파일 저장을 취소/);
    await page.locator('#exportSection [data-export="srt"]').click();
    await page.waitForFunction(() => document.querySelector('#resultExportStatus').textContent.includes('저장했습니다'));
    assert.match(await page.locator('#resultExportStatus').innerText(), /SRT 파일을 저장/);

    await page.locator('#navJobs').click();
    const card = page.locator('#jobList .job[data-job-id="complete-1"]');
    await card.getByRole('button', { name: '기록 삭제', exact: true }).click();
    assert.match(await card.locator('.delete-warning').innerText(), /원본 영상은 삭제하지 않습니다/);
    const confirm = card.getByRole('button', { name: '삭제 확인', exact: true });
    assert.equal(await confirm.evaluate(node => node === document.activeElement), true,
      'Opening confirmation must move keyboard focus to its new action');
    assert.equal(await page.evaluate(() => window.mockNative.calls.filter(call => call.method === 'deleteJob').length), 0);
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, '4a-native-delete-confirm-light.png'), fullPage: true });

    await card.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(await card.getByRole('button', { name: '기록 삭제', exact: true })
      .evaluate(node => node === document.activeElement), true,
    'Cancelling confirmation must return focus to record-delete button');
    assert.equal(await page.evaluate(() => window.mockNative.jobs.some(j => j.id === 'complete-1')), true);
    await card.getByRole('button', { name: '기록 삭제', exact: true }).click();
    await card.getByRole('button', { name: '삭제 확인', exact: true }).click();
    await page.waitForFunction(() => !window.mockNative.jobs.some(j => j.id === 'complete-1'));
    assert.equal(await page.locator('#jobList .job[data-job-id="complete-1"]').count(), 0);
    assert.equal(await page.evaluate(() => window.mockNative.jobs.some(j => j.id === 'partial-1')), true,
      'Other job records must be retained');
    assert.equal(await page.evaluate(() => window.mockNative.calls.filter(call => call.method === 'deleteJob').length), 1);
    assert.match(await page.locator('#appMessage').innerText(), /원본 영상은 유지됩니다/);
    assert.equal(await page.locator('#appMessage').getAttribute('role'), 'status');
  });
});

test('4-A Android save failure blocks navigation until retry and keeps unsaved text intact', { skip: !enabled }, async () => {
  await withNative(async page => {
    await page.locator('#jobList .job[data-job-id="complete-1"]')
      .getByRole('button', { name: '자막 편집', exact: true }).click();
    await page.locator('#editorView .cue.selected textarea').first().waitFor({ state: 'visible' });
    await page.evaluate(() => { window.mockNative.failSave = true; });
    const input = page.locator('#editorView .cue.selected textarea').first();
    await input.fill('통합 검증 · 저장 실패 후 입력 보존');
    await page.locator('#retrySave').waitFor({ state: 'visible', timeout: 10000 });
    assert.match(await page.locator('#saveStatus').innerText(), /저장 실패 · 입력은 유지/);
    assert.equal(await input.inputValue(), '통합 검증 · 저장 실패 후 입력 보존');
    assert.match(await page.locator('#editorView').innerText(), /저장 다시 시도/);
    const persisted = await page.evaluate(() => window.mockNative.cues['complete-1'][0].original);
    assert.notEqual(persisted, '통합 검증 · 저장 실패 후 입력 보존');

    await page.locator('#navJobs').click();
    assert.equal(await page.locator('#editorView').isVisible(), true,
      'Failed persistence must not discard the editor state');
    assert.equal(await page.locator('#appMessage').getAttribute('role'), 'alert');
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, '4a-native-save-error-light.png'), fullPage: true });

    await page.evaluate(() => { window.mockNative.failSave = false; });
    await page.locator('#retrySave').click();
    await page.waitForFunction(() => document.getElementById('saveStatus').textContent === '기기에 저장됨');
    assert.equal(await page.locator('#retrySave').isVisible(), false);
    assert.equal(await page.evaluate(() => window.mockNative.cues['complete-1'][0].original),
      '통합 검증 · 저장 실패 후 입력 보존');
    await page.locator('#navJobs').click();
    assert.equal(await page.locator('#jobsView').isVisible(), true);
  });
});
