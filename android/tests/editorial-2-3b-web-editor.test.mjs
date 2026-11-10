import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const output = join(root, 'output/editorial-3b');

test('3-B web editor supports cue selection, filter reset, retained edits, media-first layout and responsive themes', { skip: !enabled }, async () => {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filePath = resolve(root, '.' + pathname);
    if (!filePath.startsWith(root + '/') || pathname.includes('..')) {
      response.writeHead(404).end();
      return;
    }
    const type = extname(filePath);
    const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
      '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon' }[type] || 'application/octet-stream';
    try {
      const bytes = await readFile(filePath);
      response.setHeader('Content-Type', mime);
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', locale: 'ko-KR' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/tests/browser-workflow.html');
    await page.waitForFunction(() => window.__workflowDone === true, null, { timeout: 90000 });
    const report = JSON.parse(await page.locator('#workflowResults').textContent());
    assert.equal(report.failed, 0, JSON.stringify(report.results.filter(item => !item.passed)));

    await page.locator('#editorSearch').fill('');
    await page.locator('#editorStatusFilter').selectOption('all');
    const resultValue = await page.locator('#jobResultSelect option').evaluateAll(options =>
      options.find(option => option.textContent.includes('first.mp4'))?.value);
    assert.ok(resultValue, 'fixture must include a completed first result');
    await page.locator('#jobResultSelect').selectOption(resultValue);
    await page.locator('#tab-edit').click();
    await page.locator('#editorBody [data-cue-index]').first().waitFor();
    if (await page.locator('#editorBody [data-cue-index]').count() < 2) {
      await page.locator('#editorBody [data-editor-action="split"]').first().click();
    }
    assert.equal(await page.locator('#editorCueContext').isVisible(), true);
    assert.match(await page.locator('#editorCuePosition').innerText(), /자막 1 \/ 2개/);
    assert.equal(await page.locator('#editorPrevCue').isDisabled(), true);
    await page.locator('#editorNextCue').click();
    assert.match(await page.locator('#editorCuePosition').innerText(), /자막 2 \/ 2개/);
    assert.equal(await page.locator('#editorBody .is-selected-cue').getAttribute('data-cue-index'), '1');

    await page.locator('#editorFocusCue').click();
    const secondOriginal = page.locator('#editorBody [data-cue-index="1"] [data-edit-field="original"]');
    assert.equal(await secondOriginal.evaluate(node => node === document.activeElement), true);
    await secondOriginal.fill('편집 상태 미리보기 검증');
    assert.equal(await page.locator('#editorCueOriginal').innerText(), '편집 상태 미리보기 검증');
    assert.equal(await secondOriginal.evaluate(node => node === document.activeElement), true);
    await secondOriginal.press('Tab');
    assert.equal(await page.locator('#editorBody [data-cue-index="1"] [data-edit-field="original"]').inputValue(), '편집 상태 미리보기 검증');

    await page.locator('#editorSearch').fill('__no_matching_subtitle__');
    assert.equal(await page.locator('#editorCueContext').isVisible(), false);
    assert.equal(await page.locator('#editorNextCue').isDisabled(), true);
    await page.locator('#editorSearch').fill('');
    assert.equal(await page.locator('#editorCueContext').isVisible(), true);
    await page.locator('#editorPrevCue').click();
    assert.match(await page.locator('#editorCuePosition').innerText(), /자막 1 \/ 2개/);
    assert.deepEqual(errors, []);

    for (const width of [320, 390, 800, 1280]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        const layout = await page.locator('#panel-edit .editor-layout').evaluate(node => ({
          mobileOrder: node.firstElementChild.classList.contains('player-card'),
          radius: getComputedStyle(document.querySelector('#editorCueContext')).borderRadius,
          shadow: getComputedStyle(document.querySelector('#editorCueContext')).boxShadow,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        }));
        assert.equal(layout.mobileOrder, true, 'media must be first in DOM');
        assert.equal(layout.radius, '0px');
        assert.equal(layout.shadow, 'none');
        assert.equal(layout.overflow, false, `horizontal overflow at ${width}px ${theme}`);
        if (width !== 320) {
          await mkdir(output, { recursive: true });
          await page.screenshot({ path: join(output, `web-editor-${width}-${theme}.png`), fullPage: true });
        }
      }
    }
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
