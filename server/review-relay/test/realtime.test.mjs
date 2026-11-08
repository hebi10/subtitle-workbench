import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fixture, sessionUpdate, message, connectConfigured } from './helpers.mjs';

const append = bytes => JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.alloc(bytes).toString('base64') });

test('realtime authenticates upgrades and reserves a full session before upstream connect', async t => {
  const f = await fixture({ limits: { realtimeSeconds: 300 } }); t.after(() => f.close());
  const unauthorized = f.connect({ authorization: 'Bearer invalid' });
  const rejected = await new Promise(resolve => unauthorized.once('unexpected-response', (_req, response) => { response.resume(); unauthorized.terminate(); resolve(response.statusCode); }));
  assert.equal(rejected, 401); assert.equal(f.requests.length, 0);
  const ws = f.connect(); await once(ws, 'open');
  const created = await message(ws, 'session.created');
  assert.deepEqual(created, { type: 'session.created' });
  const closed = once(ws, 'close'); ws.close(); await closed;
  const exhausted = f.connect();
  const exhaustedStatus = await new Promise(resolve => exhausted.once('unexpected-response', (_req, response) => { response.resume(); exhausted.terminate(); resolve(response.statusCode); }));
  assert.equal(exhaustedStatus, 429);
  assert.equal(f.requests.filter(value => value.websocket).length, 1);
  assert.equal(f.requests[0].headers.authorization, `Bearer ${f.config.apiKey}`);
});

test('realtime passes only reconstructed transcription payloads and safe result events', async t => {
  const f = await fixture(); t.after(() => f.close());
  const ws = await connectConfigured(f);
  const result = message(ws, 'conversation.item.input_audio_transcription.completed');
  ws.send(append(4800)); ws.send('{"type":"input_audio_buffer.commit"}');
  assert.deepEqual(await result, { type: 'conversation.item.input_audio_transcription.completed', transcript: 'Hello' });
  assert.deepEqual(f.events.map(value => value.type), ['session.update', 'input_audio_buffer.append', 'input_audio_buffer.commit']);
  const closed = once(ws, 'close');
  ws.send('{"type":"input_audio_buffer.commit"}');
  assert.equal((await closed)[0], 1008);
  assert.equal(f.events.filter(value => value.type === 'input_audio_buffer.commit').length, 1);
});

test('arbitrary realtime events and schema changes close both sockets without forwarding them', async t => {
  const f = await fixture(); t.after(() => f.close());
  const ws = await connectConfigured(f);
  const closed = once(ws, 'close'); ws.send('{"type":"response.create","response":{"model":"arbitrary"}}');
  assert.equal((await closed)[0], 1008);
  assert.equal(f.events.length, 1);
});

test('realtime rejects audio before configuration and duplicate updates', async t => {
  for (const operation of [async ws => ws.send(append(4800)), async ws => { ws.send(JSON.stringify(sessionUpdate())); ws.send(JSON.stringify(sessionUpdate())); }]) {
    const f = await fixture();
    try {
      const ws = f.connect(); await once(ws, 'open');
      const closed = once(ws, 'close'); await operation(ws);
      assert.equal((await closed)[0], 1008);
      assert.ok(f.events.length <= 1);
    } finally { await f.close(); }
  }
});

test('realtime allows at most five minutes of mono PCM even within a six-minute connection', async t => {
  const f = await fixture(); t.after(() => f.close());
  const ws = await connectConfigured(f);
  const closed = once(ws, 'close');
  const frame = append(48000);
  for (let i = 0; i < 301 && ws.readyState === 1; i++) {
    await new Promise((resolve, reject) => ws.send(frame, error => error ? reject(error) : resolve()));
    // Let the real local relay and upstream drain so this exercises PCM duration, not the independent backlog cap.
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.equal((await closed)[0], 1008);
  assert.equal(f.events.filter(value => value.type === 'input_audio_buffer.append').length, 300);
});

test('connection lifetime closes both sides and failed upstream details never reach the client', async t => {
  const f = await fixture({ relayOptions: { realtimeLifetimeMs: 100 } }); t.after(() => f.close());
  const ws = await connectConfigured(f); assert.equal((await once(ws, 'close'))[0], 1008);
  const failure = await fixture({ onEvent(_event, socket) { socket.send(JSON.stringify({ type: 'error', error: { message: 'secret key from upstream', code: 'raw' } })); } });
  t.after(() => failure.close());
  const failed = failure.connect(); const errorEvent = message(failed, 'error');
  await once(failed, 'open'); failed.send(JSON.stringify(sessionUpdate()));
  assert.deepEqual(await errorEvent, { type: 'error', error: { message: 'The review realtime request failed.' } });
});

test('disconnecting a client tears down the upstream socket', async t => {
  const f = await fixture(); t.after(() => f.close());
  const ws = await connectConfigured(f);
  const [upstream] = f.upstreamSockets; const upstreamClosed = once(upstream, 'close');
  ws.terminate(); await upstreamClosed;
  assert.equal(f.upstreamSockets.size, 0);
});

test('upstream handshake timeout and pre-handshake backlog both close cleanly', async t => {
  const timeout = await fixture({ stallUpgrade: true, relayOptions: { realtimeHandshakeMs: 40 } }); t.after(() => timeout.close());
  const ws = timeout.connect(); await once(ws, 'open');
  assert.equal((await once(ws, 'close'))[0], 1011);
  const backlog = await fixture({ stallUpgrade: true }); t.after(() => backlog.close());
  const queued = backlog.connect(); await once(queued, 'open');
  const closed = once(queued, 'close'); queued.send(JSON.stringify(sessionUpdate()));
  for (let i = 0; i < 5; i++) queued.send(append(48000));
  assert.equal((await closed)[0], 1008);
});
