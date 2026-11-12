import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

test('RELEASE-03 only the exact main subject selects existing internal code 23 for alpha', async () => {
  const workflow = await readFile(join(root, '.github/workflows/play-internal.yml'), 'utf8');
  const subject = "release: RELEASE-03 promote verified internal 23 to closed alpha [promote-existing-23]";
  assert.ok(workflow.includes("if [[ \"$title\" == 'release: RELEASE-03 promote verified internal 23 to closed alpha [promote-existing-23]' ]]; then"));
  const section = workflow.slice(workflow.indexOf("if [[ \"$title\" == 'release: RELEASE-03 promote verified internal 23 to closed alpha [promote-existing-23]' ]]; then"));
  assert.ok(section.includes("echo 'mode=promote' >> \"$GITHUB_OUTPUT\""));
  assert.ok(section.includes("echo 'target=alpha' >> \"$GITHUB_OUTPUT\""));
  assert.ok(section.includes("echo 'promotion_code=23' >> \"$GITHUB_OUTPUT\""));
  assert.ok(section.includes('exit 0'));
  assert.ok(section.indexOf("echo 'promotion_code=23'") < section.indexOf('exit 0'));
  assert.ok(section.indexOf("if [[ \"$title\" == 'fix(play") > section.indexOf('exit 0'));
});

test('RELEASE-03 promotion must not allocate, sign or upload a fresh AAB', async () => {
  const workflow = await readFile(join(root, '.github/workflows/play-internal.yml'), 'utf8');
  const selected = 'needs.source.outputs.mode';
  for (const protectedStep of [
    'Verify original upload key and prepare private signing file',
    'Build signed release with the allocated versionCode',
    'Verify AAB signature against original upload certificate',
    'Preserve signed AAB',
  ]) {
    const at = workflow.indexOf('- name: ' + protectedStep);
    assert.ok(at >= 0, protectedStep);
    const after = workflow.slice(at, at + 350);
    assert.ok(after.includes("if: " + selected + " == 'build' || " + selected + " == 'deploy'"), protectedStep);
  }
  const allocate = workflow.slice(workflow.indexOf('- name: Allocate version above'), workflow.indexOf('- name: Install SDK 36'));
  const deploy = workflow.slice(workflow.indexOf('- name: Submit internal release'), workflow.indexOf('- name: Promote verified internal version'));
  assert.ok(allocate.includes("if: " + selected + " == 'deploy'"));
  assert.ok(deploy.includes("if: " + selected + " == 'deploy'"));
  assert.ok(workflow.includes("if: (" + selected + " == 'deploy' && needs.source.outputs.target == 'alpha') || " + selected + " == 'promote'"));
  assert.ok(workflow.includes("run: python3 scripts/release/publisher.py --report output/play-promotion.json promote --version-code \"$VERSION_CODE\" --track alpha"));
});
