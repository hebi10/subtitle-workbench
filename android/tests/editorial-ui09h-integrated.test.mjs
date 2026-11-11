import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const output = join(root, 'output/ui09h');
const widths = [320, 360, 390, 432, 800, 1280];
const themes = ['light', 'dark'];
const nativeRoutes = {
  '/': 'android/web/index.html',
  '/styles.css': 'android/web/styles.css',
  '/app.js': 'android/web/app.js',
  '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
  '/shared/core.js': 'src/core.js',
  '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
  '/shared/edit-history.js': 'src/edit-history.js',
  '/shared/subtitle-player.js': 'src/subtitle-player.js',
};

function serve(native) {
  return createServer(async (request, response) => {
    const uri = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = native ? nativeRoutes[uri]
      : uri === '/' ? 'index.html'
      : uri.startsWith('/tests/assets/') ? uri.slice('/tests/'.length)
      : uri.slice(1);
    const allowed = native ? Boolean(path) : /^(?:index\.html|styles\.css|favicon\.ico|favicon\.png|apple-touch-icon\.png|assets\/brand\/editorial-mark-white\.png|tests\/browser-workflow\.html|tests\/browser-workflow\.mjs|src\/[a-z0-9-]+\.js|assets\/[a-z0-9._/-]+)$/i.test(path || '');
    if (!allowed || !path || path.includes('..')) { response.writeHead(404).end(); return; }
    const file = resolve(root, path);
    if (!file.startsWith(root + '/')) { response.writeHead(404).end(); return; }
    try {
      const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' }[extname(file)] || 'application/octet-stream';
      response.setHeader('Content-Type', mime + (mime.startsWith('text/') ? '; charset=utf-8' : ''));
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
}

async function useBrowser(native, action) {
  const server = serve(native);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, colorScheme: 'light',
      locale: 'ko-KR', acceptDownloads: true, reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(18000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (native) await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base + '/');
    if (native) await page.waitForFunction(() => window.mockNative?.calls.some(c => c.method === 'status') && document.querySelector('.job'));
    await action(page, base);
    assert.deepEqual(errors, [], (native ? 'WebView mock' : 'web') + ' JS exceptions');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
}

async function measure(page, device, screen, width, theme) {
  const metrics = await page.evaluate(native => {
    const nav = document.querySelector(native ? '.app-nav' : '.workspace-tabs');
    const box = nav.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      navTop: box.top, navBottom: box.bottom,
      buttons: [...nav.querySelectorAll('button')].map(node => ({
        text: node.textContent.trim(),
        height: node.getBoundingClientRect().height,
        overflowX: node.scrollWidth > node.clientWidth + 2,
        overflowY: node.scrollHeight > node.clientHeight + 2,
      })),
    };
  }, device === 'android-webview-mock');
  assert.ok(metrics.documentWidth <= width + 1, device + ' ' + screen + ' ' + width + ' ' + theme + ' horizontal overflow');
  assert.ok(metrics.buttons.every(b => b.height >= 48 && !b.overflowX && !b.overflowY),
    device + ' ' + screen + ' ' + width + ' ' + theme + ' clipped navigation');
  if (device === 'android-webview-mock') {
    assert.ok(metrics.navTop >= -1 && metrics.navBottom <= metrics.viewportHeight + 1,
      screen + ' ' + width + ' ' + theme + ' hidden fixed bottom navigation');
  }
  return { device, screen, width, theme, ...metrics };
}

test('UI-09-H keeps all screen, security and screenshot provenance contracts', async () => {
  const [web, mobile, release, baseline, deviceFixture] = await Promise.all([
    readFile(join(root, 'index.html'), 'utf8'),
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, '.github/workflows/play-internal.yml'), 'utf8'),
    readFile(join(root, '.github/workflows/ui09a-state-baseline.yml'), 'utf8'),
    readFile(join(root, 'android/app/src/androidTest/java/com/haebi/subtitle/EditorialUi09aStateMatrixDeviceTest.java'), 'utf8'),
  ]);
  for (const id of ['panel-generate', 'panel-edit', 'panel-export', 'generateWorkflowStatus', 'editorWorkspaceStatus',
    'exportWorkflowStatus', 'editorCueContext', 'editorBody', 'exportResultSelect', 'exportDownloadStatus']) {
    assert.equal((web.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  for (const id of ['videoView', 'jobsView', 'resultsView', 'editorView', 'settingsView', 'pickVideo',
    'importSubtitles', 'openOnDevice', 'openCloudLive', 'openOfflineModel', 'resultMediaStatus',
    'resultExportStatus', 'saveStatus', 'retrySave', 'confirmClearKey', 'confirmClearReviewRelay']) {
    assert.equal((mobile.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  assert.match(mobile, /id="apiKey" type="password"/);
  assert.match(mobile, /id="reviewRelayCode" type="password"/);
  assert.match(release, /skip-play/);
  assert.match(baseline, /editorial-ui09h-integrated\.test\.mjs/);
  assert.match(baseline, /api-level:\s*35/);
  assert.match(deviceFixture, /ui09a-state-matrix/);
  assert.match(deviceFixture, /getWritableDatabase\(\)\.delete\("jobs", "id=\?", args\)/);
});

test('UI-09-H web 3 tabs: 36 configurations, actual SRT download bytes and short viewport', { skip: !enabled }, async () => {
  await useBrowser(false, async (page, base) => {
    assert.equal(await page.locator('#startButton').isDisabled(), true);
    await page.goto(base + '/tests/browser-workflow.html');
    await page.waitForFunction(() => window.__workflowDone === true, null, { timeout: 90000 });
    const report = JSON.parse(await page.locator('#workflowResults').textContent());
    assert.equal(report.failed, 0, JSON.stringify(report.results.filter(r => !r.passed)));
    await page.locator('#workflowResults').evaluate(node => { node.hidden = true; });

    const matrix = [];
    await mkdir(output, { recursive: true });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of themes) {
        await page.emulateMedia({ colorScheme: theme });
        for (const tab of ['generate', 'edit', 'export']) {
          await page.locator('#tab-' + tab).click();
          assert.equal(await page.locator('#tab-' + tab).getAttribute('aria-selected'), 'true');
          assert.equal(await page.locator('#panel-' + tab).isVisible(), true);
          const status = await page.locator('#' + ({ generate: 'generateWorkflowStatus', edit: 'editorWorkspaceStatus', export: 'exportWorkflowStatus' }[tab])).getAttribute('data-state');
          assert.ok(status && status.length, tab + ': missing state');
          matrix.push({ ...(await measure(page, 'web', tab, width, theme)), status });
          if ([390, 1280].includes(width)) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: join(output, 'web-' + tab + '-' + width + '-' + theme + '.png'),
              animations: 'disabled', fullPage: false });
          }
        }
      }
    }
    assert.equal(matrix.length, 36);

    await page.locator('#tab-edit').click();
    await page.setViewportSize({ width: 390, height: 480 });
    const edit = page.locator('#editorBody [data-edit-field="original"]').first();
    await edit.waitFor();
    await edit.focus();
    await edit.fill('UI09H 키보드 편집·검증');
    assert.equal(await edit.inputValue(), 'UI09H 키보드 편집·검증');
    assert.equal(await edit.evaluate(n => n === document.activeElement), true);
    await measure(page, 'web', 'edit-compact-ime', 390, 'light');

    await page.locator('#tab-export').click();
    const link = page.locator('#downloads a.download-link[download]').first();
    await link.waitFor();
    const event = page.waitForEvent('download');
    await link.click();
    const download = await event;
    assert.match(download.suggestedFilename(), /\.srt$/);
    const stream = await download.createReadStream();
    const bytes = [];
    for await (const chunk of stream) bytes.push(chunk);
    const content = Buffer.concat(bytes).toString('utf8');
    assert.ok(content.includes('-->') && content.length > 10, 'SRT data missing');
    assert.match(await page.locator('#exportDownloadStatus').innerText(), /다운로드 요청됨/);
    assert.doesNotMatch(await page.locator('#exportDownloadStatus').innerText(), /저장 완료/);

    await writeFile(join(output, 'web-matrix.json'), JSON.stringify({
      sourceSha: process.env.GITHUB_SHA || 'local',
      provenance: 'Playwright Chromium; synthetic API/FFmpeg fixture, not a paid API or Android screenshot',
      checks: matrix, checkedFilename: download.suggestedFilename(),
      srtByteCount: Buffer.byteLength(content, 'utf8'),
    }, null, 2) + '\n');
  });
});

test('UI-09-H Android WebView: 61 mock configurations, error/partial and three formats', { skip: !enabled }, async () => {
  await useBrowser(true, async page => {
    await page.evaluate(() => {
      const seed = window.mockNative.jobs.find(job => job.id === 'partial-1');
      window.mockNative.jobs.push(
        { ...seed, id: 'ui09h-running', name: '긴 한글 파일 이름 '.repeat(10) + '.mp4',
          status: 'running', stage: 'transcribing', progress: { ...seed.progress, message: '처리 중 모의 상태' } },
        { ...seed, id: 'ui09h-error', name: '오류 복구 모의 화면.mp4',
          status: 'error', error: '연결 중단 후 저장 구간은 유지됩니다.' },
      );
      window.mockNative.cues['ui09h-running'] = window.mockNative.cues['partial-1'];
      window.mockNative.cues['ui09h-error'] = window.mockNative.cues['partial-1'];
      window.nativeEvent({ type: 'status' });
    });
    await page.waitForFunction(() => document.getElementById('jobsSummary').textContent.includes('전체 4개'));
    assert.match(await page.locator('#jobsSummary').innerText(), /오류 1/);
    await page.locator('#navVideo').click();
    await page.locator('#importSubtitles').click();
    await page.locator('#editorView').waitFor({ state: 'visible' });
    await page.locator('#navResults').click();
    await page.waitForFunction(() => document.getElementById('resultMediaStatus').dataset.state === 'missing');
    assert.equal(await page.locator('#resultPreview').isDisabled(), true);
    assert.equal(await page.locator('#editResult').isEnabled(), true);
    for (const ext of ['srt', 'vtt', 'json']) {
      await page.locator('#exportSection [data-export="' + ext + '"]').click();
      await page.waitForFunction(e => document.getElementById('resultExportStatus').textContent.includes(e.toUpperCase() + ' 파일을 저장했습니다.'), ext);
    }
    assert.deepEqual(await page.evaluate(() => window.mockNative.calls.filter(c => c.method === 'export').slice(-3).map(c => c.params.name.split('.').at(-1))), ['srt', 'vtt', 'json']);
    assert.equal(await page.evaluate(() => window.mockNative.calls.some(c => c.method === 'deleteJob')), false);
    await page.evaluate(() => { window.mockNative.cancelNextExport = true; });
    await page.locator('#exportSection [data-export="srt"]').click();
    await page.waitForFunction(() => document.getElementById('resultExportStatus').textContent.includes('취소했습니다'));

    const views = [
      ['new-task', '#navVideo', '#videoView'],
      ['jobs', '#navJobs', '#jobsView'],
      ['results', '#navResults', '#resultsView'],
      ['settings', '#navSettings', '#settingsView'],
    ];
    const matrix = [];
    await mkdir(output, { recursive: true });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of themes) {
        await page.emulateMedia({ colorScheme: theme });
        for (const [screen, nav, panel] of views) {
          await page.locator(nav).click();
          await page.locator(panel).waitFor({ state: 'visible' });
          matrix.push(await measure(page, 'android-webview-mock', screen, width, theme));
          if (width === 390) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: join(output, 'webview-mock-' + screen + '-390-' + theme + '.png'),
              fullPage: false, animations: 'disabled' });
          }
        }
        await page.locator('#navResults').click();
        await page.locator('#resultJobSelector').selectOption('complete-1');
        await page.waitForFunction(() => document.getElementById('resultName').textContent === '150분 인터뷰 테스트.mp4');
        await page.locator('#editResult').click();
        await page.locator('#editorView .cue.selected textarea').first().waitFor();
        matrix.push(await measure(page, 'android-webview-mock', 'editor', width, theme));
        if (width === 390) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: join(output, 'webview-mock-editor-390-' + theme + '.png'),
            fullPage: false, animations: 'disabled' });
        }
      }
    }
    assert.equal(matrix.length, 60);
    await page.setViewportSize({ width: 390, height: 480 });
    const input = page.locator('#editorView .cue.selected textarea').first();
    await input.focus();
    await page.keyboard.insertText('통합 QA 입력 검수');
    assert.equal(await input.evaluate(n => n === document.activeElement), true);
    matrix.push(await measure(page, 'android-webview-mock', 'short-ime', 390, 'dark'));
    await writeFile(join(output, 'webview-mock-matrix.json'), JSON.stringify({
      sourceSha: process.env.GITHUB_SHA || 'local',
      provenance: 'Playwright browser with mocked Android Native; NOT an Android emulator screenshot',
      checks: matrix, exportFormats: ['srt', 'vtt', 'json'], userMediaOrApiUsed: false,
    }, null, 2) + '\n');
    assert.equal(matrix.length, 61);
  });
});
