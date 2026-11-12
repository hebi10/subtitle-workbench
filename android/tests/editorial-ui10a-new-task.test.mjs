import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const output = join(root, 'output/editorial-2-2a');

const routes = {
  '/': 'android/web/index.html',
  '/styles.css': 'android/web/styles.css',
  '/app.js': 'android/web/app.js',
  '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
  '/shared/core.js': 'src/core.js',
  '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
  '/shared/edit-history.js': 'src/edit-history.js',
  '/shared/subtitle-player.js': 'src/subtitle-player.js',
};

async function withNativeFixture(callback) {
  const server = createServer(async (request, response) => {
    const file = routes[new URL(request.url, 'http://localhost').pathname];
    if (!file) { response.writeHead(404).end(); return; }
    try {
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(file)];
      response.setHeader('Content-Type', type + (type === 'image/png' ? '' : '; charset=utf-8'));
      response.end(await readFile(join(root, file)));
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, locale: 'ko-KR', colorScheme: 'light',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => window.mockNative?.calls.some(item => item.method === 'status'));
    await callback(page);
    assert.deepEqual(errors, [], 'UI-10-A must not introduce WebView JavaScript errors');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
}

test('UI-10-A preserves each existing Native Bridge action and makes mode prerequisites explicit', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'android/web/app.js'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
  ]);
  const view = html.slice(html.indexOf('<section id="videoView"'), html.indexOf('<section id="jobsView"'));
  for (const id of [
    'firstRunGuide', 'guideFile', 'guideMic', 'guideOffline', 'dismissFirstRunGuide',
    'sourceChoices', 'chooseFile', 'chooseMicrophone', 'chooseOffline',
    'pickVideo', 'importSubtitles', 'openConnection', 'connectionSummary', 'videoSettingsSummary',
    'preparedJobsHeading', 'preparedJobLabel', 'preparedJobs', 'openOnDevice', 'openCloudLive', 'openOfflineModel',
  ]) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  assert.ok(view.indexOf('id="firstRunGuide"') < view.indexOf('id="sourceChoices"'));
  assert.ok(view.indexOf('id="preparedJobs"') < view.indexOf('id="microphoneHeading"'));
  assert.match(view, /id="firstRunGuide"[^>]*hidden/);
  assert.match(view, /<details class="first-run-requirements">/);
  assert.match(view, /개인 API 없이/);
  assert.match(view, /테스트 서버 연결/);
  assert.match(view, /SRT·VTT·JSON은 API 없이 불러올 수 있습니다/);
  assert.match(view, /모델 다운로드에는 인터넷이 필요/);
  assert.match(css, /#videoView #firstRunGuide:not\(\[hidden\]\) \+ #sourceChoices\s*\{\s*display:\s*none/);
  assert.match(js, /firstRunDismissed \|\| jobs\.length > 0/);
  assert.match(js, /function selectSource\(mode\)/);
  assert.match(js, /function focusFileSource\(\)[\s\S]*?if \(\$\('pickVideo'\)\.disabled\)/);
  assert.match(js, /void openSettings\(\)/);
  assert.match(js, /\$\('openOnDevice'\)\.focus\(\)/);
  assert.match(js, /\$\('openOfflineModel'\)\.focus\(\)/);
  assert.match(js, /\$\('preparedJobsHeading'\)\.hidden = prepared\.length === 0/);
  assert.match(js, /\$\('keyHint'\)\.hidden = connection\.hasKey && !connectionError/);
  assert.match(css, /#videoView \.first-run-actions button\[aria-pressed="true"\]/);
  for (const phrase of ['7일 보관', '이번 달 $2.34', 'whisper-small-kr', '161 MB']) {
    assert.ok(!view.includes(phrase), 'do not hardcode illustrative data: ' + phrase);
  }
});

test('UI-10-A first-use guide selects free paths without creating paid requests', { skip: !enabled }, async () => {
  await withNativeFixture(async page => {
    await page.evaluate(() => {
      window.mockNative.jobs = [];
      window.mockNative.hasPersonalKey = false;
      window.mockNative.keyCheck = null;
      window.nativeEvent({ type: 'status' });
    });
    await page.waitForFunction(() => !document.querySelector('#firstRunGuide').hidden &&
      document.querySelector('#chooseFileStatus').textContent.includes('API 연결 필요'));
    await page.locator('#navVideo').click();
    assert.equal(await page.locator('#firstRunGuide').isVisible(), true);
    assert.equal(await page.locator('#sourceChoices').isVisible(), false);
    assert.equal(await page.locator('.first-run-requirements').evaluate(x => x.open), false);
    assert.equal(await page.locator('#preparedJobsHeading').isVisible(), false);
    assert.equal(await page.locator('#importSubtitles').isEnabled(), true);
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, 'ui10a-first-use-light-390.png'), fullPage: true });

    await page.locator('#guideMic').click();
    assert.equal(await page.locator('#openOnDevice').evaluate(x => x === document.activeElement), true);
    assert.equal(await page.locator('#guideMic').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.microphone-source').evaluate(x => x.classList.contains('source-selected')), true);
    await page.locator('#guideOffline').click();
    assert.equal(await page.locator('#openOfflineModel').evaluate(x => x === document.activeElement), true);
    assert.equal(await page.locator('.local-offline-entry').evaluate(x => x.open), true);
    assert.equal(await page.locator('#guideOffline').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.mockNative.calls.some(x =>
      ['openOnDevice', 'openCloudLive', 'openOfflineModel', 'pickVideo'].includes(x.method))), false,
      'mode selection changes focus, never starts transcription or media import');

    await page.locator('#guideFile').click();
    assert.equal(await page.locator('#settingsView').isVisible(), true,
      'when no API credentials are saved, selecting file preserves connection-first routing');
    assert.equal(await page.locator('#apiSettings').evaluate(x => x.open), true);
    assert.equal(await page.evaluate(() => window.mockNative.calls.some(x => x.method === 'pickVideo')), false);
    await page.locator('#navVideo').click();
    await page.locator('#importSubtitles').click();
    await page.waitForFunction(() => window.mockNative.calls.some(x => x.method === 'importSubtitles'));
  });
});

test('UI-10-A returning user gets one source selector, real prepared jobs and responsive actions', { skip: !enabled }, async () => {
  await withNativeFixture(async page => {
    await page.locator('#navVideo').click();
    assert.equal(await page.locator('#firstRunGuide').isVisible(), false);
    assert.equal(await page.locator('#sourceChoices').isVisible(), true);
    assert.equal(await page.locator('#chooseFile').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#pickVideo').isEnabled(), true);
    assert.equal(await page.locator('#preparedJobsHeading').isVisible(), false);

    await page.locator('#chooseOffline').click();
    assert.equal(await page.locator('#chooseOffline').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#chooseFile').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#openOfflineModel').evaluate(x => x === document.activeElement), true);
    await page.locator('#chooseMicrophone').click();
    assert.equal(await page.locator('#openOnDevice').evaluate(x => x === document.activeElement), true);
    await page.locator('#chooseFile').click();
    assert.equal(await page.locator('#pickVideo').evaluate(x => x === document.activeElement), true);

    await page.evaluate(() => {
      const template = window.mockNative.jobs.find(x => x.id === 'partial-1');
      window.mockNative.jobs.push({
        ...template, id: 'ready-ui10', name: '준비된 영상.mp4', status: 'paused',
        stage: 'ready', completedChunks: 0, totalChunks: 0,
        progress: { ...template.progress, percent: 0 },
      });
      window.nativeEvent({ type: 'status' });
    });
    await page.waitForFunction(() => !document.querySelector('#preparedJobsHeading').hidden);
    assert.equal(await page.locator('#preparedJobsHeading').isVisible(), true);
    assert.match(await page.locator('#preparedJobs').innerText(), /준비된 영상\.mp4/);

    await mkdir(output, { recursive: true });
    for (const width of [320, 390, 800]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        const geometry = await page.evaluate(() => ({
          viewport: innerWidth,
          doc: document.documentElement.scrollWidth,
          actions: [...document.querySelectorAll('#videoView .source-choice-grid button')]
            .map(x => ({ height: x.getBoundingClientRect().height, width: x.getBoundingClientRect().width })),
          button: document.querySelector('#importSubtitles').getBoundingClientRect().height,
        }));
        assert.ok(geometry.doc <= geometry.viewport + 1, width + '/' + theme + ': no horizontal overflow');
        assert.ok(geometry.actions.every(x => x.height >= 48 && x.width > 0),
          width + '/' + theme + ': source choices remain reachable');
        assert.ok(geometry.button >= 48, width + '/' + theme + ': subtitle import is reachable');
        if (width === 390) {
          await page.screenshot({
            path: join(output, 'ui10a-returning-' + width + '-' + theme + '.png'), fullPage: true,
          });
        }
      }
    }
  });
});
