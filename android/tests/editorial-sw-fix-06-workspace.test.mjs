import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('SW-FIX-06 real IndexedDB opt-in, edit reload, stale tab protection and deletion', { skip: !process.env.PLAYWRIGHT_MODULE }, async () => {
  const server = createServer(async (req, res) => {
    const uri = new URL(req.url, 'http://localhost').pathname;
    const file = uri === '/' ? 'index.html' : uri.slice(1);
    if (!/^(?:index\.html|styles\.css|favicon\.ico|favicon\.png|apple-touch-icon\.png|assets\/brand\/editorial-mark-white\.png|src\/[a-z0-9-]+\.js)$/.test(file)) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.html': 'text/html' })[extname(file)] || 'application/octet-stream');
      res.end(await readFile(join(root, file)));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let externalRequests = 0;
    await context.route('https://**/*', route => { externalRequests++; return route.abort(); });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = 'http://127.0.0.1:' + server.address().port;
    const waitState = (p, value) => p.waitForFunction(v => document.querySelector('#workspaceStorageStatus')?.dataset.state === v, value);
    const db = p => p.evaluate(async () => (await import('/src/workspace-storage.js')).readWorkspace());
    await page.goto(url);
    await waitState(page, 'off');
    await page.locator('#subtitleFile').setInputFiles({ name: 'saved.srt', mimeType: 'text/plain',
      buffer: Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nOriginal subtitle\n') });
    await page.waitForFunction(() => document.querySelectorAll('#editorBody [data-cue-index]').length === 1);
    assert.equal((await db(page)).data, null, 'opt-in required before storing user content');
    await page.locator('#workspaceStorageToggle').click();
    await waitState(page, 'saved');
    const edit = page.locator('#editorBody [data-edit-field="translated"]').first();
    await edit.fill('복구할 편집');
    await edit.press('Tab');
    await waitState(page, 'saved');
    await page.waitForFunction(async () => (await (await import('/src/workspace-storage.js')).readWorkspace()).data.entries[0].subtitles[0].translated === '복구할 편집');
    assert.doesNotMatch(JSON.stringify(await db(page)), /sourceFile|editHistory|apiKey|proxyUrl|blob:/);
    await page.reload();
    await waitState(page, 'restored');
    assert.equal(await page.locator('#editorBody [data-edit-field="translated"]').first().inputValue(), '복구할 편집');
    assert.equal(await page.locator('#videoPreview').isHidden(), true);
    assert.equal(await page.locator('#apiKey').inputValue(), '');
    assert.ok(await page.locator('#downloads a[download]').count() >= 3);
    const other = await context.newPage();
    await other.goto(url);
    await waitState(other, 'restored');
    // A confirmed clear in the other tab changes the revision and prevents stale overwrites.
    other.once('dialog', dialog => dialog.accept());
    await other.locator('#workspaceStorageToggle').click();
    await waitState(other, 'off');
    assert.equal((await db(other)).data, null);
    assert.equal(await other.locator('#editorBody [data-cue-index]').count(), 1, 'current tab edits remain after clearing');
    await page.locator('#editorBody [data-edit-field="translated"]').first().fill('오래된 탭');
    await page.locator('#editorBody [data-edit-field="translated"]').first().press('Tab');
    await waitState(page, 'conflict');
    assert.equal((await db(page)).data, null, 'a stale tab must not resurrect deleted data');
    await page.reload();
    await waitState(page, 'off');
    assert.equal(await page.locator('#editorBody [data-cue-index]').count(), 0);
    assert.equal(externalRequests, 0, 'restore must not perform cloud requests');
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
});

test('SW-FIX-06 real IndexedDB restores partial paid checkpoints and rejects conflicting writes', { skip: !process.env.PLAYWRIGHT_MODULE }, async () => {
  const server = createServer(async (req, res) => {
    if (req.url === '/src/workspace-storage.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(await readFile(join(root, 'src/workspace-storage.js')));
    } else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Local storage fixture</title>'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port);
    const result = await page.evaluate(async () => {
      const m = await import('/src/workspace-storage.js');
      const initial = await m.readWorkspace();
      const snapshot = m.createWorkspaceSnapshot([{ id: '1', fileName: 'partial.mp4', fileSize: 42, duration: 8,
        createdAt: '2026-11-24T00:00:00Z', outputLanguage: 'ko', translationPending: true, offsetSeconds: 0.3,
        translationSettings: { targetLanguage: 'ko', maxSubtitleChars: 42 }, subtitles: [
          { start: 0, end: 1, original: 'first', translated: '완료', status: 'translated' },
          { start: 1, end: 2, original: 'second', translated: '' },
        ] }], '1');
      const revision = await m.writeWorkspace(initial.revision, snapshot);
      let conflict = false;
      try { await m.writeWorkspace(initial.revision, null); } catch (error) { conflict = error.name === 'WorkspaceConflict'; }
      const stored = await m.readWorkspace();
      return { revision, conflict, stored };
    });
    assert.equal(result.conflict, true);
    assert.equal(result.revision, result.stored.revision);
    assert.equal(result.stored.data.entries[0].translationPending, true);
    assert.equal(result.stored.data.entries[0].subtitles[0].translated, '완료');
    assert.equal(result.stored.data.entries[0].subtitles[1].translated, '');
    assert.equal(result.stored.data.entries[0].offsetSeconds, 0.3);
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
});
