import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const get = (path) => readFile(join(root, path));
const getText = async (path) => (await get(path)).toString('utf8');
function pngSize(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('1-B browser and Android use the same image-generated brand mark', async () => {
  const [web, mobile, gradle, white, mobileWhite] = await Promise.all([
    getText('index.html'),
    getText('android/web/index.html'),
    getText('android/app/build.gradle'),
    get('assets/brand/editorial-mark-white.png'),
    get('android/web/editorial-mark-white.png'),
  ]);
  assert.doesNotMatch(web, /brand-symbol" aria-hidden="true">HB/);
  assert.doesNotMatch(mobile, /brand-symbol" aria-hidden="true">HB/);
  assert.match(web, /assets\/brand\/editorial-mark-white\.png/);
  assert.match(mobile, /src="editorial-mark-white\.png"/);
  assert.match(gradle, /include 'index.html', 'app.js', 'styles.css', 'editorial-mark-white.png'/);
  assert.equal(white.equals(mobileWhite), true);
  for (const name of ['editorial-wordmark-dark.png','editorial-wordmark-light.png']) {
    assert.deepEqual(pngSize(await get('assets/brand/' + name)), [1040, 200]);
  }
});

test('1-B Android launcher has adaptive, round and themed glyphs', async () => {
  const [manifest, launcher, round, color, glyph, themed] = await Promise.all([
    getText('android/app/src/main/AndroidManifest.xml'),
    getText('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'),
    getText('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml'),
    getText('android/app/src/main/res/values/editorial_colors.xml'),
    get('android/app/src/main/res/drawable-nodpi/editorial_launcher_foreground.png'),
    get('android/app/src/main/res/drawable-nodpi/editorial_launcher_monochrome.png'),
  ]);
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  for (const xml of [launcher, round]) {
    assert.match(xml, /<adaptive-icon/);
    assert.match(xml, /@drawable\/editorial_launcher_foreground/);
    assert.match(xml, /@drawable\/editorial_launcher_monochrome/);
  }
  assert.match(color, /#171717/i);
  assert.deepEqual(pngSize(glyph), [432, 432]);
  assert.equal(glyph.equals(themed), true);
});

test('1-B Play Store icon and graphic hashes match manifest', async () => {
  const m = JSON.parse(await getText('assets/play-store/ko-KR/manifest.json'));
  for (const [name, size] of [['icon.png',[512,512]],['feature-graphic.png',[1024,500]]]) {
    const bytes=await get('assets/play-store/ko-KR/'+name);
    assert.deepEqual(pngSize(bytes), size);
    const record=m.assets.find(item=>item.file===name);
    assert.ok(record,name+' must have a manifest record');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
    assert.match(record.source.type,/imagegen-assisted/);
  }
  assert.deepEqual(pngSize(await get('favicon.png')),[64,64]);
  assert.deepEqual(pngSize(await get('apple-touch-icon.png')),[180,180]);
});
