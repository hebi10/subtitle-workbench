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

test('privacy policy describes optional relay transmission, quotas and separate credential deletion', async () => {
  const policy = await read('docs/privacy-policy.html');
  assert.match(policy, /테스트 서버.*거쳐.*OpenAI/s);
  assert.match(policy, /서버 전용 OpenAI API 키.*서버/s);
  assert.match(policy, /임시 오디오.*삭제/s);
  assert.match(policy, /집계.*사용량.*카운터|사용량.*집계.*카운터/s);
  assert.match(policy, /저장된 테스트 연결 삭제/);
  assert.doesNotMatch(policy, /중계 서버를 경유하지 않습니다/);
  assert.match(policy, /공유 사용량 한도/);
});

test('current Play declaration and public policy disclose ads and subscription data consistently', async () => {
  const [decl, policy, listingText] = await Promise.all([
    read('docs/play-store/declarations-ko.md'), read('docs/privacy-policy.html'), read('docs/play-store/listing-ko.json'),
  ]);
  assert.match(decl, /광고 포함 \| 예/);
  assert.match(decl, /AD_ID 및 ACCESS_ADSERVICES_AD_ID/);
  assert.match(decl, /앱 상호작용/);
  assert.match(decl, /진단 정보/);
  assert.match(decl, /구매 내역\/구독 상태/);
  assert.match(decl, /Console에서 저장·검토·게시되었다는 증빙은 아니다/);
  assert.doesNotMatch(decl, /광고 포함 \| 아니요/);
  assert.match(policy, /대략적 위치 추정/);
  assert.match(policy, /성능 및 진단 정보/);
  assert.match(policy, /구독 구매 토큰과 Play Integrity 검증 토큰/);
  assert.match(JSON.parse(listingText).fullDescription, /광고 제거 구독.*OpenAI API 사용 요금/s);
});


test('SW-FIX-10 listing distinguishes free import, uncertain request cost and Android-only functionality', async () => {
  const listing = JSON.parse(await read('docs/play-store/listing-ko.json'));
  const notes = await read('docs/play-store/release-notes-ko.txt');
  assert.match(listing.fullDescription, /개인 API 키 없이 불러와 편집/);
  assert.match(listing.fullDescription, /중단된 API 요청을 다시 전송하면 비용이 발생할 수 있습니다/);
  assert.match(listing.fullDescription, /ChatGPT 구독과 API 사용료도 별개/);
  assert.doesNotMatch(listing.fullDescription, /IndexedDB|브라우저 자동 저장/);
  assert.match(notes, /서버 처리 여부가 불확실한 요청/);
});
