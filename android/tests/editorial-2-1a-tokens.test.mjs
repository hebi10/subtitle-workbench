import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const cssFiles = ['styles.css', 'android/web/styles.css'];
const tokens = ['space-1', 'space-2', 'space-3', 'space-4', 'space-6', 'space-8',
  'title-size', 'section-size', 'body-size', 'caption-size',
  'status-ready', 'status-running', 'status-paused', 'status-completed',
  'status-error', 'status-error-border'];
const patterns = ['section-title', 'supporting-text', 'timecode',
  'action-row', 'state-panel', 'empty-state', 'progress', 'detail-toggle'];

test('Editorial Studio 2.0 tokens and opt-in state patterns exist on web and Android', async () => {
  for (const file of cssFiles) {
    const css = await readFile(join(root, file), 'utf8');
    for (const token of tokens) assert.ok(css.includes('--es2-' + token + ':'), file + ' ' + token);
    for (const name of patterns) assert.ok(css.includes('.es2-' + name), file + ' ' + name);
    for (const state of ['running', 'paused', 'completed', 'error']) {
      assert.ok(css.includes('[data-state="' + state + '"]'), file + ' ' + state);
    }
    assert.match(css, /\.es2-timecode\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
    assert.match(css, /\.es2-detail-toggle:focus-visible\s*\{[^}]*outline/s);
    assert.match(css, /\.es2-state-panel\s*\{[^}]*border:\s*1px solid/s);
    assert.doesNotMatch(css.slice(css.indexOf('Editorial Studio 2.0 · 1-A')), /box-shadow\s*:\s*(?!none\b)\S[^;]*;/);
  }
});

test('Native Editorial Studio 2.0 sizing and accessible state panels preserve existing styling', async () => {
  const java = await readFile(join(root,
    'android/app/src/main/java/com/haebi/subtitle/NativeDesignSystem.java'), 'utf8');
  for (const field of ['SPACE_SMALL_DP', 'SPACE_STANDARD_DP', 'SECTION_TITLE_SP',
    'BODY_SP', 'CAPTION_SP', 'CONTROL_MIN_HEIGHT_DP']) assert.ok(java.includes(field));
  assert.match(java, /static void statusPanel\(TextView view, String state, float density\)/);
  assert.match(java, /statusPanel\(view, density\)/);
  assert.match(java, /setAccessibilityLiveRegion\(View\.ACCESSIBILITY_LIVE_REGION_POLITE\)/);
  assert.match(java, /shape\.setCornerRadius\(0f\)/);
  assert.match(java, /view\.setElevation\(0f\)/);
});
