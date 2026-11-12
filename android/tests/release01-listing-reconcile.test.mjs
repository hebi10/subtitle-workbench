import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

test('RELEASE-01-FIX routes exactly one approved main commit to scoped reconciliation', async () => {
  const workflow = await readFile(join(root, '.github/workflows/play-internal.yml'), 'utf8');
  assert.ok(workflow.includes("title\" == 'store: RELEASE-01-FIX approved brand and description [listing-reconcile]'"));
  assert.ok(workflow.includes("echo 'mode=reconcile' >> \"$GITHUB_OUTPUT\""));
  assert.ok(workflow.includes("check --reconcile-brand --require-eight-screenshots"));
  assert.ok(workflow.includes("apply --reconcile-brand --require-eight-screenshots --send-for-review"));
  assert.ok(workflow.includes("name: Reject superseded main before approved listing reconciliation"));
  for (const name of [
    'Verify original upload key and prepare private signing file',
    'Allocate version above all uploaded bundles, APKs and tracks',
    'Build signed release with the allocated versionCode',
    'Submit internal release and require fresh Play API readback',
    'Promote verified internal version to closed alpha on explicit release marker',
  ]) {
    assert.ok(workflow.includes('name: ' + name), name + ' still exists but must not run in reconcile mode');
  }
  assert.ok(workflow.includes("if: needs.source.outputs.mode == 'build' || needs.source.outputs.mode == 'deploy'"));
  assert.ok(workflow.includes("if: needs.source.outputs.mode == 'deploy'"));
  assert.ok(workflow.includes("mode == 'deploy' && needs.source.outputs.target == 'alpha') || needs.source.outputs.mode == 'promote'"));
  assert.ok(workflow.includes("if: needs.source.outputs.mode == 'reconcile'"));
});

test('RELEASE-01-FIX targets approved brand assets without reuploading screenshots or changing API contracts', async () => {
  const listing = await readFile(join(root, 'scripts/release/listing.py'), 'utf8');
  const manifest = JSON.parse(await readFile(join(root, 'assets/play-store/ko-KR/manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.images).sort(), ['featureGraphic', 'icon', 'phoneScreenshots']);
  assert.equal(manifest.images.icon.length, 1);
  assert.equal(manifest.images.featureGraphic.length, 1);
  assert.equal(manifest.images.phoneScreenshots.length, 8);
  assert.ok(listing.includes("brand_kinds = ('icon', 'featureGraphic')"));
  assert.ok(listing.includes("client.request('PATCH', edit + listing_suffix"));
  assert.ok(listing.includes("STORE-05 screenshot set differs from approved source"));
  assert.ok(listing.includes("already_matching_no_write"));
  assert.ok(listing.includes("Brand/description edit committed but fresh readback failed"));
});
