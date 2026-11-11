import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const out = join(root, 'output/editorial-4a');
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);

test('4-A semantic layout retains all stateful web DOM endpoints', async () => {
  const [html, css] = await Promise.all([
    readFile(join(root, 'index.html'), 'utf8'),
    readFile(join(root, 'styles.css'), 'utf8'),
  ]);
  for (const id of [
    'videoFile','videoPreview','mediaPlayer','generatePlayerMount','runPanel','startButton',
    'tab-generate','tab-edit','tab-export','editorSearch','editorStatusFilter',
    'editorGlobalOffset','applyGlobalOffset','mergeShortSubtitles','undoEdit','redoEdit',
    'editorBody','editPlayerMount','subtitleFile','downloads','exportEmptyActions',
    'exportSubtitleCount','translationFailureSummary','logOutput',
    'generateWorkflowStatus','editorWorkspaceStatus','exportWorkflowStatus',
  ]) assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, 'Missing or duplicated ' + id);
  assert.match(html, /studio-preview-card/);
  assert.match(html, /studio-export-layout/);
  assert.match(html, /studio-toolgroup-label/);
  assert.ok(html.indexOf('id="generatePlayerMount"') < html.indexOf('id="runPanel"'), 'Media preview precedes progress');
  assert.ok(html.indexOf('id="downloads"') < html.indexOf('class="format-guide"'), 'Downloads precede format guidance');
  assert.match(css, /#panel-edit \.editor-table-wrap \{[\s\S]*?overflow:visible/);
  assert.match(css, /#panel-export \.studio-export-layout/);
  assert.match(css, /UI-09-G: task-context messages/);
  const app = await readFile(join(root, 'src/app.js'), 'utf8');
  assert.match(app, /updateEditorWorkspaceStatus\(\)/);
  assert.match(app, /exportWorkflowStatus\.dataset\.state/);
});

test('4-A desktop and mobile workspaces preserve UI, source import and exports', { skip: !enabled }, async () => {
  const server = createServer(async (req, res) => {
    const uri = new URL(req.url, 'http://localhost').pathname;
    const file = uri === '/' ? 'index.html' : uri.slice(1);
    const allowed = ['index.html','styles.css','favicon.ico','favicon.png',
      'assets/brand/editorial-mark-white.png','apple-touch-icon.png'].includes(file) ||
      /^src\/[a-z0-9-]+\.js$/.test(file);
    if (!allowed) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type',
        file.endsWith('.png') ? 'image/png' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' :
        file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
      res.end(await readFile(join(root, file)));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  let browser;
  try {
    await mkdir(out, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', locale: 'ko-KR' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.locator('#tab-generate').waitFor();
    await page.waitForFunction(() => document.getElementById('generateWorkflowStatus').textContent.includes('파일을 선택'));
    assert.equal(await page.locator('#generateWorkflowStatus').getAttribute('data-state'), 'empty');
    await page.locator('#tab-edit').click();
    assert.equal(await page.locator('#editorWorkspaceStatus').getAttribute('data-state'), 'empty');
    await page.locator('#tab-export').click();
    assert.equal(await page.locator('#exportWorkflowStatus').getAttribute('data-state'), 'empty');

    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const mode of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: mode });
        for (const tab of ['generate', 'edit', 'export']) {
          await page.locator('#tab-' + tab).click();
          assert.equal(await page.locator('#tab-' + tab).getAttribute('aria-selected'), 'true');
          assert.equal(await page.locator('#panel-' + tab).isVisible(), true);
          const metrics = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            viewport: innerWidth,
          }));
          assert.ok(metrics.width <= width + 1, '4-A ' + tab + ' ' + width + ' ' + mode + ': horizontal overflow');
          if (tab === 'generate') {
            assert.equal(await page.locator('.studio-preview-card #generatePlayerMount #mediaPlayer').count(), 1);
            const preview = await page.locator('.studio-preview-card').boundingBox();
            const controls = await page.locator('#panel-generate .tool-panel').boundingBox();
            const status = await page.locator('#runPanel').boundingBox();
            assert.ok(preview && status && controls, 'Source, preview and progress all exist');
            assert.ok(preview.y < status.y, 'Preview must appear above the processing status');
            if (width === 1280) assert.ok(preview.x > controls.x + controls.width - 2, 'Desktop preview must be on the right');
          }
          if (tab === 'edit') {
            assert.equal(await page.locator('.editor-toolbar .editor-toolgroup').count(), 2);
            assert.equal(await page.locator('.editor-toolgroup #editorSearch').count(), 1);
            assert.equal(await page.locator('.editor-toolgroup #editorGlobalOffset').count(), 1);
            const scroll = await page.locator('.editor-table-wrap').evaluate(el => getComputedStyle(el).overflowY);
            assert.equal(scroll, 'visible', 'Edit list should use a single document scroll');
          }
          if (tab === 'export') {
            assert.equal(await page.locator('.studio-export-files #downloads').count(), 1);
            assert.equal(await page.locator('.studio-export-formats .format-guide dt').count(), 3);
          }
          if (width !== 320) {
            await page.screenshot({
              path: join(out, tab + '-' + width + '-' + mode + '.png'),
              fullPage: false, animations: 'disabled',
            });
          }
        }
      }
    }

    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('#subtitleFile').setInputFiles({
      name: '4a-fixture.srt',
      mimeType: 'text/plain',
      buffer: Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nSample subtitle\n', 'utf8'),
    });
    await page.waitForFunction(() => document.querySelectorAll('#downloads a[download]').length >= 3);
    await page.locator('#tab-edit').click();
    assert.ok(await page.locator('#editorBody [data-cue-index]').count() >= 1, 'Imported SRT should remain editable');
    assert.equal(await page.locator('#editorWorkspaceStatus').getAttribute('data-state'), 'ready');
    assert.match(await page.locator('#editorWorkspaceStatus').innerText(), /영상 미연결/);
    assert.equal(await page.locator('#editorSearch').isEnabled(), true);
    await page.locator('#editorSearch').fill('Sample');
    assert.ok(await page.locator('#editorBody [data-cue-index]').count() >= 1, 'Existing search must still filter cues');
    await page.locator('#editorSearch').fill('__not_in_the_subtitles__');
    assert.equal(await page.locator('#editorWorkspaceStatus').getAttribute('data-state'), 'filtered');
    assert.match(await page.locator('#editorWorkspaceStatus').innerText(), /원본 자막은 유지/);
    await page.locator('#editorSearch').fill('');
    assert.equal(await page.locator('#editorWorkspaceStatus').getAttribute('data-state'), 'ready');
    await page.screenshot({ path: join(out, 'edit-imported-1280-light.png'), animations: 'disabled' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: join(out, 'edit-imported-1280-dark.png'), animations: 'disabled' });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('#tab-export').click();
    assert.equal(await page.locator('#exportWorkflowStatus').getAttribute('data-state'), 'ready');
    assert.match(await page.locator('#exportWorkflowStatus').innerText(), /브라우저 다운로드 내역/);
    const downloads = await page.locator('#downloads a[download]').evaluateAll(
      nodes => nodes.map(node => ({ filename: node.download, href: node.getAttribute('href') }))
    );
    assert.ok(downloads.some(d => d.filename.endsWith('.srt')));
    assert.ok(downloads.some(d => d.filename.endsWith('.vtt')));
    assert.ok(downloads.some(d => d.filename.endsWith('.json')));
    assert.ok(downloads.every(d => d.href?.startsWith('blob:')));
    await page.screenshot({ path: join(out, 'export-imported-1280-light.png'), animations: 'disabled' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: join(out, 'export-imported-1280-dark.png'), animations: 'disabled' });
    assert.deepEqual(errors, [], 'No client errors should arise from moving the workspace panels');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
});
