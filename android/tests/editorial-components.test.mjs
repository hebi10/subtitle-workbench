import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const out = join(root, 'output/editorial-components');
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const iconNames = ['video', 'jobs', 'results', 'settings', 'add', 'play',
  'edit', 'download', 'mic', 'refresh', 'stop', 'back'];

test('2-A component vocabulary is shared and stays dependency-free', async () => {
  const [web, android, webMarkup, androidMarkup, native] = await Promise.all([
    readFile(join(root, 'styles.css'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
    readFile(join(root, 'index.html'), 'utf8'),
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'android/app/src/main/java/com/haebi/subtitle/NativeDesignSystem.java'), 'utf8'),
  ]);
  for (const css of [web, android]) {
    for (const token of ['--es-control-height', '--es-control-surface', '--es-control-primary',
      '--es-card-background', '--es-status-neutral', '--es-status-warning', '--es-status-danger']) {
      assert.ok(css.includes(token + ':'), token + ' must exist');
    }
    for (const name of iconNames) assert.ok(css.includes('.es-icon--' + name + '::before'), name);
    assert.match(css, /--es-control-height:48px/);
    assert.match(css, /box-shadow:none/);
  }
  for (const value of [webMarkup, androidMarkup]) {
    assert.match(value, /class="es-icon es-icon--/);
    assert.match(value, /aria-hidden="true"/);
  }
  assert.match(native, /StateListDrawable/);
  assert.match(native, /-android\.R\.attr\.state_enabled/);
  assert.doesNotMatch(androidMarkup, /<script[^>]+(?:https?:)?\/\//i);
});

async function runApp(mobile, action) {
  const routes = mobile ? {
    '/': 'android/web/index.html',
    '/app.js': 'android/web/app.js',
    '/styles.css': 'android/web/styles.css',
    '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
    '/shared/core.js': 'src/core.js',
    '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
    '/shared/edit-history.js': 'src/edit-history.js',
    '/shared/subtitle-player.js': 'src/subtitle-player.js',
  } : null;
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const filename = mobile ? routes[pathname] : pathname === '/' ? 'index.html' : pathname.slice(1);
    const allowWeb = /^(?:index\.html|styles\.css|assets\/brand\/editorial-mark-white\.png|src\/[a-z0-9-]+\.js)$/.test(filename ?? '');
    if (!filename || (!mobile && !allowWeb)) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type', filename.endsWith('.png') ? 'image/png' :
        filename.endsWith('.js') ? 'text/javascript; charset=utf-8' :
        filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
      res.end(await readFile(join(root, filename)));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    if (mobile) await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await mkdir(out, { recursive: true });
    await action(page);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
}

async function verifyControl(page, selector, minHeight = 48) {
  const info = await page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { height: rect.height, radius: style.borderRadius, shadow: style.boxShadow, display: style.display };
  });
  assert.ok(info.height >= minHeight, selector + ' control height ' + info.height);
  assert.equal(info.radius, '0px', selector + ' should have no rounded corners');
  assert.equal(info.shadow, 'none', selector + ' should have no box shadow');
}

test('2-A web controls retain visible labels, correct icon semantics and narrow layouts', { skip: !enabled }, async () => {
  await runApp(false, async (page) => {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme });
        await page.locator('#tab-generate').waitFor();
        assert.equal(await page.getByRole('tab', { name: '생성' }).count(), 1);
        assert.equal(await page.getByRole('tab', { name: '편집' }).count(), 1);
        assert.equal(await page.getByRole('tab', { name: '내보내기' }).count(), 1);
        assert.equal(await page.locator('.workspace-tab .es-icon').count(), 3);
        await verifyControl(page, '#tab-generate');
        await verifyControl(page, '#startButton');
        await page.locator('#tab-edit').click();
        await verifyControl(page, '#undoEdit');
        await page.locator('#tab-generate').click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        assert.equal(overflow, false, 'Web ' + width + ' ' + theme + ' overflow');
        if (width === 390) await page.screenshot({ path: join(out, 'web-' + width + '-' + theme + '.png'), fullPage: false });
      }
    }
  });
});

test('2-A Android components and icon navigation preserve names, input and page selection', { skip: !enabled }, async () => {
  await runApp(true, async (page) => {
    for (const width of [320, 390, 800]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme });
        assert.deepEqual(await page.locator('.app-nav button').allTextContents(),
          ['영상 추가', '작업', '결과', '설정']);
        assert.equal(await page.locator('.app-nav .es-icon[aria-hidden="true"]').count(), 4);
        await page.locator('#navVideo').click();
        await verifyControl(page, '#pickVideo');
        await verifyControl(page, '#importSubtitles');
        await page.locator('#navSettings').click();
        await page.locator('#apiSettings').evaluate((node) => { node.open = true; });
        await verifyControl(page, '#apiKey');
        assert.equal(await page.locator('#apiKey').evaluate(el => getComputedStyle(el).fontSize), '16px');
        await page.locator('#apiKey').fill('fixture-not-a-secret');
        await page.locator('#navResults').click();
        await page.locator('#resultJobSelector').selectOption('complete-1');
        await verifyControl(page, '#editResult');
        await page.locator('#navSettings').click();
        assert.equal(await page.locator('#apiKey').inputValue(), 'fixture-not-a-secret');
        assert.equal(await page.locator('.app-nav [aria-current="page"]').count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false, 'Android ' + width + ' ' + theme + ' overflow');
        if (width === 390) await page.screenshot({ path: join(out, 'android-' + width + '-' + theme + '.png'), fullPage: false });
      }
    }
  });
});
