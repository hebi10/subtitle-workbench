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
const output = join(root, 'output/editorial-2-2b');
const routes = {
  '/': 'android/web/index.html',
  '/app.js': 'android/web/app.js',
  '/styles.css': 'android/web/styles.css',
  '/editorial-mark-white.png': 'android/web/editorial-mark-white.png',
  '/shared/core.js': 'src/core.js',
  '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
  '/shared/edit-history.js': 'src/edit-history.js',
  '/shared/subtitle-player.js': 'src/subtitle-player.js',
};

async function withFixture(action) {
  const server = createServer(async (request, response) => {
    const path = routes[new URL(request.url, 'http://localhost').pathname];
    if (!path) { response.writeHead(404).end(); return; }
    try {
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(path)];
      response.setHeader('Content-Type', type + (type === 'image/png' ? '' : '; charset=utf-8'));
      response.end(await readFile(join(root, path)));
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', locale: 'ko-KR' });
    const page = await context.newPage();
    page.setDefaultTimeout(18000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => window.mockNative?.calls.some(c => c.method === 'status') && document.querySelectorAll('#jobList .job').length === 2);
    await action(page);
    assert.deepEqual(errors, [], 'WebView JavaScript errors');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
}

async function expectPrimary(page, id, label, container = '#jobList') {
  const card = page.locator(container + ' .job[data-job-id="' + id + '"]');
  const primary = card.locator('.job-actions button.primary');
  assert.equal(await primary.count(), 1, id + ': exactly one enabled primary action');
  assert.equal(await primary.first().isEnabled(), true, id + ': primary must be available');
  assert.equal((await primary.first().textContent()).trim(), label, id + ': correct action');
  assert.equal(await primary.first().evaluate(node => node.classList.contains('job-primary-action')), true);
  assert.equal(await primary.first().evaluate(node => node === node.parentElement.firstElementChild), true,
    id + ': primary action precedes other actions');
}

test('UI-10-C1 preserves existing job operations and prioritizes one available action', async () => {
  const [js, css, html] = await Promise.all([
    readFile(join(root, 'android/web/app.js'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
    readFile(join(root, 'android/web/index.html'), 'utf8'),
  ]);
  assert.match(js, /function prioritizeJobAction\(actions, job, ready\)/);
  assert.match(js, /prioritizeJobAction\(actions, job, true\)/);
  assert.match(js, /if \(primary\) actions\.prepend\(primary\)/);
  assert.match(js, /const review = actionIcon\(button\('준비 확인'/);
  assert.match(js, /JOBS_PAGE_SIZE = 4/);
  for (const action of ["button('일시정지'", "button('이어하기'", "button('자막 편집'", "button('결과 보기'", "button('SRT 저장'", "button('기록 삭제'"]) {
    assert.ok(js.includes(action), 'existing action: ' + action);
  }
  assert.match(js, /pendingDeletionId = job\.id/);
  assert.match(js, /jobDestinationWarning\(job\)/);
  assert.match(css, /#jobsView \.job-actions > button\.job-primary-action:first-child\s*\{\s*grid-column:\s*1\s*\/\s*-1/);
  assert.match(html, /id="jobList"/);
  assert.ok(!html.includes('id="jobsSearch"'), 'UI-10-C2 search is not part of C1');
});

test('UI-10-C1 state changes, credentials, pagination, deletion confirmation and responsive actions', { skip: !enabled }, async () => {
  await withFixture(async page => {
    await expectPrimary(page, 'partial-1', '이어하기');
    await expectPrimary(page, 'complete-1', '자막 편집');
    const completed = page.locator('#jobList .job[data-job-id="complete-1"]');
    assert.equal(await completed.getByRole('button', { name: 'SRT 저장' }).count(), 1);
    assert.equal(await completed.getByRole('button', { name: '기록 삭제' }).count(), 1);

    await page.evaluate(() => {
      const template = window.mockNative.jobs.find(job => job.id === 'partial-1');
      window.mockNative.jobs.push(
        { ...template, id: 'running-c1', name: '진행.mp4', status: 'running', stage: 'transcribing', error: '' },
        { ...template, id: 'queued-c1', name: '대기.mp4', status: 'queued', stage: 'ready', error: '' },
        { ...template, id: 'error-c1', name: '오류.mp4', status: 'error', stage: 'transcribing', error: '실패 후 구간은 유지됩니다.' },
      );
      window.nativeEvent({ type: 'status' });
    });
    await page.waitForFunction(() => document.querySelector('#jobsSummary')?.textContent.includes('전체 5개'));
    assert.equal(await page.locator('#jobList .job').count(), 4, 'four cards per page');
    await expectPrimary(page, 'running-c1', '일시정지');
    await expectPrimary(page, 'queued-c1', '일시정지');
    await expectPrimary(page, 'partial-1', '이어하기');
    await expectPrimary(page, 'error-c1', '이어하기');
    assert.equal(await page.locator('#jobList .job[data-job-id="running-c1"]').getByRole('button', { name: '이어하기' }).count(), 0);
    assert.equal(await page.locator('#jobList .job[data-job-id="error-c1"]').getByRole('button', { name: '일시정지' }).count(), 0);

    await page.evaluate(() => { window.mockNative.hasPersonalKey = false; window.nativeEvent({ type: 'status' }); });
    await page.waitForFunction(() => document.querySelector('#jobList .job[data-job-id="partial-1"] .job-actions button.primary')?.textContent.includes('API 설정 확인'));
    await expectPrimary(page, 'partial-1', 'API 설정 확인');
    await expectPrimary(page, 'error-c1', 'API 설정 확인');
    assert.equal(await page.locator('#jobList .job[data-job-id="partial-1"]').getByRole('button', { name: '이어하기' }).isDisabled(), true);
    await page.evaluate(() => { window.mockNative.hasPersonalKey = true; window.nativeEvent({ type: 'status' }); });
    await page.waitForFunction(() => document.querySelector('#jobList .job[data-job-id="partial-1"] .job-actions button.primary')?.textContent.includes('이어하기'));
    await expectPrimary(page, 'partial-1', '이어하기');

    await page.locator('#nextJobs').click();
    await expectPrimary(page, 'complete-1', '자막 편집');
    const complete = page.locator('#jobList .job[data-job-id="complete-1"]');
    await complete.getByRole('button', { name: '기록 삭제' }).click();
    assert.match(await complete.locator('.delete-warning').textContent(), /원본 영상은 삭제하지 않습니다/);
    await complete.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(await page.evaluate(() => window.mockNative.jobs.some(job => job.id === 'complete-1')), true);
    assert.equal(await page.evaluate(() => window.mockNative.calls.some(c => c.method === 'deleteJob')), false);

    await page.evaluate(() => {
      const template = window.mockNative.jobs.find(job => job.id === 'partial-1');
      window.mockNative.jobs = [{ ...template, id: 'ready-c1', name: '준비.mp4',
        status: 'paused', stage: 'ready', completedChunks: 0, progress: { percent: 0, processedMs: 0 } }];
      window.mockNative.cues['ready-c1'] = [];
      window.nativeEvent({ type: 'status' });
    });
    await page.waitForFunction(() => document.querySelector('#jobList .job[data-job-id="ready-c1"]'));
    await expectPrimary(page, 'ready-c1', '준비 확인');
    await page.locator('#jobList .job[data-job-id="ready-c1"]').getByRole('button', { name: '준비 확인' }).click();
    assert.equal(await page.locator('#videoView').isVisible(), true);
    await expectPrimary(page, 'ready-c1', '생성 시작', '#preparedJobs');

    await page.evaluate(() => { window.mockNative.hasPersonalKey = false; window.nativeEvent({ type: 'status' }); });
    await page.waitForFunction(() => document.querySelector('#preparedJobs .job[data-job-id="ready-c1"] .job-actions button.primary')?.textContent.includes('API 설정 확인'));
    await expectPrimary(page, 'ready-c1', 'API 설정 확인', '#preparedJobs');
    assert.equal(await page.locator('#preparedJobs .job[data-job-id="ready-c1"]').getByRole('button', { name: '생성 시작' }).isDisabled(), true);

    await mkdir(output, { recursive: true });
    for (const width of [320, 390, 800]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        const dimensions = await page.evaluate(() => ({
          pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
          heights: [...document.querySelectorAll('#preparedJobs .job-actions button')].map(b => b.getBoundingClientRect().height),
        }));
        assert.ok(dimensions.pageWidth <= dimensions.viewport + 1, width + '/' + theme + ': no overflow');
        assert.ok(dimensions.heights.every(h => h >= 48), width + '/' + theme + ': safe touch targets');
        if (width === 390) {
          await page.screenshot({ path: join(output, 'ui10c1-ready-' + theme + '.png'), fullPage: true });
        }
      }
    }
    assert.equal(await page.evaluate(() => window.mockNative.calls.some(c => ['resume', 'pause', 'deleteJob'].includes(c.method))), false,
      'visual state testing must not execute a job or delete data');
  });
});
