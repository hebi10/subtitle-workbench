import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const out = join(root, 'output/editorial-5a');
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const reports = [];

const palette = {
  light: { canvas: '#F5F5F5', surface: '#FFFFFF', ink: '#171717', muted: '#626262' },
  dark: { canvas: '#141414', surface: '#242424', ink: '#F2F2F2', muted: '#ADADAD' },
};

function relativeLuminance(hex) {
  const values = hex.replace('#', '').match(/../g).map(v => parseInt(v, 16) / 255);
  const [red, green, blue] = values.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
function ratio(a, b) {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2));
}

test('5-A semantic colors maintain at least WCAG 4.5:1 text contrast', () => {
  for (const [mode, colors] of Object.entries(palette)) {
    assert.ok(ratio(colors.ink, colors.surface) >= 4.5, mode + ' primary text');
    assert.ok(ratio(colors.muted, colors.surface) >= 4.5, mode + ' secondary text');
    assert.ok(ratio(colors.ink, colors.canvas) >= 4.5, mode + ' canvas text');
  }
});

function routes(mobile) {
  return mobile ? {
    '/': 'android/web/index.html',
    '/styles.css': 'android/web/styles.css',
    '/app.js': 'android/web/app.js',
    '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
    '/shared/core.js': 'src/core.js',
    '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
    '/shared/edit-history.js': 'src/edit-history.js',
    '/shared/subtitle-player.js': 'src/subtitle-player.js',
  } : null;
}

async function runProduct(browser, mobile) {
  const mapping = routes(mobile);
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = mobile ? mapping[path] : path === '/' ? 'index.html' : path.slice(1);
    const allowed = mobile ? Boolean(file)
      : ['index.html', 'styles.css', 'favicon.ico', 'favicon.png',
        'assets/brand/editorial-mark-white.png', 'apple-touch-icon.png'].includes(file) ||
        /^src\/[a-z0-9-]+\.js$/.test(file || '');
    if (!allowed) { response.writeHead(404).end(); return; }
    try {
      response.setHeader('Content-Type',
        file.endsWith('.png') ? 'image/png' : file.endsWith('.css') ? 'text/css; charset=utf-8' :
        file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
      response.end(await readFile(join(root, file)));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    const modeName = mobile ? 'webview-fixture' : 'web';
    const widths = mobile ? [320, 390, 800] : [320, 390, 1280];
    for (const width of widths) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({
          viewport: { width, height: 844 }, colorScheme: theme, locale: 'ko-KR',
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        if (mobile) await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
        await page.goto('http://127.0.0.1:' + server.address().port + '/');
        await page.locator(mobile ? '#navJobs' : '#tab-generate').waitFor();

        const list = mobile
          ? [
            ['video', '#navVideo', '#videoView'],
            ['jobs', '#navJobs', '#jobsView'],
            ['results', '#navResults', '#resultsView'],
            ['editor', null, '#editorView'],
            ['settings', '#navSettings', '#settingsView'],
          ]
          : [
            ['generate', '#tab-generate', '#panel-generate'],
            ['edit', '#tab-edit', '#panel-edit'],
            ['export', '#tab-export', '#panel-export'],
          ];
        for (const [name, nav, panel] of list) {
          if (name === 'editor') {
            await page.locator('#navJobs').click();
            await page.locator('#jobsView .job[data-job-id="complete-1"]')
              .getByRole('button', { name: '자막 편집', exact: true }).click();
            await page.locator('#editorView .cue').first().waitFor();
          } else {
            await page.locator(nav).click();
          }
          assert.ok(await page.locator(panel).isVisible(), modeName + ' ' + name);
          const metrics = await page.evaluate(() => {
            const root = document.documentElement;
            const theme = getComputedStyle(root);
            const selected = document.querySelector('.app-nav [aria-current="page"]');
            return {
              scrollWidth: root.scrollWidth, viewport: innerWidth,
              selected: selected?.id || document.querySelector('[role="tab"][aria-selected="true"]')?.id || null,
              ink: theme.getPropertyValue('--es-ink').trim(),
              surface: theme.getPropertyValue('--es-surface').trim(),
              navHeight: document.querySelector('.app-nav')?.getBoundingClientRect().height || 0,
            };
          });
          assert.ok(metrics.selected, modeName + ' ' + name + ' selected navigation must be labelled');
          assert.ok(metrics.scrollWidth <= width + 1,
            modeName + ' ' + name + ' ' + width + ' ' + theme + ' horizontal overflow: ' + metrics.scrollWidth);
          assert.equal(metrics.ink.toUpperCase(), palette[theme].ink.toUpperCase());
          assert.equal(metrics.surface.toUpperCase(), palette[theme].surface.toUpperCase());
          reports.push({ product: modeName, screen: name, width, theme, ...metrics });
          if (width !== 320) {
            await page.screenshot({
              path: join(out, modeName + '-' + name + '-' + width + '-' + theme + '.png'),
              animations: 'disabled', fullPage: false,
            });
          }
        }

        // A compact viewport approximates Android's IME-resized WebView; actual OS IME remains for device QA.
        if (mobile && width === 390) {
          await page.locator('#navSettings').click();
          await page.locator('#apiSettings').evaluate(node => { node.open = true; });
          await page.setViewportSize({ width, height: 520 });
          await page.locator('#apiKey').focus();
          await page.locator('#apiKey').scrollIntoViewIfNeeded();
          const focus = await page.evaluate(() => {
            const field = document.getElementById('apiKey').getBoundingClientRect();
            const nav = document.querySelector('.app-nav').getBoundingClientRect();
            return { fieldBottom: field.bottom, navTop: nav.top };
          });
          assert.ok(focus.fieldBottom <= focus.navTop + 1,
            'Focused API key must remain above the fixed Android menu at viewport 520px');
          await page.screenshot({ path: join(out, 'webview-fixture-keyboard-simulation-390-' + theme + '.png'), animations: 'disabled' });
        }

        assert.deepEqual(errors, [], modeName + ' ' + width + ' ' + theme + ' JavaScript errors');
        await context.close();
      }
    }
  } finally {
    await new Promise(done => server.close(done));
  }
}

test('5-A full UI captures across web and Android WebView in both themes', { skip: !enabled }, async () => {
  await mkdir(out, { recursive: true });
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true });
  try {
    await runProduct(browser, false);
    await runProduct(browser, true);
    await writeFile(join(out, 'qa-metrics.json'), JSON.stringify({
      schema: 'subtitle-editorial-5a-v1',
      mockData: true,
      note: 'WebView screenshots use a mocked Native bridge; actual Android UI is covered by instrumentation.',
      textContrast: Object.fromEntries(Object.entries(palette).map(([name, colors]) => [
        name, { primary: ratio(colors.ink, colors.surface), secondary: ratio(colors.muted, colors.surface) }
      ])),
      captures: reports,
    }, null, 2), 'utf8');
  } finally {
    await browser.close();
  }
});
