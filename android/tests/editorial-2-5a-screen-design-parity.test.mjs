import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const output = join(root, 'output/editorial-5a');

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

test('5-A design comparison preserves original screen and format contracts', async () => {
  const [android, web, css] = await Promise.all([
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'index.html'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
  ]);
  for (const id of [
    'videoView', 'jobsView', 'resultsView', 'editorView', 'settingsView',
    'navVideo', 'navJobs', 'navResults', 'navSettings',
    'pickVideo', 'importSubtitles', 'openOnDevice', 'openCloudLive', 'openOfflineModel',
    'editorCueContext', 'saveStatus', 'retrySave', 'resultExportStatus',
  ]) {
    assert.equal((android.match(new RegExp('id="' + id + '"', 'g')) ?? []).length, 1, id);
  }
  for (const id of ['panel-generate', 'panel-edit', 'panel-export', 'editorCueContext',
    'exportResultSelect', 'exportResultStatus', 'downloads', 'exportDownloadStatus']) {
    assert.equal((web.match(new RegExp('id="' + id + '"', 'g')) ?? []).length, 1, id);
  }
  assert.ok(web.indexOf('id="panel-generate"') < web.indexOf('id="panel-edit"'));
  assert.ok(web.indexOf('id="panel-edit"') < web.indexOf('id="panel-export"'));
  assert.match(android, /SRT 저장/);
  assert.match(android, /VTT 저장/);
  assert.match(android, /JSON 저장/);
  assert.ok(css.includes('word-break: keep-all;'));
  assert.ok(css.includes('#videoView .file-source #openConnection'));
});

test('5-A live UI: Android Korean file and connection actions keep whole-word wrapping', { skip: !enabled }, async () => {
  const server = createServer(async (request, response) => {
    const path = routes[new URL(request.url, 'http://localhost').pathname];
    if (!path) { response.writeHead(404).end(); return; }
    try {
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript; charset=utf-8' :
        path.endsWith('.css') ? 'text/css; charset=utf-8' :
        path.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
      response.end(await readFile(join(root, path)));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => window.mockNative?.calls.some(call => call.method === 'status'));
    await page.locator('#navVideo').click();
    await page.locator('#videoView').waitFor({ state: 'visible' });

    for (const width of [320, 390, 800]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        const actual = await page.evaluate(() => {
          const pick = ['pickVideo', 'importSubtitles', 'connectionHeading', 'openConnection']
            .map(id => {
              const node = document.getElementById(id);
              const style = getComputedStyle(node);
              return { id, wordBreak: style.wordBreak, text: node.textContent.trim() };
            });
          return {
            styles: pick, overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
            bottomButtons: [...document.querySelectorAll('.app-nav button')].every(node =>
              node.getBoundingClientRect().height >= 48 && node.scrollWidth <= node.clientWidth + 1),
          };
        });
        assert.equal(actual.overflow, false, width + ' ' + theme + ': page overflow');
        assert.equal(actual.bottomButtons, true, width + ' ' + theme + ': bottom nav clipping');
        for (const label of actual.styles) {
          assert.equal(label.wordBreak, 'keep-all', label.id + ' must keep Korean words intact');
        }
        if (width === 390) {
          await mkdir(output, { recursive: true });
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: join(output, '5a-word-wrap-video-390-' + theme + '.png'),
            fullPage: false, animations: 'disabled',
          });
        }
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
