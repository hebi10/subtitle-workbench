import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { before, after } from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const images = join(root, 'output/editorial-3b');
let server;
let browser;
let baseUrl;

test('3-B editor and settings retain critical native contracts', async () => {
  const [markup, stylesheet, code] = await Promise.all([
    readFile(join(root, 'android/web/index.html'), 'utf8'),
    readFile(join(root, 'android/web/styles.css'), 'utf8'),
    readFile(join(root, 'android/web/app.js'), 'utf8'),
  ]);
  for (const id of ['editorFeedback','cueList','saveStatus','retrySave','prevPage','nextPage',
    'apiSettings','defaultSettings','dataSettings','personalApiSettings','reviewRelaySettings',
    'reviewRelayCode','settingsConnectionSummary','settingsDefaultsOverview']) {
    assert.equal((markup.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  assert.ok(markup.indexOf('id="editorFeedback"') < markup.indexOf('id="cueList"'));
  assert.match(stylesheet, /#editorView \.editor-feedback \{[\s\S]*?position:sticky/);
  assert.match(stylesheet, /#editorView \.cue-list \{[\s\S]*?overflow:visible/);
  assert.match(code, /--editor-status-height/);
  assert.match(code, /settingsConnectionSummary/);
  assert.match(code, /settingsDefaultsOverview/);
  assert.match(markup, /id="apiKey" type="password"/);
  assert.match(markup, /id="reviewRelayCode" type="password"/);
});

before(async () => {
  if (!enabled) return;
  const paths = {
    '/':'android/web/index.html',
    '/styles.css':'android/web/styles.css',
    '/app.js':'android/web/app.js',
    '/editorial-mark-white.png':'android/web/editorial-mark-white.png',
    '/shared/core.js':'src/core.js',
    '/shared/subtitle-editor.js':'src/subtitle-editor.js',
    '/shared/edit-history.js':'src/edit-history.js',
    '/shared/subtitle-player.js':'src/subtitle-player.js',
  };
  await mkdir(images, { recursive:true });
  server = createServer(async (req,res) => {
    const path=paths[new URL(req.url,'http://localhost').pathname];
    if (!path) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type',path.endsWith('.png')?'image/png':path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html');
      res.end(await readFile(join(root,path)));
    } catch {res.writeHead(500).end();}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  baseUrl='http://127.0.0.1:'+server.address().port;
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  browser=await chromium.launch({headless:true});
});

after(async()=>{
  await browser?.close();
  if(server) await new Promise(done=>server.close(done));
});

async function withApp(width,theme,action){
  const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme,locale:'ko-KR'});
  const page=await context.newPage();
  page.setDefaultTimeout(10000);
  await page.addInitScript({path:join(root,'android/web/mock-bridge.js')});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(baseUrl);
    await page.locator('#jobsView .job').first().waitFor();
    await action(page);
    assert.deepEqual(errors,[],'Unexpected UI exception');
  } finally {await context.close();}
}

async function openEditor(page) {
  await page.locator('#jobsView .job[data-job-id="complete-1"]').getByRole('button',{name:'자막 편집',exact:true}).click();
  await page.locator('.cue textarea').first().waitFor();
}

test('3-B deep editor shows sticky save/page toolbar without nested cue scrolling', {skip:!enabled}, async()=>{
  await withApp(390,'light',async page=>{
    await openEditor(page);
    const css=await page.locator('#editorFeedback').evaluate(node=>({
      position:getComputedStyle(node).position,
      nested:getComputedStyle(document.getElementById('cueList')).overflowY,
    }));
    assert.equal(css.position,'sticky');
    assert.equal(css.nested,'visible');
    await page.locator('.cue[data-index="10"] .cue-summary').click();
    assert.ok(await page.evaluate(()=>scrollY>350));
    const positions=await page.evaluate(()=>{
      const bar=document.getElementById('editorFeedback').getBoundingClientRect();
      const nav=document.querySelector('.app-nav').getBoundingClientRect();
      const selected=document.querySelector('.cue.selected .cue-summary').getBoundingClientRect();
      return {top:bar.top,bottom:bar.bottom,navTop:nav.top,selectedTop:selected.top};
    });
    assert.ok(positions.top>=-1);
    assert.ok(positions.bottom<positions.navTop,'Save toolbar must not cover bottom navigation');
    assert.ok(positions.selectedTop>=positions.bottom-1,'Selected cue must not hide behind toolbar');
    await page.screenshot({path:join(images,'editor-deep-light.png'),animations:'disabled'});
    await page.locator('#nextPage').click();
    assert.match(await page.locator('#pageInfo').textContent(),/2\s*\/\s*3/);
    assert.equal(await page.locator('.cue.selected').getAttribute('data-index'),'12');
  });
});

test('3-B retry stays visible at deep cue and preserves unsaved edits', {skip:!enabled}, async()=>{
  await withApp(390,'dark',async page=>{
    await openEditor(page);
    await page.locator('.cue[data-index="10"] .cue-summary').click();
    await page.evaluate(()=>{window.mockNative.failSave=true;});
    const field=page.locator('.cue.selected textarea').first();
    await field.fill('저장 실패 후에도 보존할 원문');
    await page.locator('#retrySave').waitFor({state:'visible'});
    const pos=await page.evaluate(()=>{
      const bar=document.getElementById('editorFeedback').getBoundingClientRect();
      const retry=document.getElementById('retrySave').getBoundingClientRect();
      return {scrollY,barBottom:bar.bottom,retryTop:retry.top,overflow:getComputedStyle(document.getElementById('saveStatus')).overflowY};
    });
    assert.ok(pos.scrollY>350);
    assert.ok(pos.retryTop>=0&&pos.retryTop<pos.barBottom);
    assert.equal(pos.overflow,'visible');
    assert.equal(await field.inputValue(),'저장 실패 후에도 보존할 원문');
    await page.screenshot({path:join(images,'editor-save-error-dark.png'),animations:'disabled'});
    await page.evaluate(()=>{window.mockNative.failSave=false;});
    await page.locator('#retrySave').click();
    await page.locator('#retrySave').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.mockNative.cues['complete-1'][10].original),'저장 실패 후에도 보존할 원문');
  });
});

test('3-B settings show saved connection/model and protect pending test codes', {skip:!enabled}, async()=>{
  await withApp(390,'light',async page=>{
    await page.locator('#navSettings').click();
    assert.match(await page.locator('#settingsConnectionSummary').innerText(),/개인 API/);
    assert.match(await page.locator('#settingsDefaultsOverview').innerText(),/whisper-1/);
    assert.equal(await page.locator('.settings-overview > div').count(),2);
    assert.deepEqual(await page.locator('#settingsView .settings-index').allTextContents(),
      ['01 / CONNECTION','02 / DEFAULTS','03 / DATA','04 / PRIVACY']);
    await page.locator('#apiSettings > summary').click();
    await page.locator('#cloudMode').selectOption('relay');
    assert.equal(await page.locator('#reviewRelaySettings').isVisible(),true);
    assert.equal(await page.locator('#personalApiSettings').isVisible(),false);
    assert.equal(await page.locator('#reviewRelayCode').getAttribute('type'),'password');
    await page.locator('#reviewRelayCode').fill('fixture_only_access_code_11111111111111111111111111111');
    assert.doesNotMatch(await page.locator('.settings-overview').innerText(),/fixture_only_access_code/);
    await page.locator('#navJobs').click();
    assert.equal(await page.locator('#reviewRelayCode').inputValue(),'');
    await page.locator('#navSettings').click();
    assert.match(await page.locator('#settingsConnectionSummary').innerText(),/개인 API/);
  });
});

test('3-B responsive editor/settings do not overflow in light and dark modes', {skip:!enabled}, async()=>{
  await withApp(390,'light',async page=>{
    for(const width of [320,390,800]){
      await page.setViewportSize({width,height:844});
      for(const theme of ['light','dark']){
        await page.emulateMedia({colorScheme:theme});
        await page.locator('#navSettings').click();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Settings horizontal overflow');
        const box=await page.locator('.settings-overview').boundingBox();
        assert.ok(box&&box.width<=width);
        if(width!==320) await page.screenshot({path:join(images,'settings-'+width+'-'+theme+'.png'),animations:'disabled'});
        await page.locator('#navJobs').click();
        await openEditor(page);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Editor horizontal overflow');
        const bar=await page.locator('#editorFeedback').boundingBox();
        const nav=await page.locator('.app-nav').boundingBox();
        assert.ok(bar&&nav&&bar.y+bar.height<nav.y+1,'Status and bottom navigation must not overlap');
        if(width!==320) await page.screenshot({path:join(images,'editor-'+width+'-'+theme+'.png'),animations:'disabled'});
        await page.locator('#navJobs').click();
      }
    }
  });
});
