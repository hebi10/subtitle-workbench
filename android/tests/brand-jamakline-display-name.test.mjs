import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = async path => readFile(join(root, path), 'utf8');
const displayName = '자막라인';

test('BRAND-01 display name: Android, web and privacy copy agree', async () => {
  const screens = [
    'android/web/index.html', 'index.html',
    'android/app/src/main/java/com/haebi/subtitle/OnDeviceRecognitionActivity.java',
    'android/app/src/main/java/com/haebi/subtitle/CloudLiveRecognitionActivity.java',
    'android/app/src/main/java/com/haebi/subtitle/OfflineVoskActivity.java',
    'docs/privacy-policy.html',
  ];
  for (const path of screens) {
    const source = await read(path);
    assert.ok(source.includes(displayName), path + ': new user-facing label');
    assert.ok(!source.includes('해비 자막'), path + ': legacy label must be absent');
  }
  for (const path of ['android/web/index.html', 'index.html']) {
    const source = await read(path);
    assert.match(source, /<h1>자막라인<\/h1>/);
    assert.match(source, /<title>자막라인 \| 자막 생성·편집<\/title>/);
    assert.match(source, /SUBTITLE WORKSPACE/);
  }
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:label="자막라인"/);
  assert.match(manifest, /@mipmap\/ic_launcher/);
  const gradle = await read('android/app/build.gradle');
  assert.match(gradle, /applicationId 'com\.haebi\.subtitle'/);
  assert.match(gradle, /namespace 'com\.haebi\.subtitle'/);
  const policy = await read('docs/privacy-policy.html');
  assert.match(policy, /자막라인 개인정보처리방침/);
  assert.match(policy, /com\.haebi\.subtitle/);
});

test('BRAND-01 listing draft preserves historical approved binary assets', async () => {
  const listing = JSON.parse(await read('docs/play-store/listing-ko.json'));
  assert.equal(listing.language, 'ko-KR');
  assert.equal(listing.title, displayName);
  assert.match(listing.fullDescription, /^자막라인은 /);
  assert.ok(!listing.fullDescription.includes('해비 자막'));
  const binary = JSON.parse(await read('assets/brand/canonical.json'));
  assert.equal(binary.brandName, '해비 자막', 'historic image master remains until asset refresh');
  const manifest = JSON.parse(await read('assets/play-store/ko-KR/manifest.json'));
  assert.equal(manifest.assets.filter(x => x.file === 'icon.png').length, 1);
  assert.equal(manifest.assets.filter(x => x.file === 'feature-graphic.png').length, 1);
});
