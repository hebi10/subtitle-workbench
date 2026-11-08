import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fixture, translationBody, audioForm } from './helpers.mjs';

test('HTTP authenticates locally, restricts routes/models, and uses only the server key upstream', async t => {
  const f = await fixture(); t.after(() => f.close());
  for (const path of ['/v1/models/whisper-1', '/v1/audio/transcriptions', '/v1/responses']) {
    const response = await fetch(f.origin + path); assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes(f.config.apiKey));
  }
  for (const path of ['/v1/models/expensive-model', '/v1/models/whisper-1?x=y', '/v1/files', '/v1/models/../responses', 'https://attacker.invalid/']) {
    const response = await fetch(f.origin + (path.startsWith('/') ? path : '/' + path), { headers: f.headers });
    assert.ok(response.status >= 400);
  }
  assert.equal(f.requests.length, 0);
  const response = await fetch(f.origin + '/v1/models/whisper-1', { headers: f.headers });
  assert.deepEqual(await response.json(), { id: 'whisper-1', object: 'model' });
  assert.equal(f.requests[0].headers.authorization, `Bearer ${f.config.apiKey}`);
  assert.ok(!JSON.stringify(f.requests).includes(f.config.accessCode));
});

test('HTTP translation validates schema, reserves text, caps output tokens, and preserves Android response contract', async t => {
  const f = await fixture({ limits: { textChars: 5 } }); t.after(() => f.close());
  const headers = { ...f.headers, 'content-type': 'application/json; charset=utf-8' };
  const rejected = translationBody(); rejected.tools = [];
  assert.equal((await fetch(f.origin + '/v1/responses', { method: 'POST', headers, body: JSON.stringify(rejected) })).status, 400);
  assert.equal(f.requests.length, 0);
  const response = await fetch(f.origin + '/v1/responses', { method: 'POST', headers, body: JSON.stringify(translationBody()) });
  assert.deepEqual(await response.json(), { status: 'completed', output_text: '{"translations":[{"id":0,"translated":"안녕하세요"}]}' });
  const upstream = JSON.parse(f.requests[0].body);
  assert.equal(upstream.max_output_tokens, 8192); assert.equal(upstream.store, false);
  const exhausted = await fetch(f.origin + '/v1/responses', { method: 'POST', headers, body: JSON.stringify(translationBody('x')) });
  assert.equal(exhausted.status, 429); assert.equal(f.requests.length, 1);
});

test('every audio upload runs ffmpeg and normalizes bytes; actual decoded length determines quota', async t => {
  const f = await fixture({ limits: { audioSeconds: 2 } }); t.after(() => f.close());
  const response = await fetch(f.origin + '/v1/audio/transcriptions', { method: 'POST', headers: f.headers, body: audioForm(1.1) });
  assert.equal(response.status, 200);
  const sent = f.requests[0];
  const form = await new Request('http://localhost', { method: 'POST', headers: { 'content-type': sent.headers['content-type'] }, body: sent.body }).formData();
  const file = form.get('file'); const bytes = Buffer.from(await file.arrayBuffer());
  assert.equal(file.name, 'chunk.wav'); assert.equal(file.type, 'audio/wav'); assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(24), 16000); assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.length, 44 + 35200);
  const exhausted = await fetch(f.origin + '/v1/audio/transcriptions', { method: 'POST', headers: f.headers, body: audioForm(0.1) });
  assert.equal(exhausted.status, 429); assert.equal(f.requests.length, 1);
});

test('invalid or overlong decoded audio and arbitrary multipart fields never reach upstream', async t => {
  const f = await fixture(); t.after(() => f.close());
  const invalid = audioForm(); invalid.set('file', new Blob(['not audio']), 'valid-name.m4a');
  const arbitrary = audioForm(); arbitrary.set('prompt', 'arbitrary prompt');
  const wrongFormat = audioForm(); wrongFormat.set('response_format', 'text');
  for (const body of [invalid, arbitrary, wrongFormat]) {
    assert.equal((await fetch(f.origin + '/v1/audio/transcriptions', { method: 'POST', headers: f.headers, body })).status, 400);
  }
  const tooLong = await fetch(f.origin + '/v1/audio/transcriptions', { method: 'POST', headers: f.headers, body: audioForm(31.201, 'gpt-transcribe') });
  assert.equal(tooLong.status, 413); assert.equal(f.requests.length, 0);
});

test('global request quota is reserved before decoder and upstream; storage failure fails closed', async t => {
  const f = await fixture({ limits: { requests: 1 } }); t.after(() => f.close());
  const invalid = audioForm(); invalid.set('file', new Blob(['bad']), 'x.m4a');
  assert.equal((await fetch(f.origin + '/v1/audio/transcriptions', { method: 'POST', headers: f.headers, body: invalid })).status, 400);
  assert.equal((await fetch(f.origin + '/v1/models/whisper-1', { headers: f.headers })).status, 429);
  assert.equal(f.requests.length, 0);
  f.quota.close();
  assert.equal((await fetch(f.origin + '/v1/models/whisper-1', { headers: f.headers })).status, 503);
});

test('chunked body cannot bypass the byte cap', async t => {
  const f = await fixture(); t.after(() => f.close());
  const status = await new Promise((resolve, reject) => {
    const req = http.request(f.origin + '/v1/responses', { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end('x'.repeat(1024 * 1024 + 1));
  });
  assert.equal(status, 413); assert.equal(f.requests.length, 0);
});

test('declared oversized multipart uploads are rejected before reading or decoding', async t => {
  const f = await fixture(); t.after(() => f.close());
  const status = await new Promise((resolve, reject) => {
    const req = http.request(f.origin + '/v1/audio/transcriptions', { method: 'POST', headers: {
      ...f.headers, 'content-type': 'multipart/form-data; boundary=fixture', 'content-length': 24 * 1024 * 1024 + 1
    } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(status, 413); assert.equal(f.requests.length, 0);
});

test('upstream failures, redirects, oversized output and slow replies are bounded and sanitized', async t => {
  for (const respond of [
    (_req, res) => { res.writeHead(401); res.end('secret upstream credential details'); },
    (_req, res) => { res.writeHead(302, { location: 'https://attacker.invalid/' }); res.end(); },
    (_req, res) => { res.end('{"id":"' + 'x'.repeat(4 * 1024 * 1024) + '"}'); }
  ]) {
    const f = await fixture({ respond });
    try { const response = await fetch(f.origin + '/v1/models/whisper-1', { headers: f.headers });
      assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('secret')); }
    finally { await f.close(); }
  }
  const slow = await fixture({ respond: () => {}, relayOptions: { httpTimeoutMs: 40 } }); t.after(() => slow.close());
  const response = await fetch(slow.origin + '/v1/models/whisper-1', { headers: slow.headers });
  assert.equal(response.status, 408);
});
