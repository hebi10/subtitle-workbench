import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const store = join(root, 'assets/play-store/ko-KR');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('5-B final Play screenshots are eight authentic Android 15 capture-based PNGs', async () => {
  const manifest = JSON.parse(await readFile(join(store, 'manifest.json'), 'utf8'));
  const provenance = JSON.parse(await readFile(join(store, 'capture-provenance-5b.json'), 'utf8'));
  const files = manifest.images.phoneScreenshots;
  assert.equal(manifest.language, 'ko-KR');
  assert.equal(files.length, 8);
  assert.equal(new Set(files).size, 8);
  assert.equal(manifest.screenshotCapture.count, 8);
  assert.equal(provenance.sourceStage, 'Editorial Studio 5-A');
  assert.equal(provenance.phoneScreenshots.length, 8);
  assert.deepEqual(manifest.images.icon, ['icon.png']);
  assert.deepEqual(manifest.images.featureGraphic, ['feature-graphic.png']);

  for (const filename of files) {
    const image = await readFile(join(store, filename));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [1080, 1920]);
    assert.ok(image.length < 8 * 1024 * 1024);
    const record = manifest.assets.find(item => item.file === filename);
    const source = provenance.phoneScreenshots.find(item => item.file === filename);
    assert.ok(record && source, filename + ' has provenance metadata');
    assert.equal(record.sha256, digest(image), filename + ' SHA-256');
    assert.equal(source.sha256, digest(image), filename + ' provenance SHA-256');
    assert.equal(record.source.sourceCommit, provenance.sourceCommit);
    assert.equal(record.source.sourcePath, source.sourcePath);
    assert.equal(record.source.sourceSHA256, source.sourceSHA256);
    assert.match(record.source.type, /android-15-emulator/);
    assert.match(source.rendering, /no crop/);
  }
});


test('STORE-03 trusted listing route cannot sign AAB or change Play tracks', async () => {
  const workflow = await readFile(join(root, '.github/workflows/play-internal.yml'), 'utf8');
  assert.match(workflow, /title.*store: Editorial Studio 5-B trusted screenshot registration/);
  assert.match(workflow, /title.*store: STORE-03 trusted screenshot registration \[listing-only\]/);
  assert.match(workflow, /echo 'mode=listing' >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /if: needs\.source\.outputs\.mode == 'build' \|\| needs\.source\.outputs\.mode == 'deploy'\n\s*env:\n\s*ANDROID_UPLOAD_KEYSTORE_B64/);
  for (const step of ['Install SDK 36', 'Build signed release with the allocated versionCode',
    'Verify AAB signature against original upload certificate', 'Preserve signed AAB']) {
    assert.ok(workflow.includes('name: ' + step + "\n        if: needs.source.outputs.mode == 'build' || needs.source.outputs.mode == 'deploy'"),
      step + ' must be skipped for screenshot registration');
  }
  assert.match(workflow, /check --phone-only --require-eight-screenshots/);
  assert.match(workflow, /apply --phone-only --require-eight-screenshots --send-for-review --report output\/play-listing-store03\.json/);
  assert.match(workflow, /if: needs\.source\.outputs\.mode == 'listing'\n\s*env:\n\s*GH_TOKEN:/);
  assert.match(workflow, /if: needs\.source\.outputs\.mode == 'deploy'/);
  assert.match(workflow, /echo 'mode=deploy' >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /echo 'mode=promote' >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /echo 'promotion_code=21' >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /echo 'mode=check' >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /check\|build\|deploy\)/);
});
