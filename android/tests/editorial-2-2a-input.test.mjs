import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);

test('2-A separates file, microphone, and Vosk without changing Native IDs', async () => {
  const [html, css, js] = await Promise.all([
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
    readFile(join(root, 'android/web/app.js'), 'utf8'),
  ]);
  const view = html.slice(html.indexOf('<section id="videoView"'), html.indexOf('<section id="jobsView"'));
  const file = view.indexOf('<section class="file-source');
  const microphone = view.indexOf('<section class="microphone-source');
  const offline = view.indexOf('<section class="offline-source');
  assert.ok(file >= 0 && file < microphone && microphone < offline);
  assert.ok(view.indexOf('id="preparedJobs"') < microphone);
  assert.ok(view.indexOf('id="openOfflineModel"') > offline);
  for (const id of ['videoView','videoHeading','firstRunGuide','fileSourceHeading','pickVideo','importSubtitles',
    'connectionCard','connectionSummary','openConnection','keyHint','cloudTransmissionNotice',
    'openDefaultSettings','videoSettingsSummary','preparedJobLabel','preparedJobs',
    'microphoneHeading','openOnDevice','openCloudLive','cloudLiveNotice','offlineHeading','openOfflineModel']) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  assert.match(view, /id="fileSourceHeading">파일에서 자막 만들기/);
  assert.match(view, /id="microphoneHeading">마이크 자막/);
  assert.match(view, /id="connectionCard"[^>]*data-state="missing"/);
  assert.match(js, /\$\('connectionCard'\)\.dataset\.state = !connection\.hasKey/);
  assert.match(js, /pickVideo/);
  assert.match(css, /#videoView \.es2-input-options/);
  assert.match(css, /#videoView \.offline-source/);
  for (const id of ['sourceChoices', 'sourceChoicesHeading', 'chooseFile', 'chooseMicrophone',
    'chooseOffline', 'chooseFileStatus', 'cloudLiveEntryStatus']) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  assert.ok(view.indexOf('id="sourceChoices"') < file);
  assert.match(js, /\$\('chooseFileStatus'\)\.textContent/);
  assert.match(css, /#videoView #firstRunGuide:not\(\[hidden\]\) \+ #sourceChoices/);
});

test('2-A real browser has usable file action, source cards and original native actions', { skip: !enabled }, async () => {
  const routes = {
    '/': 'android/web/index.html', '/app.js': 'android/web/app.js',
    '/styles.css': 'android/web/styles.css', '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
    '/shared/core.js': 'src/core.js', '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
    '/shared/edit-history.js': 'src/edit-history.js', '/shared/subtitle-player.js': 'src/subtitle-player.js',
  };
  const server = createServer(async (req, res) => {
    const file = routes[new URL(req.url, 'http://localhost').pathname];
    if (!file) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' :
        file.endsWith('.css') ? 'text/css; charset=utf-8' :
        file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
      res.end(await readFile(join(root, file)));
    } catch { res.writeHead(500).end(); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => window.mockNative?.calls.some(c => c.method === 'status') && document.querySelector('.job'));
    await page.locator('#navVideo').click();
    assert.equal(await page.locator('#firstRunGuide').isVisible(), false, 'existing jobs hide onboarding');
    assert.equal(await page.locator('#connectionCard').getAttribute('data-state'), 'saved');
    assert.equal(await page.locator('#sourceChoices').isVisible(), true);
    assert.match(await page.locator('#chooseFileStatus').innerText(), /연결 저장됨/);
    assert.match(await page.locator('#cloudLiveEntryStatus').innerText(), /전송·요금/);
    await page.locator('#chooseFile').click();
    assert.equal(await page.locator('#pickVideo').evaluate(node => node === document.activeElement),
      true, 'file choice moves focus to the existing enabled picker');
    await page.locator('#chooseMicrophone').click();
    assert.equal(await page.locator('#openOnDevice').evaluate(node => node === document.activeElement),
      true, 'microphone choice focuses the API-free entry point');
    await page.locator('#chooseOffline').click();
    assert.equal(await page.locator('#videoView .local-offline-entry').getAttribute('open'), '',
      'offline choice expands the existing Vosk controls');
    assert.equal(await page.locator('#openOfflineModel').evaluate(node => node === document.activeElement),
      true);
    await mkdir(join(root, 'output/editorial-2-2a'), { recursive: true });
    for (const width of [320, 390, 800]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false, width + 'px ' + theme + ' overflows horizontally');
        const nav = await page.locator('.app-nav').boundingBox();
        const pick = await page.locator('#pickVideo').boundingBox();
        assert.ok(pick && pick.y + pick.height <= nav.y,
          'primary file picker visible above navigation at ' + width + 'px ' + theme);
        assert.equal(await page.locator('#videoView .microphone-source .local-caption-entry').count(), 2);
        assert.equal(await page.locator('#videoView .offline-source .local-offline-entry').count(), 1);
        if (width === 390 || width === 800) {
          await page.screenshot({
            path: join(root, 'output/editorial-2-2a', 'input-' + width + '-' + theme + '.png'),
            fullPage: true,
          });
        }
      }
    }
    await page.locator('#openConnection').click();
    assert.equal(await page.locator('#settingsView').isVisible(), true);
    await page.locator('#navVideo').click();
    await page.locator('#videoView .offline-source summary').click();
    await page.locator('#openOfflineModel').click();
    await page.waitForFunction(() => window.mockNative.calls.some(c => c.method === 'openOfflineModel'));
    assert.deepEqual(await page.locator('.app-nav button').allTextContents(), ['영상 추가','작업','결과','설정']);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
});

test('UI-09-C identifies API prerequisites without changing original launch gates', { skip: !enabled }, async () => {
  const routes = {
    '/': 'android/web/index.html', '/app.js': 'android/web/app.js',
    '/styles.css': 'android/web/styles.css', '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
    '/shared/core.js': 'src/core.js', '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
    '/shared/edit-history.js': 'src/edit-history.js', '/shared/subtitle-player.js': 'src/subtitle-player.js',
  };
  const server = createServer(async (req, res) => {
    const path = routes[new URL(req.url, 'http://localhost').pathname];
    if (!path) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript; charset=utf-8' :
        path.endsWith('.css') ? 'text/css; charset=utf-8' : path.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
      res.end(await readFile(join(root, path)));
    } catch { res.writeHead(500).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => window.mockNative?.calls.some(c => c.method === 'status') && document.querySelector('.job'));
    await page.locator('#navVideo').click();
    await page.evaluate(() => {
      window.mockNative.hasKey = false;
      window.nativeEvent({ type: 'status' });
    });
    await page.waitForFunction(() => document.querySelector('#pickVideo').disabled);
    assert.match(await page.locator('#chooseFileStatus').innerText(), /API 연결 필요/);
    assert.match(await page.locator('#cloudLiveEntryStatus').innerText(), /연결 필요/);
    assert.equal(await page.locator('#importSubtitles').isEnabled(), true, 'existing subtitle import is API-free');
    assert.equal(await page.locator('#openOnDevice').isEnabled(), true, 'device microphone remains available');
    assert.equal(await page.locator('#openOfflineModel').isEnabled(), true, 'Vosk management remains available');
    await page.locator('#chooseFile').click();
    await page.locator('#settingsView').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#apiSettings').getAttribute('open'), '');
    assert.equal(await page.evaluate(() => window.mockNative.calls.some(c => c.method === 'pickVideo')),
      false, 'connection needed: must not launch picker');
    await page.locator('#navVideo').click();
    await page.locator('#importSubtitles').click();
    await page.waitForFunction(() => window.mockNative.calls.some(c => c.method === 'importSubtitles'));
    await page.locator('#editorView').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.mockNative.calls.some(c => c.method === 'pickVideo')),
      false, 'import is independent of cloud connection');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
});
