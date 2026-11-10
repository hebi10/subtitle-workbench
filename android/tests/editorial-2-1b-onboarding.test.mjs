import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('1-B guide is conditional, non-destructive, and uses real native entry points', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'android/web/app.js'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
  ]);
  assert.match(html, /id="firstRunGuide"[^>]*hidden/);
  assert.match(html, /id="firstRunGuideHeading"/);
  for (const id of ['dismissFirstRunGuide', 'guideFile', 'guideMic', 'guideOffline']) {
    assert.match(html, new RegExp('id="' + id + '"'));
    assert.match(js, new RegExp("\\$\\('" + id + "'\\)"));
  }
  assert.match(js, /firstRunDismissed \|\| jobs\.length > 0/);
  assert.match(js, /localStorage\.setItem\(FIRST_RUN_GUIDE_KEY, 'dismissed'\)/);
  assert.match(js, /if \(!initialViewSet\) await show\(jobs\.length \? 'jobs' : 'video'\)/);
  assert.match(js, /if \(\$\('pickVideo'\)\.disabled\)/);
  assert.match(js, /void openSettings\(\)/);
  assert.match(js, /\$\('openOnDevice'\)\.focus\(\)/);
  assert.match(js, /\$\('openOfflineModel'\)\.focus\(\)/);
  assert.match(html, /id="navJobs"[^>]*aria-controls="jobsView"[^>]*aria-current="page"/);
  assert.match(css, /\.first-run-actions button/);
  assert.match(css, /@media \(max-width: 360px\)/);
  for (const id of ['pickVideo', 'openOnDevice', 'openCloudLive', 'openOfflineModel', 'navResults', 'navSettings']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
});

test('1-B does not create a new backend or expose secrets in guide copy', async () => {
  const html = await readFile(join(root, 'android/web/index.html'), 'utf8');
  const guide = html.slice(html.indexOf('id="firstRunGuide"'), html.indexOf('</section>', html.indexOf('id="firstRunGuide"')));
  assert.doesNotMatch(guide, /sk-[a-z0-9]|API_KEY=|Bearer /i);
  assert.match(guide, /개인 API 없이/);
  assert.match(guide, /테스트 서버 연결/);
});
