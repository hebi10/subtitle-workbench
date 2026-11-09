import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { before, after } from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const screenshots = join(root, 'output/editorial-3a');
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
let server;
let browser;
let baseUrl;

before(async () => {
  if (!enabled) return;
  await mkdir(screenshots, { recursive: true });
  const files = {
    '/': 'android/web/index.html',
    '/styles.css': 'android/web/styles.css',
    '/app.js': 'android/web/app.js',
    '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
    '/shared/core.js': 'src/core.js',
    '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
    '/shared/edit-history.js': 'src/edit-history.js',
    '/shared/subtitle-player.js': 'src/subtitle-player.js',
  };
  server = createServer(async (req, res) => {
    const path = files[new URL(req.url, 'http://localhost').pathname];
    if (!path) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type', path.endsWith('.png') ? 'image/png' :
        path.endsWith('.css') ? 'text/css; charset=utf-8' :
        path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
      res.end(await readFile(join(root, path)));
    } catch { res.writeHead(500).end(); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
});

async function withApp(width, theme, action) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme, locale: 'ko-KR' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
  try {
    await page.goto(baseUrl);
    await page.locator('#jobsView .job').first().waitFor();
    await action(page);
    assert.deepEqual(errors, [], 'UI should not throw during the verified flow');
  } finally {
    await context.close();
  }
}

function checkViewport(page, label) {
  return page.evaluate(() => {
    const nav = document.querySelector('.app-nav').getBoundingClientRect();
    const active = document.querySelector('.app-nav [aria-current="page"]');
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      active: active?.id,
      navTop: nav.top,
      navHeight: nav.height,
    };
  }).then((m) => {
    assert.equal(m.overflow, false, label + ' horizontal overflow');
    assert.ok(m.active, label + ' must have one selected nav');
    assert.ok(m.navTop > 0 && m.navHeight >= 48, label + ' navigation visible');
    return m;
  });
}

test('3-A input sources group the connection with the file path, without changing actions', { skip: !enabled }, async () => {
  await withApp(390, 'light', async (page) => {
    await page.locator('#navVideo').click();
    assert.equal(await page.locator('#fileSourceHeading').innerText(), '파일에서 자막 만들기');
    assert.equal(await page.locator('#microphoneHeading').innerText(), '마이크 자막');
    assert.equal(await page.locator('#videoView .file-source #connectionCard').count(), 1);
    assert.equal(await page.locator('#videoView .file-source #preparedJobs').count(), 1);
    assert.equal(await page.locator('#videoView .microphone-source .local-caption-entry').count(), 2);
    assert.equal(await page.locator('#videoView .file-source').evaluate(
      (node) => node.compareDocumentPosition(document.getElementById('microphoneHeading')) & Node.DOCUMENT_POSITION_FOLLOWING), 4);
    const nav = await checkViewport(page, 'video');
    const pick = await page.locator('#pickVideo').boundingBox();
    assert.ok(pick && pick.y + pick.height <= nav.navTop, 'file selection stays in first fold');
    assert.equal(await page.getByRole('button', { name: '자막 불러오기', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '온디바이스 마이크 자막', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'API 연결 설정', exact: true }).click();
    assert.equal(await page.locator('#settingsView').isVisible(), true);
  });
});

test('3-A jobs provide accurate counts, progress and status-dependent primary actions', { skip: !enabled }, async () => {
  await withApp(390, 'light', async (page) => {
    await page.locator('#navJobs').click();
    assert.match(await page.locator('#jobsSummary').innerText(), /전체 2개 · 진행 0 · 준비 0 · 완료 1/);
    const paused = page.locator('#jobsView .job[data-job-id="partial-1"]');
    const complete = page.locator('#jobsView .job[data-job-id="complete-1"]');
    assert.equal(await paused.locator('.job-card-heading h3').innerText(), '강의 영상.mp4');
    assert.equal(await paused.locator('.job-state span').first().innerText(), '일시정지');
    assert.equal(await paused.locator('progress').getAttribute('value'), '12.5');
    assert.equal(await paused.getByRole('button', { name: '이어하기', exact: true }).evaluate(
      (node) => node.classList.contains('primary')), true);
    assert.equal(await complete.getByRole('button', { name: '자막 편집', exact: true }).evaluate(
      (node) => node.classList.contains('primary')), true);
    await complete.getByRole('button', { name: '기록 삭제', exact: true }).click();
    assert.match(await complete.locator('.delete-warning').innerText(), /원본 영상은 삭제하지 않습니다/);
    assert.equal(await complete.getByRole('button', { name: '삭제 확인', exact: true }).evaluate(
      (node) => node.classList.contains('danger')), true);
    await complete.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(await complete.locator('.delete-warning').count(), 0);
  });
});

test('3-A results keep edit icon, read-only label and export destination after refresh', { skip: !enabled }, async () => {
  await withApp(390, 'dark', async (page) => {
    await page.locator('#navResults').click();
    await page.locator('#resultJobSelector').selectOption('complete-1');
    await page.waitForFunction(() => document.getElementById('resultMeta').textContent.includes('자막'));
    assert.equal(await page.locator('#resultsView .result-overview').count(), 1);
    assert.equal(await page.locator('#editResult .es-icon--edit').count(), 1);
    assert.equal(await page.getByRole('button', { name: '자막 편집', exact: true }).count(), 1);
    await page.evaluate(() => window.nativeEvent({ type: 'status' }));
    await page.waitForFunction(() => document.getElementById('resultName').textContent !== '');
    assert.equal(await page.locator('#editResult .es-icon--edit').count(), 1);
    for (const ext of ['SRT', 'VTT', 'JSON']) {
      await page.getByRole('button', { name: ext + ' 저장', exact: true }).click();
    }
    await page.waitForFunction(() => window.mockNative.calls.filter((call) => call.method === 'export').length >= 3);
    assert.deepEqual(await page.evaluate(() => window.mockNative.calls.filter(
      (call) => call.method === 'export').slice(-3).map((call) => call.params.name.split('.').at(-1))), ['srt', 'vtt', 'json']);
    await page.locator('#resultJobSelector').selectOption('partial-1');
    await page.waitForFunction(() => document.getElementById('resultName').textContent.includes('강의'));
    assert.equal(await page.getByRole('button', { name: '자막 보기', exact: true }).count(), 1);
    assert.equal(await page.locator('#editResult .es-icon--edit').count(), 1);
  });
});

test('3-A visual first-fold and responsive layouts, light/dark, preserve native UI contracts', { skip: !enabled }, async () => {
  await withApp(390, 'light', async (page) => {
    for (const width of [320, 390, 800]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme });
        for (const [target, section, action] of [
          ['navVideo','videoView','#pickVideo'],
          ['navJobs','jobsView','#jobsView .job:first-child .job-actions button'],
          ['navResults','resultsView','#exportSection button'],
        ]) {
          await page.locator('#' + target).click();
          const nav = await checkViewport(page, section + '-' + width + '-' + theme);
          const bounds = await page.locator(action).first().boundingBox();
          assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= nav.navTop,
            section + ' primary action must be above bottom navigation at ' + width + '-' + theme);
          if (width === 390 || width === 800) {
            await page.screenshot({
              path: join(screenshots, section + '-' + width + '-' + theme + '.png'),
              fullPage: false, animations: 'disabled',
            });
          }
        }
      }
    }
  });
});
