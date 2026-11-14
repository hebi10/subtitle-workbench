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

async function withMock(action) {
  const server = createServer(async (request, response) => {
    const path = routes[new URL(request.url, 'http://localhost').pathname];
    if (!path) { response.writeHead(404).end(); return; }
    try {
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(path)];
      response.setHeader('Content-Type', mime + (mime === 'image/png' ? '' : '; charset=utf-8'));
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
    assert.deepEqual(errors, [], 'no JavaScript exceptions');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
}

const ids = (page) => page.locator('#jobList .job').evaluateAll(nodes => nodes.map(n => n.dataset.jobId));

test('UI-10-C2 keeps the JobStore and Native Bridge intact while adding local browsing', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'android/web/app.js'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
  ]);
  for (const id of ['jobsBrowse', 'jobsSearch', 'jobsStatusFilter', 'jobsSort', 'jobsMatchCount']) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  assert.match(html, /<details id="jobsBrowse"/);
  assert.match(html, /<option value="newest">최신순 \(생성일\)/);
  assert.match(html, /<option value="oldest">오래된순 \(생성일\)/);
  assert.match(js, /function filteredJobsForList\(\)/);
  assert.match(js, /function matchesJobsStatus\(job\)/);
  assert.match(js, /Number\(job\.createdAt\)/);
  assert.match(js, /jobsMatchCount = matches\.length/);
  assert.match(js, /matches\.slice\(jobsPage \* JOBS_PAGE_SIZE/);
  assert.match(js, /JOBS_PAGE_SIZE = 4/);
  assert.match(js, /prioritizeJobAction\(actions, job, ready\)/);
  assert.match(js, /nativeCall\('deleteJob'/);
  assert.match(js, /nativeCall\('resume'/);
  assert.match(js, /nativeCall\('pause'/);
  assert.match(css, /#jobsView \.jobs-browse-fields/);
  const shadows = [...css.slice(css.lastIndexOf('UI-10-C2')).matchAll(/box-shadow:\s*([^;]+);/g)].map(match => match[1].trim());
  assert.ok(shadows.every(value => value === 'none'), 'C2 controls must not add shadows');
});

test('UI-10-C2 search, six states, creation order, missing dates, pagination and native refresh', { skip: !enabled }, async () => {
  await withMock(async page => {
    assert.equal(await page.locator('#jobsBrowse').evaluate(n => n.open), false);
    assert.equal(await page.locator('#jobsMatchCount').isHidden(), true);
    assert.deepEqual(await ids(page), ['partial-1', 'complete-1']);
    assert.match(await page.locator('#jobsSummary').textContent(), /전체 2개/);
    await page.locator('#jobsBrowse > summary').click();

    await page.evaluate(() => {
      const paused = window.mockNative.jobs.find(j => j.id === 'partial-1');
      const completed = window.mockNative.jobs.find(j => j.id === 'complete-1');
      const time = n => 1700000000000 + n * 1000;
      window.mockNative.jobs = [
        { ...completed, id: 'complete-old', name: 'Alpha Old.mp4', createdAt: time(1) },
        { ...paused, id: 'queued-c2', name: 'Beta Waiting.mp4', createdAt: time(2), status: 'queued', stage: 'queued' },
        { ...paused, id: 'running-c2', name: 'Gamma Working.mp4', createdAt: time(3), status: 'running', stage: 'transcribing' },
        { ...paused, id: 'ready-c2', name: 'Delta 준비.mp4', createdAt: time(4), status: 'paused', stage: 'ready', completedChunks: 0 },
        { ...paused, id: 'paused-c2', name: 'Epsilon Pause.mp4', createdAt: time(5), status: 'paused', stage: 'transcribing' },
        { ...paused, id: 'error-c2', name: 'Zeta Error.mp4', createdAt: time(6), status: 'error', stage: 'transcribing', error: '재시도 가능' },
        { ...completed, id: 'complete-new', name: 'Alpha New.mp4', createdAt: time(7) },
        { ...completed, id: 'complete-legacy', name: 'Unknown date.mp4' },
      ];
      window.nativeEvent({ type: 'status' });
    });
    await page.waitForFunction(() => document.querySelector('#jobsSummary')?.textContent.includes('전체 8개'));
    assert.deepEqual(await ids(page), ['queued-c2', 'running-c2', 'ready-c2', 'paused-c2']);
    assert.match(await page.locator('#jobsPageInfo').textContent(), /1 \/ 2 · 8개/);

    await page.locator('#jobsSearch').fill('aLpHa');
    assert.deepEqual(await ids(page), ['complete-old', 'complete-new']);
    assert.match(await page.locator('#jobsMatchCount').textContent(), /일치하는 작업 2개 \/ 전체 8개/);
    await page.locator('#jobsStatusFilter').selectOption('active');
    assert.deepEqual(await ids(page), []);
    assert.match(await page.locator('#jobList .empty').textContent(), /일치하는 작업이 없습니다/);
    assert.equal(await page.locator('#nextJobs').isDisabled(), true);
    assert.match(await page.locator('#jobsSummary').textContent(), /전체 8개/);

    await page.locator('#jobsSearch').fill('');
    assert.deepEqual(await ids(page), ['queued-c2', 'running-c2']);
    for (const [state, expected] of [
      ['ready', 'ready-c2'], ['paused', 'paused-c2'], ['error', 'error-c2'],
    ]) {
      await page.locator('#jobsStatusFilter').selectOption(state);
      assert.deepEqual(await ids(page), [expected], state);
    }
    await page.locator('#jobsStatusFilter').selectOption('completed');
    assert.deepEqual(await ids(page), ['complete-old', 'complete-new', 'complete-legacy']);
    await page.locator('#jobsStatusFilter').selectOption('all');
    await page.locator('#jobsSort').selectOption('newest');
    assert.deepEqual(await ids(page), ['complete-new', 'error-c2', 'paused-c2', 'ready-c2']);
    await page.locator('#nextJobs').click();
    assert.deepEqual(await ids(page), ['running-c2', 'queued-c2', 'complete-old', 'complete-legacy'],
      'missing creation date sorts last');
    await page.locator('#jobsSort').selectOption('oldest');
    assert.deepEqual(await ids(page), ['complete-old', 'queued-c2', 'running-c2', 'ready-c2'],
      'changing sort resets to first page');
    await page.locator('#jobsSort').selectOption('priority');
    assert.deepEqual(await ids(page), ['queued-c2', 'running-c2', 'ready-c2', 'paused-c2']);
    assert.deepEqual(await page.evaluate(() => window.mockNative.jobs.map(j => j.id)), [
      'complete-old', 'queued-c2', 'running-c2', 'ready-c2', 'paused-c2', 'error-c2', 'complete-new', 'complete-legacy',
    ], 'UI order must not mutate Native JobStore input');

    await page.locator('#jobsStatusFilter').selectOption('completed');
    await page.locator('#jobsSort').selectOption('newest');
    const card = page.locator('#jobList .job[data-job-id="complete-new"]');
    await card.getByRole('button', { name: '기록 삭제' }).click();
    assert.match(await card.locator('.delete-warning').textContent(), /원본 영상은 삭제하지 않습니다/);
    await card.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(await page.evaluate(() => window.mockNative.jobs.length), 8, 'cancel must not delete');
    await page.locator('#jobList .job[data-job-id="complete-new"]').getByRole('button', { name: '기록 삭제' }).click();
    await page.locator('#jobList .job[data-job-id="complete-new"]').getByRole('button', { name: '삭제 확인' }).click();
    await page.waitForFunction(() => window.mockNative.jobs.length === 7 && document.querySelector('#jobsMatchCount')?.textContent.includes('작업 2개'));
    assert.deepEqual(await ids(page), ['complete-old', 'complete-legacy']);
    assert.equal(await page.evaluate(() => window.mockNative.calls.some(c => c.method === 'deleteJob' && c.params.jobId === 'complete-new')), true);

    await page.locator('#jobsSearch').fill('not-existing-file');
    assert.equal(await page.locator('#jobList .job').count(), 0);
    assert.match(await page.locator('#jobsPageInfo').textContent(), /1 \/ 1 · 0개/);
    await page.locator('#jobsSearch').fill('');
    await page.locator('#jobsStatusFilter').selectOption('all');
    await page.locator('#jobsSort').selectOption('priority');
    assert.match(await page.locator('#jobsPageInfo').textContent(), /1 \/ 2 · 7개/);

    await page.evaluate(() => {
      window.mockNative.jobs.find(j => j.id === 'running-c2').status = 'completed';
      window.nativeEvent({ type: 'status' });
    });
    await page.waitForFunction(() => document.querySelector('#jobsSummary')?.textContent.includes('완료 3'));
    assert.deepEqual(await ids(page), ['queued-c2', 'ready-c2', 'paused-c2', 'error-c2']);
    assert.equal(await page.locator('#jobsSort').inputValue(), 'priority');
    assert.equal(await page.locator('#jobsStatusFilter').inputValue(), 'all');

    await mkdir(output, { recursive: true });
    for (const width of [320, 390, 800]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        const layout = await page.evaluate(() => ({
          viewport: innerWidth,
          pageWidth: document.documentElement.scrollWidth,
          sizes: [...document.querySelectorAll('#jobsBrowse input, #jobsBrowse select')].map(n => n.getBoundingClientRect().height),
          toolbarOpen: document.querySelector('#jobsBrowse').open,
        }));
        assert.ok(layout.pageWidth <= layout.viewport + 1, width + '/' + theme + ' horizontal overflow');
        assert.ok(layout.sizes.every(height => height >= 48), width + '/' + theme + ' touch target');
        assert.equal(layout.toolbarOpen, true);
        if (width === 390) await page.screenshot({ path: join(output, 'ui10c2-browse-' + theme + '.png'), fullPage: true });
      }
    }
    assert.equal(await page.evaluate(() => window.mockNative.calls.some(c => ['resume', 'pause'].includes(c.method))), false,
      'search/filter/sort must not start or pause an actual job');
  });
});
