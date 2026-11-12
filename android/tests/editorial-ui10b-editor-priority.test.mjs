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
const output = join(root, 'output/editorial-2-2d');
const routes = {
  '/': 'android/web/index.html', '/app.js': 'android/web/app.js',
  '/styles.css': 'android/web/styles.css',
  '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
  '/shared/core.js': 'src/core.js',
  '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
  '/shared/edit-history.js': 'src/edit-history.js',
  '/shared/subtitle-player.js': 'src/subtitle-player.js',
};

async function withMockEditor(action) {
  const server = createServer(async (request, response) => {
    const path = routes[new URL(request.url, 'http://localhost').pathname];
    if (!path) { response.writeHead(404).end(); return; }
    try {
      const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' }[extname(path)] || 'application/octet-stream';
      response.setHeader('Content-Type', type);
      response.end(await readFile(join(root, path)));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => window.mockNative?.calls.some(x => x.method === 'status') && document.querySelector('.job'));
    await page.locator('#jobsView .job[data-job-id="complete-1"]').getByRole('button', { name: '자막 편집', exact: true }).click();
    await page.locator('#cueList .cue.selected textarea').first().waitFor({ state: 'visible' });
    await action(page);
    assert.deepEqual(errors, [], 'UI-10-B WebView must not throw');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
}

test('UI-10-B preserves IDs and editing contracts with selected cue first', async () => {
  const [html, css, js] = await Promise.all([
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
    readFile(join(root, 'android/web/app.js'), 'utf8'),
  ]);
  const scope = html.slice(html.indexOf('<section id="editorView"'), html.indexOf('<section id="settingsView"'));
  for (const id of ['editorFeedback', 'cueList', 'editorCueContext', 'editorTools', 'prevCue',
    'nextCue', 'previewSelectedCue', 'saveStatus', 'retrySave', 'editorCuePosition',
    'editorCueTiming', 'editorCueText', 'editorCueOriginal', 'editorVideoNote',
    'cueSearch', 'cueFilter', 'jumpForm', 'undo', 'redo', 'prevPage', 'nextPage']) {
    assert.equal((scope.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  const selected = scope.indexOf('id="cueList"');
  assert.ok(scope.indexOf('id="editorFeedback"') < scope.indexOf('id="editorPrimaryHeading"'));
  assert.ok(scope.indexOf('id="editorPrimaryHeading"') < selected);
  assert.ok(selected < scope.indexOf('id="editorCueContext"'));
  assert.ok(scope.indexOf('id="editorCueContext"') < scope.indexOf('id="editorTools"'));
  assert.match(scope, /<details id="editorCueContext" class="editor-cue-context">/);
  assert.match(css, /#editorView \.editor-primary-workspace \.cue-list/);
  assert.match(js, /saveTimer = setTimeout\(\(\) => \{ void flushSave\(\)\.catch\(\(\) => \{\}\); \}, 650\)/);
  for (const literal of ["nativeCall('saveCues'", "nativeCall('preview'", "function moveSelectedCue", "function editorTimeValue", "function renderCues"]) {
    assert.ok(js.includes(literal), 'preserve ' + literal);
  }
});

test('UI-10-B shows editable fields first; navigation, save and Native playback still work', { skip: !enabled }, async () => {
  await withMockEditor(async page => {
    assert.equal(await page.locator('#editorCueContext').evaluate(n => n.open), false);
    assert.equal(await page.locator('#editorTools').evaluate(n => n.open), false);
    const y = await page.evaluate(() => ({
      input: document.querySelector('#cueList .cue.selected .cue-times').getBoundingClientRect().top,
      context: document.querySelector('#editorCueContext').getBoundingClientRect().top,
      tools: document.querySelector('#editorTools').getBoundingClientRect().top,
      sticky: getComputedStyle(document.querySelector('#editorFeedback')).position,
    }));
    assert.ok(y.input < y.context && y.context < y.tools, 'selected input must come before helper tools');
    assert.equal(y.sticky, 'sticky');
    await page.locator('#nextCue').click();
    assert.equal(await page.locator('.cue.selected').getAttribute('data-index'), '1');
    const input = page.locator('.cue.selected textarea').first();
    await input.fill('UI-10-B 저장 테스트');
    assert.equal(await input.evaluate(n => n === document.activeElement), true);
    await page.waitForFunction(() => window.mockNative.calls.some(x => x.method === 'saveCues'));
    await page.waitForFunction(() => document.querySelector('#saveStatus').textContent.includes('기기에 저장됨'));
    await page.locator('#previewSelectedCue').click();
    await page.waitForFunction(() => window.mockNative.calls.some(x => x.method === 'preview' && x.params.positionMs === 3000));
    await page.locator('#editorCueContext > summary').click();
    assert.equal(await page.locator('#editorCueContext').evaluate(n => n.open), true);
    await page.locator('#editorTools > summary').click();
    assert.equal(await page.locator('#editorTools').evaluate(n => n.open), true);
  });
});

test('UI-10-B fits narrow screens and keyboard viewport, preserves flat visual system', { skip: !enabled }, async () => {
  await withMockEditor(async page => {
    await mkdir(output, { recursive: true });
    for (const width of [320, 390, 800]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        const m = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          buttons: [...document.querySelectorAll('#editorView .editor-primary-workspace button')].map(n => n.getBoundingClientRect().height),
          radius: getComputedStyle(document.querySelector('.editor-primary-workspace .cue.selected')).borderRadius,
          shadow: getComputedStyle(document.querySelector('.editor-primary-workspace .cue.selected')).boxShadow,
        }));
        assert.ok(m.documentWidth <= m.viewport + 1, width + '/' + theme + ' horizontal overflow');
        assert.ok(m.buttons.every(h => h >= 48), width + '/' + theme + ' undersized controls');
        assert.equal(m.radius, '0px');
        assert.equal(m.shadow, 'none');
        if (width === 390) {
          await page.screenshot({ path: join(output, 'ui10b-active-' + width + '-' + theme + '.png'), animations: 'disabled', fullPage: true });
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 480 });
    const input = page.locator('#cueList .cue.selected textarea').first();
    await input.focus();
    assert.equal(await input.evaluate(n => n === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  });
});
