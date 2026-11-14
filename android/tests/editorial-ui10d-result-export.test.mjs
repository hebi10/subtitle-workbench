import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const output = join(root, 'output/editorial-2-2c');
const routes = {
  '/': 'android/web/index.html',
  '/app.js': 'android/web/app.js',
  '/styles.css': 'android/web/styles.css',
  '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
  '/shared/core.js': 'src/core.js',
  '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
  '/shared/edit-history.js': 'src/edit-history.js',
  '/shared/subtitle-player.js': 'src/subtitle-player.js',
};

async function withApp(action) {
  const server = createServer(async (request, response) => {
    const path = routes[new URL(request.url, 'http://localhost').pathname];
    if (!path) { response.writeHead(404).end(); return; }
    try {
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(path)];
      response.setHeader('Content-Type', mime + (mime === 'image/png' ? '' : '; charset=utf-8'));
      response.end(await readFile(join(root, path)));
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', locale: 'ko-KR' });
    const page = await context.newPage();
    page.setDefaultTimeout(18000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => window.mockNative?.calls.some(c => c.method === 'status') && document.querySelector('#jobList .job'));
    await page.locator('#navResults').click();
    await page.waitForFunction(() => document.querySelector('#resultName')?.textContent === '150분 인터뷰 테스트.mp4');
    await action(page);
    assert.deepEqual(errors, [], 'UI-10-D WebView has no uncaught script errors');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function exportAndCheck(page, format, state, text) {
  await page.locator('[data-export="' + format + '"]').click();
  await page.waitForFunction(expected => document.querySelector('#resultExportStatus')?.dataset.state === expected, state);
  const status = page.locator('#resultExportStatus');
  assert.equal(await status.getAttribute('data-format'), format);
  assert.match(await status.textContent(), text);
  assert.equal(await status.isVisible(), true);
}

async function mockNextNativeExport(page, payload) {
  await page.evaluate((next) => {
    const original = window.Native.postMessage.bind(window.Native);
    window.Native.postMessage = (raw) => {
      const request = JSON.parse(raw);
      if (request.method !== 'export') return original(raw);
      window.Native.postMessage = original;
      window.mockNative.calls.push(request);
      setTimeout(() => window.nativeResult({ id: request.id, ...next }), 30);
    };
  }, payload);
}

test('UI-10-D retains native UTF-8 save contract and requires explicit export confirmation', async () => {
  const [html, js, native, css] = await Promise.all([
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'android/web/app.js'), 'utf8'),
    readFile(join(root, 'android/app/src/main/java/com/haebi/subtitle/MainActivity.java'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
  ]);
  assert.equal((html.match(/id="resultExportStatus"/g) || []).length, 1);
  assert.match(html, /id="resultExportStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.ok(html.indexOf('id="resultMediaStatus"') < html.indexOf('id="editResult"'));
  for (const format of ['srt', 'vtt', 'json']) assert.equal((html.match(new RegExp('data-export="' + format + '"', 'g')) || []).length, 1);
  assert.match(js, /const saved = result === true \|\| result\?\.saved === true;/);
  assert.match(js, /if \(!saved && result !== null && result !== false && result\?\.saved !== false\)/);
  assert.match(js, /resultExportInFlight \|\| changingJob/);
  assert.match(js, /status\.dataset\.format = format;/);
  assert.match(js, /status\.dataset\.state = state;/);
  assert.match(js, /if \(!isSelectedResult\(\) \|\| changingJob/);
  assert.match(js, /await exportCues\(job, history\.present, format\)/);
  assert.match(native, /Intent\.ACTION_CREATE_DOCUMENT/);
  assert.match(native, /if \(resultCode != RESULT_OK \|\| uri == null\) \{ documents\.clear\(\); reply\(id, JSONObject\.NULL, null\); return; \}/);
  const exportBranch = native.slice(native.indexOf('stream.write(exportText.getBytes(StandardCharsets.UTF_8))'));
  assert.ok(exportBranch.startsWith('stream.write(exportText.getBytes(StandardCharsets.UTF_8))'));
  assert.ok(exportBranch.indexOf('stream.flush();') > 0 && exportBranch.indexOf('stream.flush();') < exportBranch.indexOf('reply(id, true, null);'));
  assert.ok(css.includes('#resultsView .result-export-status[data-state="pending"]'));
});

test('UI-10-D per-format success, cancel, native errors and unknown response never misreport saving', { skip: !enabled }, async () => {
  await withApp(async page => {
    assert.equal(await page.locator('#resultExportStatus').isHidden(), true);
    for (const fmt of ['srt', 'vtt', 'json']) {
      await exportAndCheck(page, fmt, 'success', new RegExp(fmt.toUpperCase() + ' 파일을 저장했습니다'));
      const request = await page.evaluate(() => window.mockNative.calls.filter(c => c.method === 'export').at(-1).params);
      assert.ok(request.name.endsWith('.' + fmt));
      assert.ok(request.text.includes('테스트 번역 자막 1'), fmt + ' preserves Korean text');
      if (fmt === 'srt') assert.match(request.text, /-->/);
      if (fmt === 'vtt') assert.match(request.text, /WEBVTT/);
      if (fmt === 'json') assert.ok(JSON.parse(request.text), 'valid JSON output');
    }
    await page.evaluate(() => { window.mockNative.cancelNextExport = true; });
    await exportAndCheck(page, 'vtt', 'cancelled', /VTT 파일 저장을 취소했습니다/);
    assert.doesNotMatch(await page.locator('#resultExportStatus').textContent(), /저장했습니다/);

    await mockNextNativeExport(page, { result: {} });
    await exportAndCheck(page, 'json', 'error', /JSON 파일을 저장하지 못했습니다/);
    assert.match(await page.locator('#resultExportStatus').textContent(), /저장 결과를 확인하지 못했습니다/);
    await mockNextNativeExport(page, { error: '파일 쓰기 실패' });
    await exportAndCheck(page, 'srt', 'error', /SRT 파일을 저장하지 못했습니다/);
    assert.match(await page.locator('#resultExportStatus').textContent(), /파일 쓰기 실패/);
    assert.equal(await page.locator('#resultExportStatus').evaluate(el => el.classList.contains('error-text')), true);

    await mockNextNativeExport(page, { result: true });
    await exportAndCheck(page, 'srt', 'success', /SRT 파일을 저장했습니다/);
    assert.equal(await page.locator('#resultExportStatus').evaluate(el => el.classList.contains('error-text')), false);
    assert.equal(await page.evaluate(() => window.mockNative.calls.some(c => c.method === 'deleteJob')), false);
  });
});

test('UI-10-D serializes Save As pickers and isolates late responses across selected jobs', { skip: !enabled }, async () => {
  await withApp(async page => {
    await page.evaluate(() => { window.mockNative.methodDelays = { export: 420 }; });
    await page.locator('[data-export="srt"]').click();
    await page.waitForFunction(() => document.querySelector('#resultExportStatus')?.dataset.state === 'pending');
    assert.equal(await page.locator('[data-export="vtt"]').isDisabled(), true);
    assert.equal(await page.locator('[data-export="json"]').isDisabled(), true);
    await page.locator('#resultJobSelector').selectOption('partial-1');
    await page.waitForFunction(() => document.querySelector('#resultName')?.textContent === '이어하기 테스트.mp4');
    assert.equal(await page.locator('#resultExportStatus').isHidden(), true);
    await page.waitForTimeout(550);
    assert.equal(await page.locator('#resultExportStatus').isHidden(), true, 'old Save As result must not label new job as saved');
    assert.equal(await page.locator('[data-export="vtt"]').isEnabled(), true);

    await page.locator('[data-export="json"]').click();
    await page.waitForFunction(() => document.querySelector('#resultExportStatus')?.dataset.state === 'success');
    assert.equal(await page.locator('#resultExportStatus').getAttribute('data-format'), 'json');
    await page.locator('#resultJobSelector').selectOption('complete-1');
    await page.waitForFunction(() => document.querySelector('#resultName')?.textContent === '150분 인터뷰 테스트.mp4');
    assert.equal(await page.locator('#resultExportStatus').isHidden(), true, 'per-job export feedback clears on selection');
  });
});

test('UI-10-D preserves missing-media and editable-results distinctions at responsive widths', { skip: !enabled }, async () => {
  await withApp(async page => {
    assert.equal(await page.locator('#resultMediaStatus').getAttribute('data-state'), 'linked');
    assert.equal(await page.locator('#resultPreview').isEnabled(), true);
    assert.equal(await page.locator('#editResult').isEnabled(), true);
    assert.equal(await page.locator('#editResult').evaluate(el => el.classList.contains('primary')), true);
    await page.locator('#resultJobSelector').selectOption('partial-1');
    await page.waitForFunction(() => document.querySelector('#resultName')?.textContent === '이어하기 테스트.mp4');
    assert.match(await page.locator('#resultStatus').textContent(), /부분 결과/);
    assert.match(await page.locator('#editResult').textContent(), /자막 보기/);

    await page.locator('#navVideo').click();
    await page.locator('#importSubtitles').click();
    await page.locator('#navResults').click();
    await page.waitForFunction(() => document.querySelector('#resultName')?.textContent === '가져온 자막.srt');
    assert.equal(await page.locator('#resultPreview').isDisabled(), true);
    assert.equal(await page.locator('#editResult').isEnabled(), true);
    await exportAndCheck(page, 'srt', 'success', /SRT 파일을 저장했습니다/);

    await mkdir(output, { recursive: true });
    for (const width of [320, 390, 800]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        const size = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          screenWidth: innerWidth,
          targets: [...document.querySelectorAll('#resultsView .export-actions button')].map(x => x.getBoundingClientRect().height),
        }));
        assert.ok(size.documentWidth <= size.screenWidth + 1, width + '/' + theme + ' horizontal overflow');
        assert.ok(size.targets.every(x => x >= 48), width + '/' + theme + ' export touch targets');
        if (width === 390) await page.screenshot({ path: join(output, 'ui10d-export-' + theme + '.png'), fullPage: true });
      }
    }
  });
});
