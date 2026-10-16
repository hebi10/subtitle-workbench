import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
// This fixture serves source modules directly without copying build assets.
const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
test('Android WebView UI with a mock native bridge', { skip: !process.env.PLAYWRIGHT_MODULE }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const paths = {
      '/': 'android/web/index.html', '/app.js': 'android/web/app.js', '/styles.css': 'android/web/styles.css',
      '/shared/core.js': 'src/core.js', '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
      '/shared/edit-history.js': 'src/edit-history.js', '/shared/subtitle-player.js': 'src/subtitle-player.js',
    };
    if (!paths[pathname]) { res.writeHead(404).end(); return; }
    try { res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'); res.end(await readFile(join(root, paths[pathname]))); }
    catch { res.writeHead(500).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('.job').first().waitFor();
    assert.equal(await page.locator('.job').count(), 2);
    const firstRequestId = await page.evaluate(() => window.mockNative.calls[0].id);
    assert.equal(await page.evaluate(() => window.handleNativeBack()), false);
    await page.evaluate(() => window.nativeEvent({ type: 'error', message: '네이티브 처리 오류 테스트' }));
    assert.equal(await page.locator('#appMessage').textContent(), '네이티브 처리 오류 테스트');
    assert.match(await page.locator('#appMessage').getAttribute('class'), /error/);
    await page.evaluate(() => window.nativeEvent({ type: 'notice', message: '네이티브 알림 테스트' }));
    assert.equal(await page.locator('#appMessage').textContent(), '네이티브 알림 테스트');
    assert.equal((await page.locator('#appMessage').getAttribute('class')).includes('error'), false);
    await page.locator('#navSettings').click();
    assert.equal(await page.evaluate(() => window.handleNativeBack()), true);
    await page.locator('#jobsView').waitFor({ state: 'visible' });
    await page.locator('#navSettings').click();
    await page.locator('#sourceLanguage').selectOption('en');
    await page.locator('#targetLanguage').selectOption('ja');
    await page.locator('#translationModel').fill('fixture-model');
    await page.evaluate(() => window.nativeEvent({ type: 'status' }));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#translationModel').inputValue(), 'fixture-model');
    await page.getByRole('button', { name: '설정 저장', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('settingsStatus').textContent.includes('기기에 저장했습니다'));
    await page.reload();
    await page.locator('.job').first().waitFor();
    assert.notEqual(await page.evaluate(() => window.mockNative.calls[0].id), firstRequestId);
    assert.equal(await page.locator('#sourceLanguage').inputValue(), 'en');
    assert.equal(await page.locator('#targetLanguage').inputValue(), 'ja');
    assert.equal(await page.locator('#translationModel').inputValue(), 'fixture-model');
    await page.screenshot({ path: join(tmpdir(), 'subtitle-android-jobs.png'), fullPage: true });
    await page.getByRole('button', { name: '자막 편집', exact: true }).click();
    await page.locator('.cue').first().waitFor();
    assert.equal(await page.locator('.cue').count(), 12);
    const firstText = page.locator('.cue textarea').first();
    await firstText.fill('수정한 원문 자막 ');
    await page.waitForFunction(() => window.mockNative.cues['complete-1'][0].original === '수정한 원문 자막 ');
    assert.equal(await firstText.evaluate((node) => document.activeElement === node), true);
    await page.waitForTimeout(3700);
    assert.equal(await firstText.inputValue(), '수정한 원문 자막 ');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    assert.match(await page.locator('#pageInfo').textContent(), /2 \/ 3/);
    await page.getByRole('button', { name: '다음', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '다음', exact: true }).isDisabled(), true);
    await page.locator('#cueSearch').fill('테스트 번역 자막 27');
    assert.equal(await page.locator('.cue').count(), 1);
    await page.locator('.cue summary').click();
    assert.equal(await page.getByRole('button', { name: '다음 자막과 병합' }).isDisabled(), true);
    await page.locator('#cueSearch').fill('');
    await page.locator('.cue summary').first().click();
    await page.getByRole('button', { name: '중간에서 분할' }).first().click();
    assert.equal(await page.locator('#cueCount').textContent(), '28개');
    await page.getByRole('button', { name: '실행 취소', exact: true }).click();
    assert.equal(await page.locator('#cueCount').textContent(), '27개');
    await page.getByRole('button', { name: '다시 실행', exact: true }).click();
    assert.equal(await page.locator('#cueCount').textContent(), '28개');
    for (const format of ['SRT', 'VTT', 'JSON']) {
      await page.getByRole('button', { name: `${format} 저장` }).click();
      await page.waitForFunction((format) => window.mockNative.calls.some((call) => call.method === 'export' && call.params.name.endsWith(`.${format.toLowerCase()}`)), format);
    }
    assert.equal(await page.evaluate(() => window.mockNative.calls.filter((call) => call.method === 'export').length), 3);
    await page.evaluate(() => { window.mockNative.failSave = true; });
    await page.locator('.cue textarea').first().fill('저장 실패에도 유지할 원문');
    await page.waitForFunction(() => !document.getElementById('retrySave').hidden);
    assert.equal(await page.evaluate(() => window.handleNativeBack()), true);
    await page.waitForFunction(() => document.getElementById('appMessage').textContent.includes('테스트 저장 실패'));
    assert.equal(await page.locator('#editorView').isVisible(), true);
    await page.getByRole('button', { name: '작업 목록으로' }).click();
    await page.waitForFunction(() => document.getElementById('appMessage').textContent.includes('테스트 저장 실패'));
    assert.equal(await page.locator('#editorView').isVisible(), true);
    await page.evaluate(() => { window.mockNative.failSave = false; });
    await page.getByRole('button', { name: '저장 다시 시도' }).click();
    await page.locator('#retrySave').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '작업 목록으로' }).click();
    await page.getByRole('button', { name: '현재 자막 보기' }).click();
    await page.waitForFunction(() => document.getElementById('editorName').textContent === '이어하기 테스트.mp4');
    assert.equal(await page.locator('.cue textarea').first().isDisabled(), true);
    await page.getByRole('button', { name: '작업 목록으로' }).click();
    await page.getByRole('button', { name: '이어하기' }).click();
    await page.getByRole('button', { name: '일시정지' }).click();
    await page.getByRole('button', { name: '자막 불러오기' }).click();
    await page.waitForFunction(() => document.getElementById('editorName').textContent === '가져온 자막.srt');
    assert.equal(await page.locator('#cueCount').textContent(), '1개');
    assert.equal(await page.locator('.cue textarea').first().isDisabled(), false);
    assert.equal(await page.locator('#preview').isDisabled(), true);
    for (const width of [320, 390, 800]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow at ${width}px`);
      await page.screenshot({ path: join(tmpdir(), `subtitle-android-editor-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
});
