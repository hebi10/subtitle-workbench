import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const captureDir = join(root, 'output/editorial-theme');

async function capture(page, name) {
  await mkdir(captureDir, { recursive: true });
  await page.screenshot({ path: join(captureDir, name + '.png'), fullPage: true, animations: 'disabled' });
}
const clean = (value) => value.toLowerCase().replace(/\s+/g, '');
const palette = {
  light: { bg: 'rgb(245,245,245)', surface: 'rgb(255,255,255)', text: 'rgb(23,23,23)', action: 'rgb(255,255,255)' },
  dark: { bg: 'rgb(20,20,20)', surface: 'rgb(36,36,36)', text: 'rgb(242,242,242)', action: 'rgb(23,23,23)' },
};

test('Editorial Studio Android day/night resources and tokens match both CSS palettes', async () => {
  const files = await Promise.all([
    'android/app/src/main/java/com/haebi/subtitle/NativeDesignSystem.java',
    'android/app/src/main/res/values/styles.xml',
    'android/app/src/main/res/values-night/styles.xml',
    'android/app/src/main/res/values-night-v27/styles.xml',
    'android/web/styles.css',
    'styles.css',
  ].map((file) => readFile(join(root, file), 'utf8')));
  const [native, day, night, nightNav, mobileCss, webCss] = files;
  assert.match(native, /Configuration\.UI_MODE_NIGHT_YES/);
  assert.match(native, /NIGHT_CANVAS\s*=\s*Color\.rgb\(20,\s*20,\s*20\)/);
  assert.match(native, /DAY_CANVAS\s*=\s*Color\.rgb\(245,\s*245,\s*245\)/);
  assert.match(day, /Theme\.Material\.Light\.NoActionBar/);
  assert.match(night, /Theme\.Material\.NoActionBar/);
  assert.match(nightNav, /windowLightNavigationBar">false/);
  for (const css of [mobileCss, webCss]) {
    assert.match(css, /prefers-color-scheme:\s*dark/);
    assert.match(css, /--es-canvas:\s*#141414/i);
    assert.match(css, /--es-surface:\s*#242424/i);
    assert.match(css, /--es-ink:\s*#F2F2F2/i);
  }
});

async function withPage(mobile, action) {
  const paths = mobile ? {
    '/': 'android/web/index.html', '/app.js': 'android/web/app.js',
    '/styles.css': 'android/web/styles.css', '/editorial-mark-white.png': 'android/web/editorial-mark-white.png', '/shared/core.js': 'src/core.js',
    '/shared/subtitle-editor.js': 'src/subtitle-editor.js', '/shared/edit-history.js': 'src/edit-history.js',
    '/shared/subtitle-player.js': 'src/subtitle-player.js',
  } : null;
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = mobile ? paths[pathname] : pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!file || (!mobile && !/^(?:index\.html|styles\.css|assets\/brand\/editorial-mark-white\.png|src\/[a-z0-9-]+\.js)$/.test(file))) {
      response.writeHead(404).end(); return;
    }
    try {
      response.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html');
      response.end(await readFile(join(root, file)));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    if (mobile) await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await action(page);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
}

async function assertPalette(page, theme, selectors) {
  await page.emulateMedia({ colorScheme: theme });
  const values = await page.evaluate(({ panel, selected }) => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      bg: style('body').backgroundColor,
      surface: style(panel).backgroundColor,
      text: style('body').color,
      action: style(selected).color,
      selected: style(selected).backgroundColor,
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      key: document.querySelector('#apiKey').value,
    };
  }, selectors);
  const expected = palette[theme];
  assert.equal(clean(values.bg), expected.bg);
  assert.equal(clean(values.surface), expected.surface);
  assert.equal(clean(values.text), expected.text);
  assert.equal(clean(values.action), expected.action);
  assert.equal(clean(values.selected), expected.text);
  assert.equal(values.key, 'test-only-placeholder', 'theme changes must not clear a pending input');
  assert.ok(values.width <= values.viewport + 1, theme + ': document overflow');
}

test('web palette follows OS dark/light changes without clearing inputs', { skip: !enabled }, async () => {
  await withPage(false, async (page) => {
    await page.locator('#tab-generate').waitFor();
    await page.locator('#apiKey').fill('test-only-placeholder');
    for (const theme of ['light', 'dark', 'light']) {
      await assertPalette(page, theme, { panel: '.tool-panel', selected: '#tab-generate' });
      await capture(page, 'web-390-' + theme);
    }
  });
});

test('Android WebView palette follows OS dark/light changes without clearing inputs', { skip: !enabled }, async () => {
  await withPage(true, async (page) => {
    await page.locator('#navSettings').click();
    await page.locator('#apiSettings > summary').click();
    await page.locator('#apiKey').fill('test-only-placeholder');
    for (const theme of ['light', 'dark', 'light']) {
      await assertPalette(page, theme, { panel: '.settings-group', selected: '#navSettings' });
      const field = await page.locator('#apiKey').evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.equal(clean(field), palette[theme].surface);
      await capture(page, 'android-settings-390-' + theme);
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('#navVideo').click();
    await capture(page, 'android-video-390-dark');
    await page.locator('#navJobs').click();
    await capture(page, 'android-jobs-390-dark');
    await page.locator('#navResults').click();
    await page.locator('#resultJobSelector').selectOption('complete-1');
    await capture(page, 'android-results-390-dark');
    await page.locator('#editResult').click();
    await page.locator('.cue textarea').first().waitFor({ state: 'visible' });
    await capture(page, 'android-editor-390-dark');
  });
});
