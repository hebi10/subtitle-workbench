import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const output = join(root, 'output/editorial-2-2e');

test('2-E preserves encrypted settings contracts and scopes all status UI to existing data', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'android/web/app.js'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
  ]);
  for (const id of [
    'settingsView', 'settingsConnectionSummary', 'settingsDefaultsOverview', 'settingsConnectionHealth',
    'settingsConnectionHelp', 'settingsDefaultsHelp', 'settingsOpenConnection', 'settingsOpenDefaults',
    'apiSettings', 'defaultSettings', 'dataSettings', 'personalApiSettings', 'reviewRelaySettings',
    'apiKey', 'reviewRelayCode', 'cloudMode', 'checkConnection', 'keyStatus',
    'requestClearKey', 'confirmClearKey', 'requestClearReviewRelay', 'confirmClearReviewRelay',
    'settingsStatus', 'sourceLanguage', 'targetLanguage', 'sttModel', 'translationModel'
  ]) assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  assert.match(html, /id="apiKey" type="password"/);
  assert.match(html, /id="reviewRelayCode" type="password"/);
  assert.match(html, /id="settingsOpenConnection"[^>]*aria-controls="apiSettings"/);
  assert.match(html, /id="settingsOpenDefaults"[^>]*aria-controls="defaultSettings"/);
  assert.match(js, /settingsOpenConnection: \(\) => openSettings\('apiSettings'\)/);
  assert.match(js, /settingsOpenDefaults: \(\) => openSettings\('defaultSettings'\)/);
  assert.match(js, /const connectionHealth = checkingConnection/);
  assert.match(js, /settingsConnectionHelp/);
  assert.match(js, /!sameSettings\(selected, savedSettings\)/);
  for (const label of ['전송 데이터', '요금 및 사용량', '작업 이어하기', '원본 파일'])
    assert.match(html, new RegExp('<h4>' + label + '</h4>'));
  assert.match(css, /#settingsView \.settings-overview-action:focus-visible/);
  assert.match(css, /#settingsView \.settings-health-badge\[data-state="error"\]/);
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
    page.setDefaultTimeout(13000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
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

test('2-E gives honest connection state and opens the original encrypted forms', { skip: !enabled }, async () => {
  await withApp(async page => {
    await page.locator('#navSettings').click();
    assert.equal(await page.locator('.settings-overview > div').count(), 2);
    assert.equal(await page.locator('#settingsConnectionHealth').getAttribute('data-state'), 'saved');
    assert.match(await page.locator('#settingsConnectionHelp').innerText(), /연결 확인/);
    assert.match(await page.locator('#settingsConnectionSummary').innerText(), /개인 API/);
    assert.match(await page.locator('#settingsDefaultsOverview').innerText(), /whisper-1/);
    await page.locator('#settingsOpenConnection').click();
    assert.equal(await page.locator('#apiSettings').evaluate(node => node.open), true);
    assert.equal(await page.locator('#apiSettings > summary').evaluate(node => document.activeElement === node), true);
    await page.locator('#checkConnection').click();
    await page.waitForFunction(() => document.getElementById('settingsConnectionHealth').dataset.state === 'verified');
    assert.match(await page.locator('#settingsConnectionHelp').innerText(), /결제 상태와 잔액/);

    await page.locator('#cloudMode').selectOption('relay');
    assert.equal(await page.locator('#reviewRelaySettings').isVisible(), true);
    assert.match(await page.locator('#settingsConnectionSummary').innerText(), /개인 API/);
    const sentinel = 'fixture_only_access_code_22222222222222222222222222222222222';
    await page.locator('#reviewRelayCode').fill(sentinel);
    assert.doesNotMatch(await page.locator('.settings-overview').innerText(), new RegExp(sentinel));
    await page.locator('#navJobs').click();
    assert.equal(await page.locator('#reviewRelayCode').inputValue(), '');
    await page.locator('#navSettings').click();
    assert.match(await page.locator('#settingsConnectionSummary').innerText(), /개인 API/);
  });
});

test('2-E reports unsaved defaults without changing the stored next-video settings', { skip: !enabled }, async () => {
  await withApp(async page => {
    await page.locator('#navSettings').click();
    await page.locator('#settingsOpenDefaults').click();
    assert.equal(await page.locator('#defaultSettings').evaluate(node => node.open), true);
    await page.locator('#advancedSettings > summary').click();
    await page.locator('#translationModel').fill('unsaved-model-fixture');
    assert.match(await page.locator('#settingsDefaultsHelp').innerText(), /아직 적용되지 않습니다/);
    assert.doesNotMatch(await page.locator('#settingsDefaultsOverview').innerText(), /unsaved-model-fixture/);
    await page.locator('#discardSettings').click();
    assert.match(await page.locator('#settingsDefaultsHelp').innerText(), /새로 선택하는 영상/);
    assert.equal(await page.locator('#translationModel').inputValue(), 'gpt-6-luna');
    await page.locator('#dataSettings > summary').click();
    const headings = await page.locator('#dataSettings .settings-data-guide h4').allTextContents();
    assert.deepEqual(headings, ['전송 데이터', '요금 및 사용량', '작업 이어하기', '원본 파일']);
    assert.match(await page.locator('#dataSettings').innerText(), /공유 사용량 한도/);

    await mkdir(output, { recursive: true });
    await page.locator('#dataSettings > summary').click();
    for (const width of [320, 390, 800]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false, width + ' ' + theme + ' horizontal overflow');
        const bounds = await page.locator('.settings-overview').boundingBox();
        assert.ok(bounds && bounds.width <= width + 1);
        const nav = await page.locator('.app-nav').boundingBox();
        const openButton = await page.locator('#settingsOpenConnection').boundingBox();
        assert.ok(nav && openButton && openButton.width > 0);
        if (width === 390 || width === 800) {
          await page.screenshot({ path: join(output, 'settings-' + width + '-' + theme + '.png'), fullPage: true });
        }
      }
    }
  });
});

test('2-E never marks a failed connection check as verified', { skip: !enabled }, async () => {
  await withApp(async page => {
    await page.locator('#navSettings').click();
    await page.locator('#settingsOpenConnection').click();
    await page.evaluate(() => { window.mockNative.failConnection = true; });
    await page.locator('#checkConnection').click();
    await page.waitForFunction(() => document.getElementById('settingsConnectionHealth').dataset.state === 'error');
    assert.match(await page.locator('#settingsConnectionHealth').innerText(), /확인 실패/);
    assert.match(await page.locator('#settingsConnectionHelp').innerText(), /실패 원인/);
    assert.equal(await page.locator('#settingsConnectionHealth').getAttribute('data-state'), 'error');
    await page.evaluate(() => { window.mockNative.failConnection = false; });
    await page.locator('#checkConnection').click();
    await page.waitForFunction(() => document.getElementById('settingsConnectionHealth').dataset.state === 'verified');
    assert.match(await page.locator('#settingsConnectionHealth').innerText(), /확인됨/);
  });
});
