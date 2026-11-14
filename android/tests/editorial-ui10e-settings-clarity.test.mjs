import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('UI-10-E grounds connection and cost messages in actual status, never mock billing', async () => {
  const [js, html, css] = await Promise.all([
    readFile(resolve(root, 'android/web/app.js'), 'utf8'),
    readFile(resolve(root, 'android/web/index.html'), 'utf8'),
    readFile(resolve(root, 'android/web/styles.css'), 'utf8'),
  ]);
  assert.match(js, /connectionModeDraft === 'relay' && !relay/);
  assert.match(js, /running && connection\.hasKey/);
  assert.match(js, /healthGuides\[connectionHealth\]/);
  assert.match(js, /settingsDefaultsHelp/);
  assert.match(js, /새로 선택하는 영상에 적용됩니다. 기존 작업 설정은 유지됩니다./);
  assert.match(html, /원본 영상 파일 자체를 클라우드에 보관하는 기능은 없습니다/);
  assert.match(html, /연결 확인은 결제 상태·잔액·월 누적 비용을 조회하지 않습니다/);
  assert.match(html, /자동 재시작 기능은 제공하지 않습니다/);
  for (const selector of ['apiKey', 'reviewRelayCode']) {
    assert.match(html, new RegExp('id="' + selector + '" type="password"'));
  }
  assert.match(html, /id="confirmClearKey"[^>]*hidden/);
  assert.match(html, /id="confirmClearReviewRelay"[^>]*hidden/);
  assert.match(css, /#settingsView \.settings-data-guide \.hint/);
  assert.doesNotMatch(html, /이번 달 \$2\.34|7일 보관|자동 이어하기.*type="checkbox"/);
});
