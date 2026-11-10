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
const output = join(root, 'output/editorial-2-2c');

test('2-C uses original result selection and formats with an accessible export status', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'android/web/app.js'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
  ]);
  for (const id of ['resultsView', 'resultsHeading', 'resultJobSelector', 'resultEmpty', 'resultContent',
    'resultName', 'resultMeta', 'resultStatus', 'resultPreview', 'editResult', 'resultCueDetails',
    'resultCuePreview', 'exportSection', 'exportNote', 'resultExportStatus']) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  for (const format of ['srt', 'vtt', 'json'])
    assert.equal((html.match(new RegExp('data-export="' + format + '"', 'g')) || []).length, 1, format);
  assert.match(html, /id="resultExportStatus"[^>]*role="status"[^>]*hidden/);
  assert.match(html, /id="resultCueDetails"[^>]*hidden/);
  assert.match(js, /exportStatus\.dataset\.jobId/);
  assert.match(js, /history\.present\.slice\(0, 3\)/);
  assert.match(js, /const saved = result !== null && result !== false/);
  assert.match(js, /await exportCues\(job, history\.present, format\)/);
  assert.match(css, /#resultsView \.export-section \.export-actions \[data-export="srt"\]/);
  assert.match(css, /#resultsView \.result-export-status\.error-text/);
});

async function withApp(action) {
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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => window.mockNative?.calls.some(c => c.method === 'status') && document.querySelector('.job'));
    await action(page);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

test('2-C renders real cues, displays confirmed/cancelled exports and preserves read-only results', { skip: !enabled }, async () => {
  await withApp(async (page) => {
    await page.locator('#navResults').click();
    await page.waitForFunction(() => document.getElementById('resultName').textContent === '150분 인터뷰 테스트.mp4');
    assert.equal(await page.locator('#resultStateBadge').innerText(), '완료');
    assert.equal(await page.locator('#resultCueDetails').isVisible(), true);
    await page.locator('#resultCueDetails > summary').click();
    assert.equal(await page.locator('#resultCuePreview .result-cue-row').count(), 3);
    assert.match(await page.locator('#resultCuePreview .result-cue-text').first().textContent(), /테스트 번역 자막 1/);
    assert.equal(await page.locator('#editResult [data-result-edit-label]').innerText(), '자막 편집');
    await mkdir(output, { recursive: true });
    await page.locator('#resultCueDetails > summary').click();

    for (const width of [320, 390, 800]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false, width + 'px ' + theme + ' horizontal overflow');
        const nav = await page.locator('.app-nav').boundingBox();
        const primary = await page.locator('[data-export="srt"]').boundingBox();
        assert.ok(primary && nav && primary.y >= 0 && primary.y + primary.height <= nav.y,
          'SRT must remain usable before the fixed nav at ' + width + 'px ' + theme);
        if (width === 390 || width === 800) {
          await page.screenshot({
            path: join(output, 'results-' + width + '-' + theme + '.png'),
            fullPage: true,
          });
        }
      }
    }

    for (const type of ['srt', 'vtt', 'json']) {
      await page.locator('[data-export="' + type + '"]').click();
      await page.waitForFunction((fmt) => document.getElementById('resultExportStatus').textContent.includes(fmt.toUpperCase() + ' 파일을 저장했습니다.'), type);
      const last = await page.evaluate(() => window.mockNative.calls.filter(c => c.method === 'export').at(-1).params);
      assert.ok(last.name.endsWith('.' + type));
      assert.match(last.text, /테스트 번역 자막 1/);
    }

    await page.evaluate(() => { window.mockNative.cancelNextExport = true; });
    await page.locator('[data-export="srt"]').click();
    await page.waitForFunction(() => document.getElementById('resultExportStatus').textContent.includes('취소했습니다'));
    assert.match(await page.locator('#appMessage').innerText(), /취소/);

    await page.locator('#resultJobSelector').selectOption('partial-1');
    await page.waitForFunction(() => document.getElementById('resultName').textContent === '이어하기 테스트.mp4');
    assert.equal(await page.locator('#resultStateBadge').innerText(), '일시정지');
    assert.equal(await page.locator('#editResult [data-result-edit-label]').innerText(), '자막 보기');
    assert.match(await page.locator('#resultStatus').innerText(), /부분 결과/);
    assert.equal(await page.locator('#resultExportStatus').isVisible(), false, 'previous result feedback must reset');
    await page.locator('[data-export="srt"]').click();
    await page.waitForFunction(() => document.getElementById('resultExportStatus').textContent.includes('SRT 파일을 저장했습니다.'));
    const partial = await page.evaluate(() => window.mockNative.calls.filter(c => c.method === 'export').at(-1).params);
    assert.equal(partial.name, '이어하기 테스트.srt');
  });
});

test('2-C export failures are visible without marking a failed save as successful', { skip: !enabled }, async () => {
  await withApp(async (page) => {
    await page.locator('#navResults').click();
    await page.waitForFunction(() => document.getElementById('resultName').textContent === '150분 인터뷰 테스트.mp4');
    await page.evaluate(() => {
      const original = window.Native.postMessage.bind(window.Native);
      window.Native.postMessage = (raw) => {
        const request = JSON.parse(raw);
        if (request.method !== 'export') return original(raw);
        window.Native.postMessage = original;
        queueMicrotask(() => window.nativeResult({ id: request.id, error: '테스트 저장 실패' }));
      };
    });
    await page.locator('[data-export="srt"]').click();
    await page.waitForFunction(() => document.getElementById('resultExportStatus').classList.contains('error-text'));
    assert.match(await page.locator('#resultExportStatus').innerText(), /저장하지 못했습니다/);
    assert.doesNotMatch(await page.locator('#resultExportStatus').innerText(), /저장했습니다/);
    await page.locator('[data-export="srt"]').click();
    await page.waitForFunction(() => document.getElementById('resultExportStatus').textContent.includes('SRT 파일을 저장했습니다.'));
    assert.equal(await page.locator('#resultExportStatus').evaluate(el => el.classList.contains('error-text')), false);
  });
});
