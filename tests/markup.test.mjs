import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('CSP precedes resources and limits scripts to local assets and WebAssembly', () => {
  const html = readFileSync('index.html', 'utf8');
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<link'));
  assert.match(csp, /(?:^|; )script-src 'self' 'wasm-unsafe-eval'(?:;|$)/);
  assert.doesNotMatch(csp, /'unsafe-inline'|'unsafe-eval'/);
  assert.match(csp, /(?:^|; )default-src 'none'(?:;|$)/);
  assert.match(csp, /(?:^|; )object-src 'none'(?:;|$)/);
  assert.match(csp, /(?:^|; )base-uri 'none'(?:;|$)/);
  assert.match(csp, /(?:^|; )form-action 'none'(?:;|$)/);
});

test('current-tab key input is disclosed and legacy persistence controls are inert', () => {
  const html = readFileSync('index.html', 'utf8');
  const css = readFileSync('styles.css', 'utf8');
  const workerRadio = html.match(/<input[^>]*name="connectionMode"[^>]*value="worker"[^>]*>/)?.[0] ?? '';
  const browserRadio = html.match(/<input[^>]*name="connectionMode"[^>]*value="browser"[^>]*>/)?.[0] ?? '';
  const apiKeyLabel = html.match(/<label[^>]*id="apiKeyField"[^>]*>/)?.[0] ?? '';

  assert.match(workerRadio, /\bchecked\b/);
  assert.doesNotMatch(browserRadio, /\bchecked\b/);
  assert.ok(apiKeyLabel);
  assert.doesNotMatch(apiKeyLabel, /\bhidden\b/);
  assert.match(
    html,
    /<input[^>]*id="apiKey"[^>]*type="password"[^>]*autocomplete="off"[^>]*>/,
  );

  const rememberControl = html.match(/<input[^>]*id="rememberCredentials"[^>]*>/)?.[0] ?? '';
  assert.ok(rememberControl);
  assert.doesNotMatch(rememberControl, /\bchecked\b/);
  const legacyControls = html.match(/<div id="legacyCredentialControls"[^>]*>[\s\S]*?(?=<button\s+id="deleteCredentialButton")/)?.[0] ?? '';
  assert.match(legacyControls, /^<div[^>]*\bhidden\b[^>]*\binert\b[^>]*aria-hidden="true"/);
  for (const id of ['rememberCredentials', 'localPassphrase', 'saveCredentialButton', 'unlockCredentialButton']) {
    assert.ok(legacyControls.includes(`id="${id}"`), `${id} must be inside inert legacy controls`);
  }
  assert.ok(html.includes('API 키는 저장하지 않고 현재 탭에서만 사용합니다.'));
  assert.ok(html.includes('새로고침 후 다시 입력해 주세요.'));
  const deleteButton = html.match(/<button\s+id="deleteCredentialButton"[^>]*>/)?.[0] ?? '';
  assert.ok(deleteButton);
  assert.doesNotMatch(deleteButton, /\bhidden\b/);

  [
    'credentialPassphraseFields',
    'localPassphrase',
    'localPassphraseConfirmation',
    'localPassphraseConfirmationField',
    'saveCredentialButton',
    'unlockCredentialButton',
    'deleteCredentialButton',
    'credentialStatus',
    'credentialError',
    'startRequirement',
  ].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  });

  ['credentialStatus', 'credentialError', 'startRequirement'].forEach((id) => {
    assert.match(
      html,
      new RegExp(`<[^>]+id="${id}"[^>]+aria-live="polite"[^>]*>`),
      `#${id} must announce changes politely`,
    );
  });

  assert.ok(html.includes('추출한 음성과 자막 텍스트는'));
  assert.ok(html.includes('영상 원본 로컬 처리'));
  assert.match(css, /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important\s*;/s);
  assert.match(css, /button:focus-visible[\s\S]*?outline\s*:\s*3px solid var\(--focus\)/);
  assert.match(
    css,
    /\.segmented-control input:focus-visible \+ span\s*\{[^}]*outline\s*:\s*3px solid var\(--line-strong\)[^}]*\}/s,
  );
});

test('main run controls are placed after settings and before the status panel', () => {
  const html = readFileSync('index.html', 'utf8');
  const topbarStart = html.indexOf('<header class="topbar">');
  const topbarEnd = html.indexOf('</header>', topbarStart);
  const topbar = html.slice(topbarStart, topbarEnd);

  assert.equal(topbar.includes('id="startButton"'), false);
  assert.equal(topbar.includes('id="cancelButton"'), false);
  assert.ok(html.indexOf('id="settingsForm"') < html.indexOf('id="runControls"'));
  assert.ok(html.indexOf('id="runControls"') < html.indexOf('id="runPanel"'));
  assert.ok(html.includes('id="startButton"'));
  assert.ok(html.includes('id="cancelButton"'));
});

test('split defaults and translation failure summary UI are present', () => {
  const html = readFileSync('index.html', 'utf8');

  assert.ok(html.includes('id="targetMinutes" type="number" value="7"'));
  assert.ok(html.includes('id="minMinutes" type="number" value="3"'));
  assert.ok(html.includes('id="maxMinutes" type="number" value="15"'));
  assert.ok(html.includes('id="translationFailureSummary"'));
});

test('run step list is rendered by app code with progress metadata support', () => {
  const app = readFileSync('src/app.js', 'utf8');

  assert.ok(app.includes("className = 'step-label'"));
  assert.ok(app.includes("className = 'step-percent'"));
  assert.ok(app.includes('setStepProgress('));
});

test('batch progress separates file name and size with the intended label', () => {
  const app = readFileSync('src/app.js', 'utf8');

  assert.ok(
    app.includes('`${index + 1}/${total} · ${file.name} · ${formatBytes(file.size)}`'),
  );
});

test('subtitle quality settings remain in the generator form', () => {
  const html = readFileSync('index.html', 'utf8');

  assert.ok(html.includes('id="maxSubtitleChars" type="number" value="42"'));
  assert.ok(html.includes('id="maxSubtitleSeconds" type="number" value="4.5"'));
  assert.ok(html.includes('id="maxSubtitleCps" type="number" value="18"'));
});

test('batch input and persistent page-session result selector remain available', () => {
  const html = readFileSync('index.html', 'utf8');

  assert.ok(html.includes('id="videoFile" class="visually-hidden-file" type="file" accept="video/*,audio/*" multiple'));
  assert.ok(html.includes('id="jobResultSelect"'));
  assert.ok(html.includes('결과와 편집 내용은 현재 페이지에서 유지됩니다.'));
});

test('mobile video picker and metadata loading have fallbacks', () => {
  const html = readFileSync('index.html', 'utf8');
  const app = readFileSync('src/app.js', 'utf8');

  assert.ok(html.includes('playsinline'));
  assert.ok(app.includes('window.setTimeout(onError, 15000)'));
  assert.ok(app.includes("'durationchange'"));
  assert.ok(app.includes("'canplay'"));
  assert.ok(app.includes('Number.isFinite(state.duration) && state.duration > 0'));
});

test('editor rows group cue actions and timing shifts separately', () => {
  const app = readFileSync('src/app.js', 'utf8');
  const css = readFileSync('styles.css', 'utf8');

  assert.ok(app.includes("className = 'cue-actions'"));
  assert.ok(app.includes("className = 'cue-shifts'"));
  assert.ok(css.includes('grid-template-areas:'));
});

test('editor exposes quality filter and short subtitle merge action', () => {
  const html = readFileSync('index.html', 'utf8');

  assert.ok(html.includes('value="warning"'));
  assert.ok(html.includes('id="mergeShortSubtitles"'));
});
