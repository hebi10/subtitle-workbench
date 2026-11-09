import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const output = join(root, 'output/redesign-web');

test('v0.8 desktop and mobile web screens remain accessible and aligned', { skip: !process.env.PLAYWRIGHT_MODULE }, async () => {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const allow = ['index.html', 'styles.css', 'favicon.ico', 'favicon.png', 'assets/brand/editorial-mark-white.png', 'apple-touch-icon.png'].includes(relative) ||
      /^src\/[a-z0-9-]+\.js$/.test(relative);
    if (!allow) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type', relative.endsWith('.png') ? 'image/png' : relative.endsWith('.css') ? 'text/css; charset=utf-8' :
        relative.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
      res.end(await readFile(join(root, relative)));
    } catch { res.writeHead(404).end(); }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    await mkdir(output, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.locator('.workspace-tab').first().waitFor();
    assert.match(await page.locator('.topbar').innerText(), /해비 자막/);

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [tab, panel] of [
        ['generate', 'panel-generate'],
        ['edit', 'panel-edit'],
        ['export', 'panel-export'],
      ]) {
        await page.locator('#tab-' + tab).click();
        assert.equal(await page.locator('#tab-' + tab).getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('#' + panel).isVisible(), true);
        const metrics = await page.evaluate(() => ({
          full: document.documentElement.scrollWidth,
          viewport: innerWidth,
          radius: getComputedStyle(document.querySelector('.workspace-tab')).borderRadius,
          shadow: getComputedStyle(document.querySelector('.tool-panel')).boxShadow,
        }));
        assert.ok(metrics.full <= metrics.viewport + 1,
          'Web ' + width + 'px ' + tab + ' horizontal overflow: ' + metrics.full);
        assert.equal(metrics.radius, '0px');
        assert.equal(metrics.shadow, 'none');
        await page.screenshot({ path: join(output, 'web-' + width + '-' + tab + '.png'), fullPage: true });
      }
    }
    assert.deepEqual(errors, [], 'web must not throw at initial screen or tab navigation');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
