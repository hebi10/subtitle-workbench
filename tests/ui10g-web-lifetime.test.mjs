import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('UI-10-G three web panels disclose page-only results and verified file downloads', async () => {
  const markup = await readFile(resolve(root, 'index.html'), 'utf8');
  for (const id of ['panel-generate','panel-edit','panel-export','generateWorkflowStatus',
     'editorWorkspaceStatus','exportWorkflowStatus','exportSessionNote','exportDownloadStatus']) {
    assert.equal((markup.match(new RegExp('id="' + id + '"', 'g'))||[]).length, 1, id);
  }
  assert.match(markup, /자막·편집 결과는 현재 페이지의 임시 데이터/);
  assert.match(markup, /수정 내용은 현재 페이지에서 유지됩니다/);
  assert.match(markup, /자막과 수정 내용은 현재 페이지의 임시 데이터/);
  assert.match(markup, /실제 저장 여부는 브라우저 다운로드 내역에서 확인/);
});
test('UI-10-G file preparation differs from requested download and never claims saved', async () => {
  const [source,styles] = await Promise.all([
    readFile(resolve(root, 'src/app.js'), 'utf8'),
    readFile(resolve(root, 'styles.css'), 'utf8'),
  ]);
  for (const state of ['requested','preparing','ready','error'])
    assert.ok(source.includes("dataset.state = '" + state + "'"), state);
  assert.match(source, /dataset\.format = format/);
  assert.match(source, /다운로드 요청됨 · 실제 저장 여부는 브라우저 다운로드 내역에서 확인/);
  assert.match(source, /현재 페이지의 원문을 보존한 상태에서 SRT·VTT·JSON/);
  assert.match(styles, /#panel-export #exportDownloadStatus\[data-state="requested"\]/);
});
