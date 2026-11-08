import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const policyUrl = 'https://hebi10.github.io/subtitle-workbench/privacy-policy.html';

test('privacy access uses a fixed native browser destination while WebView stays restricted', async () => {
  const [html, app, native, policy] = await Promise.all([
    read('android/web/index.html'), read('android/web/app.js'),
    read('android/app/src/main/java/com/haebi/subtitle/MainActivity.java'), read('docs/privacy-policy.html'),
  ]);
  const settings = html.slice(html.indexOf('<section id="settingsView"'), html.indexOf('</main>'));
  assert.match(settings, /<button id="openPrivacyPolicy" type="button">개인정보처리방침/);
  assert.match(app, /openPrivacyPolicy:\s*\(\) => nativeCall\('openPrivacyPolicy'\)/);
  const branch = native.match(/case "openPrivacyPolicy":([\s\S]*?)result = true; break;/)?.[1];
  assert.ok(branch, 'native bridge must implement the policy action');
  assert.ok(branch.includes(`new Intent(Intent.ACTION_VIEW, Uri.parse("${policyUrl}"))`));
  assert.doesNotMatch(branch, /params\.|getString\(|optString\(/, 'policy navigation must not accept a caller URL');
  assert.match(branch, /catch \(Exception error\).*emitError/s, 'missing browser must be reported');
  assert.match(native, /shouldOverrideUrlLoading[\s\S]*?return !isInternal\(request.getUrl\(\)\)/);
  assert.match(native, /shouldInterceptRequest[\s\S]*?if \(!isInternal\(request.getUrl\(\)\)\) return blocked\(\)/);
  assert.match(policy, /<html lang="ko">/);
  assert.match(policy, /com\.haebi\.subtitle/);
  assert.match(policy, /mailto:asdlkj0104@gmail\.com/);
});

test('Korean Play listing and release notes stay within store text limits', async () => {
  const listing = JSON.parse(await read('docs/play-store/listing-ko.json'));
  assert.equal(listing.language, 'ko-KR');
  for (const [field, limit] of [['title', 30], ['shortDescription', 80], ['fullDescription', 4000]]) {
    assert.equal(typeof listing[field], 'string');
    assert.ok(listing[field].length > 0 && [...listing[field]].length <= limit, `${field} exceeds ${limit} characters`);
  }
  assert.ok(listing.fullDescription.includes(policyUrl));
  assert.match(listing.fullDescription, /OpenAI API 사용 요금.*별도로 청구/);
  assert.match(listing.fullDescription, /모델 설치에는 인터넷/);
  assert.ok([...(await read('docs/play-store/release-notes-ko.txt')).trim()].length <= 500);
});
