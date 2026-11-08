import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(process.env.STORE_CAPTURE_OUTPUT || join(root, 'output/play-store-captures'));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const routes = {
  '/': 'android/web/index.html', '/app.js': 'android/web/app.js', '/styles.css': 'android/web/styles.css',
  '/shared/core.js': 'src/core.js', '/shared/subtitle-editor.js': 'src/subtitle-editor.js',
  '/shared/edit-history.js': 'src/edit-history.js', '/shared/subtitle-player.js': 'src/subtitle-player.js',
};
const server = createServer(async (request, response) => {
  const path = routes[new URL(request.url, 'http://localhost').pathname];
  if (!path) return response.writeHead(404).end();
  try {
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript; charset=utf-8' :
      path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
    response.end(await readFile(join(root, path)));
  } catch { response.writeHead(500).end(); }
});

await mkdir(output, { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.STORE_CAPTURE_BROWSER_PATH ? { executablePath: process.env.STORE_CAPTURE_BROWSER_PATH } : {}) });
  const context = await browser.newContext({
    viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5,
    locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript({ path: join(root, 'android/web/mock-bridge.js') });
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.locator('.job').first().waitFor();
  await page.evaluate(() => {
    const complete = window.mockNative.jobs.find(job => job.id === 'complete-1');
    const partial = window.mockNative.jobs.find(job => job.id === 'partial-1');
    complete.name = '인터뷰 영상.mp4';
    partial.name = '강의 영상.mp4';
    const examples = [
      ['Let us review the goals for this project.', '이번 프로젝트의 목표를 살펴보겠습니다.'],
      ['Clear communication helps everyone work together.', '명확한 소통은 함께 일하는 데 도움이 됩니다.'],
      ['We will begin with the first example.', '첫 번째 예시부터 시작하겠습니다.'],
    ];
    for (const cues of Object.values(window.mockNative.cues)) {
      cues.forEach((cue, index) => {
        const [original, translated] = examples[index % examples.length];
        Object.assign(cue, { original, translated });
      });
    }
    window.nativeEvent({ type: 'status' });
  });
  await page.waitForFunction(() => document.querySelector('.job').textContent.includes('강의 영상.mp4'));
  const captures = [];
  async function capture(file, purpose, selector, scrollY = 0) {
    await page.locator(selector).waitFor({ state: 'visible' });
    await page.evaluate(y => { document.activeElement?.blur(); window.scrollTo(0, y); }, scrollY);
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), file + ': horizontal overflow');
    assert.equal(await page.locator('.app-nav [aria-current="page"]').count(), 1);
    const bytes = await page.screenshot({ path: join(output, file), fullPage: false, animations: 'disabled' });
    assert.equal(bytes.readUInt32BE(16), 1080, file + ': width');
    assert.equal(bytes.readUInt32BE(20), 1920, file + ': height');
    captures.push({ file, purpose, width: 1080, height: 1920, sha256: createHash('sha256').update(bytes).digest('hex'), scrollY });
  }
  await page.locator('#navVideo').click();
  await capture('01-video.png', '영상 추가와 마이크 자막 진입', '#videoView');
  await page.locator('#navJobs').click();
  await capture('02-jobs.png', '일시정지 작업과 완료 작업 관리', '#jobsView');
  await page.locator('#navResults').click();
  await page.locator('#resultJobSelector').selectOption('complete-1');
  await page.waitForFunction(() => document.getElementById('resultName').textContent === '인터뷰 영상.mp4');
  await capture('03-results.png', 'SRT·VTT·JSON 내보내기', '#resultsView');
  await page.locator('#editResult').click();
  await page.locator('.cue textarea').first().waitFor();
  await capture('04-editor.png', '원문·번역과 자막 시간 편집', '#editorView', 350);
  await page.locator('#navSettings').click();
  await capture('05-settings.png', 'API 연결과 기본값 관리', '#settingsView');
  assert.deepEqual(errors, [], 'No uncaught app errors during capture');
  const sources = [];
  for (const file of [...new Set(Object.values(routes)), 'android/web/mock-bridge.js']) {
    sources.push({ file, sha256: createHash('sha256').update(await readFile(join(root, file))).digest('hex') });
  }
  await writeFile(join(output, 'capture-provenance.json'), JSON.stringify({
    language: 'ko-KR', capturedAt: new Date().toISOString(),
    source: {
      type: 'real-android-web-ui-with-native-bridge-fixture',
      note: 'Actual Android WebView HTML/CSS/JS rendered in Chromium. Native bridge responses use the existing browser verification fixture. Example filenames and subtitle text are illustrative seeded data. No AI-generated interface, native-screen simulation, inference output claim, crop, or image stretch.',
      commit: process.env.GITHUB_SHA || null,
      workflowRunId: process.env.GITHUB_RUN_ID || null,
      viewport: { width: 432, height: 768, deviceScaleFactor: 2.5 },
      files: sources,
    }, captures,
  }, null, 2) + '\n', 'utf8');
  console.log('Captured ' + captures.length + ' actual web UI screenshots at 1080×1920 in ' + output);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
