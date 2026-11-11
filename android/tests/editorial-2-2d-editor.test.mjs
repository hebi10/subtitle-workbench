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
const output = join(root, 'output/editorial-2-2d');

test('2-D retains existing editing IDs, Native bridge, feedback toolbar and new cue context', async () => {
  const [html, css, js] = await Promise.all([
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
    readFile(join(root, 'android/web/app.js'), 'utf8'),
  ]);
  for (const id of ['editorView', 'editorCueContext', 'editorCuePosition', 'editorCueTiming',
    'editorCueText', 'editorCueOriginal', 'editorVideoNote', 'prevCue', 'nextCue',
    'previewSelectedCue', 'editorTools', 'editorFeedback', 'cueList', 'cueSearch', 'cueFilter',
    'preview', 'undo', 'redo', 'saveStatus', 'retrySave', 'prevPage', 'nextPage']) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  assert.ok(html.indexOf('id="editorFeedback"') < html.indexOf('id="editorCueContext"'));
  assert.ok(html.indexOf('id="editorCueContext"') < html.indexOf('id="editorTools"'));
  assert.ok(html.indexOf('id="editorTools"') < html.indexOf('id="cueList"'));
  assert.ok(html.indexOf('id="editorCueContext"') < html.indexOf('id="cueList"'));
  assert.match(js, /prevCue: \(\) => moveSelectedCue\(-1\)/);
  assert.match(js, /nextCue: \(\) => moveSelectedCue\(1\)/);
  assert.match(js, /previewSelectedCue: \(\) => previewAt\(Math\.round\(history\.present\[selectedIndex\]\.start \* 1000\)\)/);
  assert.match(js, /const filtered = filteredIndices\(\)/);
  assert.match(js, /updateEditorCueContext\(\)/);
  assert.match(css, /#editorView \.editor-cue-context > summary/);
  assert.match(css, /#editorView \.cue\.selected \.cue-detail textarea/);
  assert.match(css, /@media \(max-width: 360px\)/);
});

async function withApp(action) {
  const paths = {
    '/': 'android/web/index.html', '/styles.css': 'android/web/styles.css',
    '/app.js': 'android/web/app.js',
    '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
    '/shared/core.js': 'src/core.js', '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
    '/shared/edit-history.js': 'src/edit-history.js', '/shared/subtitle-player.js': 'src/subtitle-player.js',
  };
  const server = createServer(async (request, response) => {
    const path = paths[new URL(request.url, 'http://localhost').pathname];
    if (!path) { response.writeHead(404).end(); return; }
    try {
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript; charset=utf-8' :
        path.endsWith('.css') ? 'text/css; charset=utf-8' :
        path.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
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
    page.setDefaultTimeout(12000);
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => window.mockNative?.calls.some(c => c.method === 'status') && document.querySelector('.job'));
    await action(page);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function openEditor(page) {
  await page.locator('#jobsView .job[data-job-id="complete-1"]').getByRole('button', { name: '자막 편집', exact: true }).click();
  await page.locator('#editorView .cue.selected textarea').first().waitFor({ state: 'visible' });
}

test('2-D synchronizes context, navigation and Native playback with actual cue time', { skip: !enabled }, async () => {
  await withApp(async page => {
    await openEditor(page);
    assert.match(await page.locator('#editorCuePosition').innerText(), /자막 1 \/ 27개/);
    assert.match(await page.locator('#editorCueText').innerText(), /테스트 번역 자막 1/);
    assert.equal(await page.locator('#prevCue').isDisabled(), true);
    assert.equal(await page.locator('#previewSelectedCue').isEnabled(), true);
    await page.locator('#nextCue').click();
    assert.match(await page.locator('#editorCuePosition').innerText(), /자막 2 \/ 27개/);
    assert.equal(await page.locator('.cue.selected').getAttribute('data-index'), '1');
    await page.locator('#previewSelectedCue').click();
    await page.waitForFunction(() => window.mockNative.calls.some(c => c.method === 'preview' && c.params.positionMs === 3000));
    const lastPreview = await page.evaluate(() => window.mockNative.calls.filter(c => c.method === 'preview').at(-1).params);
    assert.deepEqual(lastPreview, { jobId: 'complete-1', positionMs: 3000 });
    await page.locator('#prevCue').click();
    assert.equal(await page.locator('.cue.selected').getAttribute('data-index'), '0');
    assert.equal(await page.locator('#prevCue').isDisabled(), true);

    const source = page.locator('#editorView .cue.selected textarea').first();
    await source.fill('고친 원문 텍스트');
    assert.equal(await source.inputValue(), '고친 원문 텍스트');
    assert.match(await page.locator('#editorCueOriginal').textContent(), /고친 원문 텍스트/);
    assert.equal(await source.evaluate(node => node === document.activeElement), true,
      'updating subtitle context must not replace the focused textarea');
    const translation = page.locator('#editorView .cue.selected textarea').nth(1);
    await translation.fill('고친 번역 텍스트');
    assert.match(await page.locator('#editorCueText').innerText(), /고친 번역 텍스트/);
    assert.equal(await translation.evaluate(node => node === document.activeElement), true);
    await page.locator('#editorTools > summary').click();
    await page.locator('#undo').click();
    assert.match(await page.locator('#editorCueText').innerText(), /테스트 번역 자막 1/);
    await page.locator('#redo').click();
    assert.match(await page.locator('#editorCueText').innerText(), /고친 번역 텍스트/);

    for (const width of [320, 390, 800]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false, '2-D editor horizontal overflow ' + width + ' ' + theme);
        const styles = await page.locator('#editorCueContext').evaluate(node => {
          const computed = getComputedStyle(node);
          return { radius: computed.borderRadius, shadow: computed.boxShadow };
        });
        assert.equal(styles.radius, '0px');
        assert.equal(styles.shadow, 'none');
        if (width === 390 || width === 800) {
          await page.locator('#editorCueContext').scrollIntoViewIfNeeded();
          await mkdir(output, { recursive: true });
          await page.screenshot({
            path: join(output, 'editor-' + width + '-' + theme + '.png'),
            fullPage: true,
          });
        }
      }
    }
  });
});

test('2-D cue navigation honors search and does not invent video availability', { skip: !enabled }, async () => {
  await withApp(async page => {
    await openEditor(page);
    await page.locator('#editorTools > summary').click();
    await page.locator('#cueSearch').fill('테스트 번역 자막 2');
    assert.equal(await page.locator('.cue.selected').getAttribute('data-index'), '1');
    await page.locator('#nextCue').click();
    assert.equal(await page.locator('.cue.selected').getAttribute('data-index'), '19',
      'next cue should follow filtered results across pages');
    assert.match(await page.locator('#editorCuePosition').innerText(), /자막 20 \/ 27개/);
    await page.locator('#prevCue').click();
    assert.equal(await page.locator('.cue.selected').getAttribute('data-index'), '1');
    await page.locator('#editorCueContext > summary').click();
    assert.equal(await page.locator('#editorCueContext').getAttribute('open'), null);
    await page.locator('#editorCueContext > summary').click();

    await page.locator('#navVideo').click();
    await page.locator('#importSubtitles').click();
    await page.locator('#editorView').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#previewSelectedCue').isDisabled(), true,
      'imported subtitle has no video URI');
    assert.match(await page.locator('#editorVideoNote').innerText(), /연결된 영상이 없어/);
    assert.equal(await page.locator('#editorCueContext').isVisible(), true);
  });
});

test('2-D keyboard viewport preserves the selected edit and sticky save feedback', { skip: !enabled }, async () => {
  await withApp(async page => {
    await openEditor(page);
    await page.setViewportSize({ width: 390, height: 480 });
    const textarea = page.locator('#editorView .cue.selected textarea').first();
    await textarea.focus();
    await textarea.fill('키보드 축소 화면 테스트');
    assert.equal(await textarea.inputValue(), '키보드 축소 화면 테스트');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const bar = await page.locator('#editorFeedback').evaluate(node => ({
      position: getComputedStyle(node).position,
      scrollMargin: getComputedStyle(document.querySelector('.cue.selected')).scrollMarginTop,
    }));
    assert.equal(bar.position, 'sticky');
    assert.match(bar.scrollMargin, /px/);
  });
});

test('UI-09-E prioritizes editable text, normalizes displayed time and preserves saved values', { skip: !enabled }, async () => {
  await withApp(async page => {
    await page.evaluate(() => { window.mockNative.cues['complete-1'][5].end = 17.150000000000002; });
    await openEditor(page);
    assert.equal(await page.locator('#editorTools').evaluate(node => node.open), false,
      'secondary actions must initially be collapsed');
    await page.locator('#cueList [data-index="5"] .cue-summary').click();
    const selected = page.locator('#cueList .cue.selected');
    assert.equal(await selected.getAttribute('data-index'), '5');
    const order = await selected.locator('.cue-detail').evaluate(detail =>
      [...detail.children].slice(0, 4).map(node =>
        node.classList.contains('cue-times') ? '시간' : node.firstChild.textContent.trim()));
    assert.deepEqual(order, ['시간', '원문', '번역', '화자 식별 (빈칸이면 미지정)']);
    const endTime = selected.locator('.cue-times input').nth(1);
    assert.equal(await endTime.inputValue(), '17.15',
      'long floating point precision must not leak into the time input');
    assert.equal(await page.evaluate(() => window.mockNative.cues['complete-1'][5].end),
      17.150000000000002, 'display formatting must not mutate stored data');
    await endTime.fill('17.125');
    await endTime.dispatchEvent('change');
    await page.waitForFunction(() => window.mockNative.cues['complete-1'][5].end === 17.125);
    await page.locator('#navJobs').click();
    await openEditor(page);
    await page.locator('#cueList [data-index="5"] .cue-summary').click();
    assert.equal(await page.locator('#cueList .cue.selected .cue-times input').nth(1).inputValue(),
      '17.125', 'time edit must survive native save and reload');
    const source = page.locator('#cueList .cue.selected textarea').first();
    for (const width of [320, 390, 800]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        await source.focus();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false, 'UI-09-E overflow at ' + width + ' ' + theme);
        assert.equal(await page.locator('#editorFeedback').evaluate(node => getComputedStyle(node).position),
          'sticky');
        if (width === 390) {
          await mkdir(output, { recursive: true });
          await page.screenshot({ path: join(output, 'ui09e-editor-' + width + '-' + theme + '.png'),
            fullPage: true, animations: 'disabled' });
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 480 });
    await source.focus();
    assert.equal(await source.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false, 'keyboard-sized editor must not scroll horizontally');
  });
});
