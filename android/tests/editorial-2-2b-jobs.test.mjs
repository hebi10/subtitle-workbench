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
const output = join(root, 'output/editorial-2-2b');

test('2-B preserves navigation, state semantics, exact record counts and original job actions', async () => {
  const [html, css, js] = await Promise.all([
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
    readFile(join(root, 'android/web/app.js'), 'utf8'),
  ]);
  assert.match(html, /id="jobsHeading">작업 관리/);
  assert.match(html, /id="startNewJob"[^>]*class="primary"/);
  assert.match(html, /id="refreshJobs"/);
  assert.match(html, /id="jobsSummary"[^>]*aria-live="polite"/);
  assert.match(js, /startNewJob: \(\) => show\('video'\)/);
  assert.match(js, /const badge = el\('span', ready \? '준비됨'/);
  assert.match(js, /badge\.dataset\.phase = ready \? 'ready' : job\.status/);
  assert.match(js, /'job-progress-label'/);
  assert.match(js, /'job-processed-note hint'/);
  assert.match(js, /'job-live-stage hint'/);
  assert.match(js, /JOBS_PAGE_SIZE = 4/);
  assert.match(css, /#jobsView \.job-status-badge/);
  assert.match(css, /#jobsView \.job-actions button\.primary/);
  assert.match(css, /#jobsView \.job-error/);
  assert.match(css, /#jobsView \.job-inspection/);
  assert.doesNotMatch(css.slice(css.indexOf('Editorial Studio 2.0 · 2-B jobs')),
    /box-shadow\s*:\s*(?!none\b)\S[^;]+;/);
});

test('2-B real WebView layout exposes safe next actions and accurate progress', { skip: !enabled }, async () => {
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
  const server = createServer(async (request, response) => {
    const file = routes[new URL(request.url, 'http://localhost').pathname];
    if (!file) { response.writeHead(404).end(); return; }
    try {
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' :
        file.endsWith('.css') ? 'text/css; charset=utf-8' :
        file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
      response.end(await readFile(join(root, file)));
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => window.mockNative?.calls.some(c => c.method === 'status') && document.querySelectorAll('#jobList .job').length === 2);
    assert.match(await page.locator('#jobsSummary').innerText(), /전체 2개 · 진행 0 · 준비 0 · 일시정지 1 · 완료 1/);
    const paused = page.locator('#jobsView .job[data-job-id="partial-1"]');
    const complete = page.locator('#jobsView .job[data-job-id="complete-1"]');
    assert.equal(await paused.locator('.job-status-badge').innerText(), '일시정지');
    assert.equal(await paused.locator('.job-progress-label strong').innerText(), '12.5%');
    assert.equal(await paused.locator('progress').getAttribute('value'), '12.5');
    assert.equal(await paused.getByRole('button', { name: '이어하기', exact: true }).evaluate(x => x.classList.contains('primary')), true);
    assert.equal(await complete.getByRole('button', { name: '자막 편집', exact: true }).evaluate(x => x.classList.contains('primary')), true);
    await page.locator('#startNewJob').click();
    assert.equal(await page.locator('#videoView').isVisible(), true);
    await page.locator('#navJobs').click();

    await page.evaluate(() => {
      const paused = window.mockNative.jobs.find(j => j.id === 'partial-1');
      window.mockNative.jobs.push(
        { ...paused, id: 'running-2', name: '진행 테스트.mp4', status: 'running', stage: 'transcribing',
          error: '', progress: { ...paused.progress, message: '음성 인식 중' } },
        { ...paused, id: 'error-2', name: '오류 테스트.mp4', status: 'error', stage: 'transcribing',
          error: '통신 실패: 저장된 구간에서 이어할 수 있습니다.' }
      );
      window.nativeEvent({ type: 'status' });
    });
    await page.waitForFunction(() => document.querySelector('#jobList .job[data-job-id="error-2"]'));
    assert.match(await page.locator('#jobsSummary').innerText(), /전체 4개 · 진행 1 · 준비 0 · 일시정지 1 · 완료 1 · 오류 1/);
    assert.equal(await page.locator('#jobList .job').count(), 4);
    assert.equal(await page.locator('#jobList .job').first().getAttribute('data-job-id'), 'running-2');
    const running = page.locator('#jobList .job[data-job-id="running-2"]');
    assert.equal(await running.locator('.job-status-badge').innerText(), '생성 중');
    assert.equal(await running.getByRole('button', { name: '일시정지', exact: true }).evaluate(x => x.classList.contains('primary')), true);
    const failed = page.locator('#jobList .job[data-job-id="error-2"]');
    assert.equal(await failed.locator('.job-status-badge').innerText(), '처리 오류');
    assert.match(await failed.locator('.job-error').innerText(), /통신 실패/);
    assert.equal(await failed.getByRole('button', { name: '이어하기', exact: true }).evaluate(x => x.classList.contains('primary')), true);
    await mkdir(output, { recursive: true });
    for (const width of [320, 390, 800]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false, 'horizontal overflow at ' + width + 'px ' + theme);
        const nav = await page.locator('.app-nav').boundingBox();
        const firstAction = await running.getByRole('button', { name: '자막 보기', exact: true }).boundingBox();
        assert.ok(nav && firstAction, 'working navigation and job actions');
        if (width === 390 || width === 800) {
          await page.screenshot({
            path: join(output, 'jobs-' + width + '-' + theme + '.png'),
            fullPage: true,
          });
        }
      }
    }
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
