import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const output = join(root, 'output/ui09b-brand');
const read = (path) => readFile(join(root, path));
const text = async (path) => (await read(path)).toString('utf8');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function pngSize(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'valid PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('UI-09-B Drive-approved 1-B master: every actual binary asset is byte-accurate', async () => {
  const master = JSON.parse(await text('assets/brand/canonical.json'));
  assert.equal(master.brandName, '해비 자막');
  assert.match(master.canonicalDirection, /1-B.*framed subtitle/i);
  assert.match(master.status, /not an approved replacement/);
  assert.equal(master.assets.length, 10);
  for (const asset of master.assets) {
    const bytes = await read(asset.path);
    assert.equal(digest(bytes), asset.sha256, asset.path + ': content diverged from Drive master');
    if (asset.path.endsWith('.png')) assert.deepEqual(pngSize(bytes), [asset.width, asset.height], asset.path);
    else {
      assert.equal(bytes.readUInt16LE(0), 0, 'ICO reserved');
      assert.equal(bytes.readUInt16LE(2), 1, 'ICO type');
      assert.ok(bytes.readUInt16LE(4) >= 3, 'ICO has multiple icon sizes');
    }
  }
  for (const item of master.equivalentCopies) {
    assert.ok((await read(item.source)).equals(await read(item.copy)),
      item.copy + ' must be identical to its approved foreground/white mark');
  }
  const store = JSON.parse(await text('assets/play-store/ko-KR/manifest.json'));
  for (const path of ['icon.png', 'feature-graphic.png']) {
    const entry = master.assets.find(a => a.path.endsWith('/' + path));
    const record = store.assets.find(a => a.file === path);
    assert.ok(record && entry && record.sha256 === entry.sha256, path + ' approved SHA vs Play manifest');
  }
});

test('UI-09-B browser, Android adaptive, colors, typography and icon-generation instructions agree', async () => {
  const [web, mobile, webCss, nativeCss, nativeDesign, androidXml, androidRound, colors, prompts] = await Promise.all([
    text('index.html'), text('android/web/index.html'), text('styles.css'), text('android/web/styles.css'),
    text('android/app/src/main/java/com/haebi/subtitle/NativeDesignSystem.java'),
    text('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'),
    text('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml'),
    text('android/app/src/main/res/values/editorial_colors.xml'),
    text('assets/play-store/ko-KR/generation-prompts.json'),
  ]);
  for (const markup of [web, mobile]) {
    assert.match(markup, /<h1>해비 자막<\/h1>/);
    assert.match(markup, /brand-mark/);
    assert.match(markup, /alt=""/);
    assert.doesNotMatch(markup, /brand-symbol" aria-hidden="true">HB/);
  }
  assert.match(web, /src="\.\/assets\/brand\/editorial-mark-white\.png"/);
  assert.match(mobile, /src="editorial-mark-white\.png"/);
  for (const css of [webCss, nativeCss]) {
    for (const color of ['#F5F5F5', '#FFFFFF', '#171717', '#626262', '#D8D8D8',
      '#141414', '#242424', '#F2F2F2', '#ADADAD', '#414141']) {
      assert.ok(css.toUpperCase().includes(color.toUpperCase()), 'missing palette ' + color);
    }
    assert.match(css, /\.brand-symbol \.brand-mark \{[^}]*object-fit:\s*contain/);
    assert.match(css, /\.brand-symbol \.brand-mark \{\s*filter:\s*invert\(1\)/);
  }
  assert.match(nativeDesign, /DAY_CANVAS = Color\.rgb\(245, 245, 245\)/);
  assert.match(nativeDesign, /NIGHT_SURFACE = Color\.rgb\(36, 36, 36\)/);
  assert.match(colors, /#171717/);
  for (const xml of [androidXml, androidRound]) {
    assert.match(xml, /@drawable\/editorial_launcher_foreground/);
    assert.match(xml, /@drawable\/editorial_launcher_monochrome/);
  }
  const input = JSON.parse(prompts);
  assert.match(input.icon, /framed subtitle glyph/i);
  assert.match(input.featureGraphic, /framed subtitle glyph/i);
  assert.doesNotMatch(input.icon, /Triangle above, bars beneath/);
  assert.doesNotMatch(input.featureGraphic, /play triangle above two thick black horizontal subtitle bars/);
  assert.match(input.editorialStudio1B.currentMaster, /unapproved pencil/);
});

const nativePaths = {
  '/': 'android/web/index.html',
  '/app.js': 'android/web/app.js',
  '/styles.css': 'android/web/styles.css',
  '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
  '/shared/core.js': 'src/core.js',
  '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
  '/shared/edit-history.js': 'src/edit-history.js',
  '/shared/subtitle-player.js': 'src/subtitle-player.js',
};

async function auditBrowser(native, action) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = native ? nativePaths[path] : path === '/' ? 'index.html' : path.slice(1);
    const allowed = native ? Boolean(file)
      : ['index.html', 'styles.css', 'favicon.ico', 'favicon.png', 'apple-touch-icon.png',
          'assets/brand/editorial-mark-white.png', 'assets/play-store/ko-KR/icon.png',
          'assets/brand/editorial-mark-dark.png'].includes(file) || /^src\/[a-z0-9-]+\.js$/.test(file || '');
    if (!allowed) { response.writeHead(404).end(); return; }
    try {
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.png': 'image/png', '.ico': 'image/x-icon' }[extname(file)] || 'application/octet-stream';
      response.setHeader('Content-Type', mime);
      response.end(await read(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', locale: 'ko-KR' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    if (native) await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => document.querySelector('.brand-mark')?.complete === true);
    await action(page);
    assert.deepEqual(errors, [], 'brand must have no JS errors');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
}

test('UI-09-B web and WebView live marks remain visible at 320/390/800px light/dark', { skip: !enabled }, async () => {
  await mkdir(output, { recursive: true });
  for (const native of [false, true]) {
    await auditBrowser(native, async page => {
      const layout = native ? 'android-webview-fixture' : 'web';
      const header = native ? '.app-header' : '.topbar';
      for (const width of [320, 390, 800]) {
        await page.setViewportSize({ width, height: 844 });
        for (const theme of ['light', 'dark']) {
          await page.emulateMedia({ colorScheme: theme });
          const info = await page.locator('.brand-mark').evaluate(img => {
            const brand = img.closest('.brand-symbol');
            const imageBox = img.getBoundingClientRect();
            const box = brand.getBoundingClientRect();
            return {
              loaded: img.complete && img.naturalWidth === 256 && img.naturalHeight === 256,
              imageWidth: imageBox.width, imageHeight: imageBox.height,
              containerWidth: box.width, containerHeight: box.height,
              background: getComputedStyle(brand).backgroundColor,
              filter: getComputedStyle(img).filter,
              heading: document.querySelector('h1')?.textContent.trim(),
              documentWidth: document.documentElement.scrollWidth,
              viewportWidth: innerWidth,
            };
          });
          assert.equal(info.loaded, true, layout + ' mark loaded');
          assert.equal(info.heading, '해비 자막');
          assert.ok(info.imageWidth >= 20 && info.imageHeight >= 20, layout + ' mark too small');
          assert.ok(info.containerWidth >= 40 && info.containerHeight >= 40, layout + ' brand container');
          assert.equal(info.background, theme === 'light' ? 'rgb(23, 23, 23)' : 'rgb(242, 242, 242)');
          assert.equal(info.filter.includes('invert(1)'), theme === 'dark', layout + ' theme inversion');
          assert.ok(info.documentWidth <= width + 1, layout + ' horizontal overflow ' + width + '/' + theme);
          if (width === 390) {
            await page.locator(header).screenshot({ path: join(output, 'brand-' + layout + '-' + width + '-' + theme + '.png'), animations: 'disabled' });
          }
        }
      }
      if (!native) {
        const downscaled = await page.evaluate(async () => {
          const img = new Image();
          img.src = '/assets/play-store/ko-KR/icon.png';
          await img.decode();
          const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 48;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, 48, 48);
          const pixels = ctx.getImageData(0, 0, 48, 48).data;
          let light = 0; let dark = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            const sum = pixels[i] + pixels[i + 1] + pixels[i + 2];
            if (sum > 600) light++;
            if (sum < 220) dark++;
          }
          return { light, dark };
        });
        assert.ok(downscaled.light > 110 && downscaled.dark > 1000,
          '48px Play icon must retain visible white silhouette against near-black ground');
      }
    });
  }
});
