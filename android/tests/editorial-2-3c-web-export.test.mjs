import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const output = join(root, 'output/editorial-3c');
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const require = createRequire(import.meta.url);

test('3-C export keeps selected job, file formats, partial failure, real download request, and retry', { skip: !enabled }, async () => {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const assetPath = requestedPath.startsWith('/tests/assets/') ? requestedPath.slice('/tests'.length) : requestedPath;
    const filePath = resolve(root, '.' + assetPath);
    if (!filePath.startsWith(root + '/') || pathname.includes('..')) {
      response.writeHead(404).end();
      return;
    }
    try {
      const ext = extname(filePath);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
        '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
      response.setHeader('Content-Type', type);
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, colorScheme: 'light', locale: 'ko-KR', acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = 'http://127.0.0.1:' + server.address().port;

    await page.goto(base + '/');
    await page.locator('#tab-export').click();
    assert.equal(await page.locator('#exportResultSelect').isDisabled(), true);
    assert.equal(await page.locator('#exportResultStatus').innerText(), '저장할 자막 없음');
    assert.equal(await page.locator('#exportEmptyActions').isVisible(), true);
    assert.equal(await page.locator('#downloads button:disabled').count(), 3);

    await page.goto(base + '/tests/browser-workflow.html');
    await page.waitForFunction(() => window.__workflowDone === true, null, { timeout: 90000 });
    const report = JSON.parse(await page.locator('#workflowResults').textContent());
    assert.equal(report.failed, 0, JSON.stringify(report.results.filter(item => !item.passed)));
    await page.locator('#workflowResults').evaluate(node => { node.hidden = true; });
    await page.locator('#tab-export').click();

    const firstId = await page.locator('#exportResultSelect option').evaluateAll(options =>
      options.find(option => option.textContent.includes('first.mp4'))?.value);
    const secondId = await page.locator('#exportResultSelect option').evaluateAll(options =>
      options.find(option => option.textContent.includes('second.mp4'))?.value);
    assert.ok(firstId && secondId, 'fixture must provide two selectable batch results');

    await page.locator('#exportResultSelect').selectOption(firstId);
    assert.equal(await page.locator('#jobResultSelect').inputValue(), firstId);
    assert.equal(await page.locator('#exportFileName').innerText(), 'first.mp4');
    assert.match(await page.locator('#exportResultStatus').innerText(), /자막 [0-9]+개/);
    assert.equal(await page.locator('#exportEmptyActions').isVisible(), false);

    const firstLinks = page.locator('#downloads a[download]');
    assert.equal(await firstLinks.count(), 3);
    assert.match(await firstLinks.nth(0).getAttribute('class'), /download-link--primary/);
    assert.match(await firstLinks.nth(0).getAttribute('download'), /first.*\.srt$/);
    assert.match(await firstLinks.nth(1).getAttribute('download'), /\.vtt$/);
    assert.match(await firstLinks.nth(2).getAttribute('download'), /\.subtitles\.json$/);
    assert.equal(await page.locator('#exportBuildError').isVisible(), false);

    const downloadPending = page.waitForEvent('download');
    await firstLinks.first().click();
    const download = await downloadPending;
    assert.match(download.suggestedFilename(), /\.srt$/);
    assert.match(await page.locator('#exportDownloadStatus').innerText(), /다운로드 요청됨/);
    assert.doesNotMatch(await page.locator('#exportDownloadStatus').innerText(), /저장 완료/);

    await page.locator('#exportResultSelect').selectOption(secondId);
    assert.equal(await page.locator('#jobResultSelect').inputValue(), secondId);
    assert.match(await page.locator('#exportFileName').innerText(), /second\.mp4/);
    assert.match(await page.locator('#downloads a[download]').first().getAttribute('download'), /second/);
    assert.doesNotMatch(await page.locator('#exportDownloadStatus').innerText(), /다운로드 요청됨/);

    const incompleteId = await page.locator('#exportResultSelect option').evaluateAll(options =>
      options.find(option => option.textContent.includes('cancel-translation.mp4'))?.value);
    assert.ok(incompleteId, 'fixture must preserve cancelled translation output');
    await page.locator('#exportResultSelect').selectOption(incompleteId);
    assert.equal(await page.locator('#exportResultStatus').getAttribute('data-state'), 'partial');
    assert.match(await page.locator('#exportResultStatus').innerText(), /원문 보존/);
    assert.equal(await page.locator('#translationFailureSummary').isVisible(), true);
    assert.equal(await page.locator('#downloads a[download]').count(), 4);

    await page.locator('#exportResultSelect').selectOption(firstId);
    await page.evaluate(() => {
      window.__exportCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = () => { throw new Error('simulated blob failure'); };
      document.querySelector('#subtitleSyncReset').click();
    });
    assert.equal(await page.locator('#exportBuildError').isVisible(), true);
    assert.equal(await page.locator('#exportResultStatus').getAttribute('data-state'), 'error');
    assert.equal(await page.locator('#downloads a[download]').count(), 0);
    assert.equal(await page.locator('#downloads button:disabled').count(), 3);
    assert.match(await page.locator('#exportBuildErrorText').innerText(), /편집 내용은 유지/);
    await page.evaluate(() => {
      URL.createObjectURL = window.__exportCreateObjectURL;
      delete window.__exportCreateObjectURL;
    });
    await page.locator('#retryExportButton').click();
    assert.equal(await page.locator('#exportBuildError').isVisible(), false);
    assert.equal(await page.locator('#downloads a[download]').count(), 3);
    assert.equal(await page.locator('#exportResultStatus').getAttribute('data-state'), 'ready');

    await page.locator('.export-format-details > summary').click();
    assert.equal(await page.locator('.export-format-details .format-guide').isVisible(), true);
    await page.locator('.export-format-details > summary').click();

    for (const width of [320, 390, 800, 1280]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        await page.evaluate(() => window.scrollTo(0, 0));
        const visual = await page.locator('#panel-export .export-overview').evaluate(node => ({
          borderRadius: getComputedStyle(node).borderRadius,
          boxShadow: getComputedStyle(node).boxShadow,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        }));
        assert.equal(visual.borderRadius, '0px');
        assert.equal(visual.boxShadow, 'none');
        assert.equal(visual.overflow, false, '3-C horizontal overflow ' + width + 'px ' + theme);
        if (width === 390 || width === 800 || width === 1280) {
          await mkdir(output, { recursive: true });
          await page.screenshot({
            path: join(output, 'web-export-' + width + '-' + theme + '.png'),
            fullPage: true,
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
