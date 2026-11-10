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
const output = join(root, 'output/editorial-4b');
const widths = [320, 360, 390, 432, 800, 1280];

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

function ratio(first, second) {
  const luminance = (hex) => {
    const rgb = hex.trim().replace('#', '').match(/../g).map(value => parseInt(value, 16) / 255);
    const [r, g, b] = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('4-B confirms contrast tokens, focus and touch targets exist for both interfaces', async () => {
  const [web, mobile, html, native] = await Promise.all([
    readFile(join(root, 'styles.css'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
    readFile(join(root, 'index.html'), 'utf8'),
    readFile(join(root, 'android/web/index.html'), 'utf8'),
  ]);
  for (const [name, ink, muted, bg] of [
    ['light', '#171717', '#626262', '#FFFFFF'],
    ['dark', '#F2F2F2', '#ADADAD', '#242424'],
  ]) {
    assert.ok(ratio(ink, bg) >= 4.5, name + ' primary text contrast');
    assert.ok(ratio(muted, bg) >= 4.5, name + ' secondary text contrast');
  }
  assert.match(web, /button:focus-visible/);
  assert.match(mobile, /:focus-visible/);
  assert.match(mobile, /@media \(max-width: 480px\)/);
  assert.match(mobile, /\.app-nav button \{[\s\S]*?white-space: normal/);
  assert.match(html, /id="tab-export"/);
  assert.match(html, /id="exportDownloadStatus"[^>]+aria-live="polite"/);
  assert.match(native, /id="appMessage"[^>]+role="status"/);
  assert.match(native, /id="saveStatus" role="status"/);
  assert.match(native, /id="confirmClearKey"/);
});

async function withApp(isNative, action) {
  const server = createServer(async (request, response) => {
    const uri = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = isNative ? nativeRoutes[uri] : uri === '/' ? 'index.html' : uri.slice(1);
    const allowed = isNative ? Boolean(file)
      : ['index.html', 'styles.css', 'favicon.ico', 'favicon.png',
        'assets/brand/editorial-mark-white.png', 'apple-touch-icon.png'].includes(file)
        || /^src\/[a-z0-9-]+\.js$/.test(file || '');
    if (!allowed) { response.writeHead(404).end(); return; }
    try {
      const mime = file.endsWith('.js') ? 'text/javascript; charset=utf-8'
        : file.endsWith('.css') ? 'text/css; charset=utf-8'
        : file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
      response.setHeader('Content-Type', mime);
      response.end(await readFile(join(root, file)));
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
      viewport: { width: 390, height: 844 },
      colorScheme: 'light',
      reducedMotion: 'reduce',
      locale: 'ko-KR',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (isNative) await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.locator(isNative ? '#navJobs' : '#tab-generate').waitFor();
    if (isNative) {
      await page.waitForFunction(() => window.mockNative?.calls.some(call => call.method === 'status')
        && Boolean(document.querySelector('.job')));
    }
    await action(page);
    assert.deepEqual(errors, [], (isNative ? 'Android WebView' : 'Web') + ' has no uncaught client exceptions');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function checkBounds(page, label, isNative) {
  const result = await page.evaluate(native => {
    const nav = native ? document.querySelector('.app-nav') : document.querySelector('.workspace-tabs');
    const buttons = [...nav.querySelectorAll('button')].map(button => {
      const box = button.getBoundingClientRect();
      return {
        height: box.height,
        scrollWidth: button.scrollWidth,
        clientWidth: button.clientWidth,
        scrollHeight: button.scrollHeight,
        clientHeight: button.clientHeight,
        name: button.innerText,
      };
    });
    const rectangle = nav.getBoundingClientRect();
    return {
      docWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      navTop: rectangle.top,
      navBottom: rectangle.bottom,
      viewportHeight: window.innerHeight,
      buttons,
    };
  }, isNative);
  assert.ok(result.docWidth <= result.viewportWidth + 1,
    label + ': horizontal overflow (' + result.docWidth + ' > ' + result.viewportWidth + ')');
  for (const button of result.buttons) {
    assert.ok(button.height >= 48, label + ': small navigation touch target ' + button.name);
    assert.ok(button.scrollWidth <= button.clientWidth + 2, label + ': clipped navigation text ' + button.name);
    assert.ok(button.scrollHeight <= button.clientHeight + 2, label + ': clipped navigation height ' + button.name);
  }
  if (isNative) {
    assert.ok(result.navTop >= -1 && result.navBottom <= result.viewportHeight + 1,
      label + ': bottom navigation must remain visible');
  }
}

test('4-B web: six widths, both themes, reflow, keyboard tabs, imports and export controls', { skip: !enabled }, async () => {
  await withApp(false, async page => {
    await page.locator('#tab-generate').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#tab-edit').getAttribute('aria-selected'), 'true');
    await page.locator('#tab-generate').click();
    assert.equal(await page.locator('#startButton').isDisabled(), true);
    await page.locator('#tab-edit').click();
    await page.locator('#subtitleFile').setInputFiles({
      name: '검수_' + '자막'.repeat(24) + '.srt',
      mimeType: 'text/plain',
      buffer: Buffer.from('1\n00:00:01,000 --> 00:00:03,000\n' + '길고 다양한 자막 내용 '.repeat(12) + '\n', 'utf8'),
    });
    await page.locator('#editorBody [data-cue-index]').first().waitFor();
    await page.locator('#editorBody [data-edit-field="original"]').first().focus();
    assert.equal(await page.locator('#editorBody [data-edit-field="original"]').first()
      .evaluate(node => node === document.activeElement), true);
    await page.locator('#tab-export').click();
    assert.ok(await page.locator('#downloads a.download-link').count() >= 3);
    assert.equal(await page.locator('#exportEmptyActions').isVisible(), false);

    await mkdir(output, { recursive: true });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme });
        for (const tab of ['generate', 'edit', 'export']) {
          await page.locator('#tab-' + tab).click();
          await checkBounds(page, 'web ' + tab + ' ' + width + '/' + theme, false);
          assert.equal(await page.locator('#panel-' + tab).isVisible(), true);
        }
        if ([390, 800, 1280].includes(width)) {
          await page.locator('#tab-edit').click();
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: join(output, 'web-edit-' + width + '-' + theme + '.png'),
            animations: 'disabled',
            fullPage: false,
          });
          await page.locator('#tab-export').click();
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: join(output, 'web-export-' + width + '-' + theme + '.png'),
            animations: 'disabled',
            fullPage: false,
          });
        }
      }
    }
    await page.locator('#tab-edit').click();
    await page.setViewportSize({ width: 390, height: 480 });
    const textarea = page.locator('#editorBody [data-edit-field="original"]').first();
    await textarea.focus();
    assert.equal(await textarea.evaluate(node => node === document.activeElement), true);
    await page.keyboard.insertText('짧은 화면 키보드 입력 테스트');
    assert.match(await textarea.inputValue(), /짧은 화면 키보드 입력 테스트/);
    await checkBounds(page, 'web short editor', false);
    await page.screenshot({
      path: join(output, 'web-edit-390-short-input.png'), animations: 'disabled', fullPage: false,
    });
  });
});

test('4-B Android WebView: all views at six widths, dark/light, keyboard and short viewport', { skip: !enabled }, async () => {
  await withApp(true, async page => {
    const navigation = [
      ['video', '#navVideo', '#videoView'],
      ['jobs', '#navJobs', '#jobsView'],
      ['results', '#navResults', '#resultsView'],
      ['settings', '#navSettings', '#settingsView'],
    ];
    await mkdir(output, { recursive: true });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme });
        for (const [name, nav, panel] of navigation) {
          await page.locator(nav).click();
          await page.locator(panel).waitFor({ state: 'visible' });
          assert.equal(await page.locator(panel).isVisible(), true);
          await checkBounds(page, 'android ' + name + ' ' + width + '/' + theme, true);
        }
        await page.locator('#navJobs').click();
        await page.locator('#jobList .job[data-job-id="complete-1"]')
          .getByRole('button', { name: '자막 편집', exact: true }).click();
        await page.locator('#editorView .cue.selected textarea').first().waitFor({ state: 'visible' });
        await checkBounds(page, 'android editor ' + width + '/' + theme, true);
        const navVisible = await page.locator('#navResults').getAttribute('aria-current');
        assert.equal(navVisible, 'page', 'editor should keep results navigation current');
        if ([390, 800].includes(width)) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: join(output, 'android-editor-' + width + '-' + theme + '.png'),
            animations: 'disabled',
            fullPage: false,
          });
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 480 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('#navResults').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#resultsView').isVisible(), true);
    await page.locator('#editResult').click();
    const input = page.locator('#editorView .cue.selected textarea').first();
    await input.waitFor({ state: 'visible' });
    await input.focus();
    await page.keyboard.insertText('짧은 화면에서 수정한 글자');
    assert.equal(await input.evaluate(node => node === document.activeElement), true);
    assert.match(await input.inputValue(), /짧은 화면에서 수정한 글자/);
    assert.equal(await page.locator('#saveStatus').getAttribute('role'), 'status');
    await checkBounds(page, 'android short editor 390/dark', true);
    await page.screenshot({
      path: join(output, 'android-editor-390-short-input-dark.png'),
      animations: 'disabled', fullPage: false,
    });
    await page.locator('#navSettings').click();
    assert.equal(await page.locator('#settingsView').isVisible(), true);
    await page.locator('#settingsOpenConnection').click();
    await page.locator('#apiSettings > summary').focus();
    assert.equal(await page.locator('#apiSettings > summary')
      .evaluate(node => node === document.activeElement), true);
    await page.locator('#requestClearKey').click();
    assert.equal(await page.locator('#confirmClearKey').isVisible(), true);
    assert.equal(await page.locator('#cancelClearKey')
      .evaluate(node => node === document.activeElement), true);
    await checkBounds(page, 'android confirm key 390/short', true);
  });
});
