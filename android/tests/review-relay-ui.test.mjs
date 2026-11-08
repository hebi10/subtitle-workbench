import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test, { before, after } from 'node:test';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const artifacts = join(root, 'output/review-relay-ui');
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
let server;
let browser;
let baseUrl;

before(async () => {
  if (!enabled) return;
  await mkdir(artifacts, { recursive: true });
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const paths = {
      '/': 'android/web/index.html', '/app.js': 'android/web/app.js', '/styles.css': 'android/web/styles.css',
      '/shared/core.js': 'src/core.js', '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
      '/shared/edit-history.js': 'src/edit-history.js', '/shared/subtitle-player.js': 'src/subtitle-player.js',
    };
    if (!paths[pathname]) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
      res.end(await readFile(join(root, paths[pathname])));
    } catch { res.writeHead(500).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function withApp(action) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
  try {
    await page.goto(baseUrl);
    await page.locator('.job').first().waitFor();
    await action(page);
    assert.deepEqual(errors, [], 'browser must not throw during the tested flow');
  } finally { await context.close(); }
}

const regression = (name, action) => test(name, { skip: !enabled }, () => withApp(action));

async function openConnection(page) {
  await page.locator('#navSettings').click();
  if (!(await page.locator('#apiSettings').evaluate((node) => node.open))) await page.locator('#apiSettings > summary').click();
}
async function saveRelay(page, url = 'https://relay.subtitle.com', code = 'fixture_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') {
  await openConnection(page);
  await page.locator('#cloudMode').selectOption('relay');
  await page.locator('#reviewRelayUrl').fill(url);
  await page.locator('#reviewRelayCode').fill(code);
  await page.locator('#reviewRelayForm button[type="submit"]').click();
  await page.waitForFunction(() => window.mockNative.cloudMode === 'relay');
}

regression('relay selection sends explicit bridge parameters and never receives stored credentials', async (page) => {
  await page.evaluate(() => {
    const original = window.Native.postMessage.bind(window.Native);
    window.Native.postMessage = (raw) => {
      const call = JSON.parse(raw);
      if (call.method === 'setReviewRelay') window.relayRequestMatches = call.params.url === 'https://relay.subtitle.com' && call.params.code === 'fixture_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      original(raw);
    };
  });
  await saveRelay(page);
  assert.equal(await page.evaluate(() => window.relayRequestMatches), true);
  assert.equal(await page.locator('#reviewRelayCode').inputValue(), '');
  assert.equal(await page.locator('#reviewRelayCode').getAttribute('type'), 'password');
  assert.equal(await page.locator('#reviewRelayCode').getAttribute('autocomplete'), 'off');
  assert.match(await page.locator('#relayNotice').innerText(), /개인 OpenAI API 키.*입력하지/);
  assert.equal(await page.evaluate(() => JSON.stringify(window.mockNative).includes('fixture_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')), false);
  await page.locator('#checkConnection').click();
  await page.waitForFunction(() => document.getElementById('connectionStatus').textContent.includes('접근 확인'));
  assert.match(await page.locator('#connectionStatus').innerText(), /테스트 서버/);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(artifacts, `relay-settings-${width}.png`), fullPage: true });
  }
  await page.locator('#navVideo').click();
  assert.match(await page.locator('#cloudTransmissionNotice').innerText(), /relay\.subtitle\.com.*OpenAI/);
  assert.match(await page.locator('#cloudLiveNotice').innerText(), /공유.*한도/);
  await page.locator('#pickVideo').click();
  const prepared = page.locator('#preparedJobs .job');
  assert.match(await prepared.locator('.job-ready-note').innerText(), /relay\.subtitle\.com.*OpenAI/);
  assert.match(await prepared.locator('.job-ready-note').innerText(), /개인 API.*청구되지/);
  await page.screenshot({ path: join(artifacts, 'relay-before-video-start-390.png'), fullPage: true });
});

regression('relay drafts survive polling and code is cleared on departure and mode changes', async (page) => {
  await openConnection(page);
  await page.locator('#cloudMode').selectOption('relay');
  await page.locator('#reviewRelayUrl').fill('https://draft.subtitle.com');
  await page.locator('#reviewRelayCode').fill('draft_dddddddddddddddddddddddddddddddddddddddddddddddd');
  await page.evaluate(() => window.nativeEvent({ type: 'status' }));
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#cloudMode').inputValue(), 'relay');
  assert.equal(await page.locator('#reviewRelayUrl').inputValue(), 'https://draft.subtitle.com');
  assert.equal(await page.locator('#reviewRelayCode').inputValue(), 'draft_dddddddddddddddddddddddddddddddddddddddddddddddd');
  await page.locator('#navVideo').click();
  assert.equal(await page.locator('#reviewRelayCode').inputValue(), '');
  await openConnection(page);
  await page.locator('#reviewRelayCode').fill('mode_mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm');
  await page.locator('#cloudMode').selectOption('personal');
  assert.equal(await page.locator('#reviewRelayCode').inputValue(), '');
});

regression('switching back preserves the personal key and relay clear requires its own confirmation', async (page) => {
  await saveRelay(page);
  await page.locator('#cloudMode').selectOption('personal');
  await page.waitForFunction(() => window.mockNative.cloudMode === 'personal');
  assert.equal(await page.evaluate(() => window.mockNative.hasPersonalKey), true);
  assert.equal(await page.evaluate(() => window.mockNative.calls.some((call) => call.method === 'clearKey')), false);
  assert.equal(await page.evaluate(() => window.mockNative.calls.some((call) => call.method === 'usePersonalApi')), true);
  await page.locator('#cloudMode').selectOption('relay');
  await page.locator('#reviewRelayForm button[type="submit"]').click();
  await page.waitForFunction(() => window.mockNative.cloudMode === 'relay');
  assert.equal(await page.locator('#reviewRelayCode').inputValue(), '');
  await page.locator('#requestClearReviewRelay').click();
  assert.equal(await page.evaluate(() => window.mockNative.calls.some((call) => call.method === 'clearReviewRelay')), false);
  await page.locator('#cancelClearReviewRelay').click();
  await page.locator('#requestClearReviewRelay').click();
  await page.locator('#clearReviewRelay').click();
  await page.waitForFunction(() => !window.mockNative.reviewRelay.hasCode);
  assert.equal(await page.evaluate(() => window.mockNative.hasPersonalKey), true);
});

regression('running and queued work lock all connection changes and mismatch explains original destination', async (page) => {
  await saveRelay(page);
  await page.locator('#navJobs').click();
  const legacy = page.locator('#jobsView .job[data-job-id="partial-1"]');
  assert.equal(await legacy.getByRole('button', { name: '이어하기', exact: true }).isDisabled(), true);
  assert.match(await legacy.innerText(), /개인 API.*원래 연결/);
  await openConnection(page);
  for (const status of ['running', 'queued']) {
    await page.evaluate((status) => { window.mockNative.jobs[1].status = status; window.nativeEvent({ type: 'status' }); }, status);
    await page.waitForFunction(() => document.getElementById('cloudMode').disabled);
    for (const id of ['cloudMode', 'reviewRelayUrl', 'reviewRelayCode', 'requestClearReviewRelay', 'requestClearKey', 'apiKey']) assert.equal(await page.locator(`#${id}`).isDisabled(), true, `${id} disabled while ${status}`);
  }
});

regression('a different server needs a new access code and pinned relay jobs retain their disclosure', async (page) => {
  await saveRelay(page);
  await page.locator('#navVideo').click();
  await page.locator('#pickVideo').click();
  await openConnection(page);
  await page.locator('#reviewRelayUrl').fill('https://another.subtitle.com');
  await page.locator('#reviewRelayForm button[type="submit"]').click();
  await page.waitForFunction(() => document.getElementById('appMessage').textContent.includes('새 테스트 접근 코드'));
  assert.equal(await page.evaluate(() => window.mockNative.reviewRelay.url), 'https://relay.subtitle.com');
  await page.locator('#cloudMode').selectOption('personal');
  await page.waitForFunction(() => window.mockNative.cloudMode === 'personal');
  await page.locator('#navVideo').click();
  const prepared = page.locator('#preparedJobs .job');
  assert.match(await prepared.locator('.job-ready-note').innerText(), /relay\.subtitle\.com/);
  assert.equal(await prepared.getByRole('button', { name: '생성 시작', exact: true }).isDisabled(), true);
  assert.match(await prepared.innerText(), /원래 연결/);
});

test('review relay UI exposes a distinct secret input and common disclosure without a production fixture', async () => {
  const html = await readFile(join(root, 'android/web/index.html'), 'utf8');
  assert.match(html, /id="cloudMode"/);
  assert.match(html, /id="reviewRelayCode" type="password" autocomplete="off"/);
  assert.match(html, /id="cloudTransmissionNotice"/);
  assert.match(html, /id="cloudLiveNotice"/);
  assert.doesNotMatch(html, /mock-bridge/);
});

test('test bridge mirrors relay credential isolation, origin reuse and personal key retention', async () => {
  let response;
  const storage = new Map();
  const window = { nativeResult: (value) => { response = value; } };
  runInNewContext(await readFile(join(root, 'android/web/mock-bridge.js'), 'utf8'), {
    window, URL, setTimeout: (callback) => callback(),
    sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
  });
  const call = (method, params = {}) => {
    response = null;
    window.Native.postMessage(JSON.stringify({ id: 'fixture-call', method, params }));
    assert.ok(response);
    return response;
  };
  assert.match(call('setReviewRelay', { url: 'https://relay.subtitle.com', code: 'short' }).error, /전용 테스트 접근 코드/);
  assert.match(call('setReviewRelay', { url: 'https://relay.invalid', code: 'fixture_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy' }).error, /HTTPS 서버 주소/);
  assert.equal(call('setReviewRelay', { url: 'https://relay.subtitle.com', code: 'fixture_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy' }).error, undefined);
  const status = call('status').result;
  assert.equal(status.cloudMode, 'relay');
  assert.equal(status.hasPersonalKey, true);
  assert.equal(status.hasKey, true);
  assert.equal(status.reviewRelay.hasCode, true);
  assert.equal(JSON.stringify(status).includes('fixture_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'), false);
  assert.equal(JSON.stringify(window.mockNative).includes('fixture_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'), false);
  assert.equal(call('setReviewRelay', { url: 'https://relay.subtitle.com/', code: '' }).error, undefined);
  assert.match(call('setReviewRelay', { url: 'https://another.subtitle.com', code: '' }).error, /새 테스트 접근 코드/);
  assert.equal(call('usePersonalApi').error, undefined);
  assert.equal(call('status').result.hasKey, true);
  window.mockNative.jobs[1].status = 'queued';
  assert.match(call('setReviewRelay', { url: 'https://another.subtitle.com', code: 'another_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' }).error, /일시정지/);
});
