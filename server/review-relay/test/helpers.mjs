import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { Quota } from '../quota.mjs';
import { DEFAULT_LIMITS } from '../config.mjs';
import { createRelayServer } from '../server.mjs';
import { TRANSLATION_FORMAT, TRANSLATION_INSTRUCTIONS } from '../validation.mjs';
import { wav } from '../audio.mjs';

export function translationBody(text = 'Hello') {
  return { model: 'gpt-6-luna', store: false, reasoning: { effort: 'low' }, text: { verbosity: 'low', format: TRANSLATION_FORMAT }, instructions: TRANSLATION_INSTRUCTIONS,
    input: JSON.stringify({ targetLanguage: 'ko', subtitles: [{ id: 0, text }] }) };
}
export function sessionUpdate(language = 'ko') {
  return { type: 'session.update', session: { type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'gpt-live-transcribe', languages: [language] }, turn_detection: null } } } };
}
export function audioForm(seconds = 1, model = 'whisper-1') {
  const form = new FormData();
  form.set('model', model);
  form.set('response_format', model === 'whisper-1' ? 'verbose_json' : model === 'gpt-transcribe' ? 'json' : 'diarized_json');
  if (model === 'whisper-1') { form.append('timestamp_granularities[]', 'segment'); form.append('timestamp_granularities[]', 'word'); }
  if (model === 'gpt-4o-transcribe-diarize') form.set('chunking_strategy', 'auto');
  form.set('file', new Blob([wav(Buffer.alloc(Math.round(seconds * 32000)))], { type: 'audio/wav' }), 'chunk.m4a');
  return form;
}
export async function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-integration-'));
  const requests = [], events = [], upstreamSockets = new Set(), rawSockets = new Set();
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({ url: req.url, method: req.method, headers: req.headers, body });
    if (options.respond) return options.respond(req, res, body);
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models/')) res.end(JSON.stringify({ id: req.url.split('/').at(-1), client_secret: 'never forward' }));
    else if (req.url === '/v1/responses') res.end(JSON.stringify({ status: 'completed', output_text: JSON.stringify({ translations: [{ id: 0, translated: '안녕하세요' }] }) }));
    else res.end(JSON.stringify({ text: 'Hello', duration: 1, words: [{ word: 'Hello', start: 0, end: 1 }] }));
  });
  upstream.on('connection', socket => { rawSockets.add(socket); socket.once('close', () => rawSockets.delete(socket)); });
  const wss = new WebSocketServer({ ...(options.stallUpgrade ? { noServer: true } : { server: upstream }), maxPayload: 1024 * 1024, perMessageDeflate: false });
  if (options.stallUpgrade) upstream.on('upgrade', () => {});
  wss.on('connection', (socket, req) => {
    upstreamSockets.add(socket); socket.once('close', () => upstreamSockets.delete(socket));
    socket.on('error', () => {});
    requests.push({ url: req.url, headers: req.headers, websocket: true });
    socket.send(JSON.stringify({ type: 'session.created', session: { client_secret: 'never forward' } }));
    socket.on('message', raw => {
      const event = JSON.parse(raw.toString()); events.push(event);
      if (options.onEvent) options.onEvent(event, socket);
      else if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated', session: { client_secret: 'never forward' } }));
      else if (event.type === 'input_audio_buffer.commit') socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Hello', secret: 'never forward' }));
    });
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const config = { accessCode: 'local-fixture-access-code-'.repeat(2), apiKey: 'sk-local-fixture-not-a-real-key', translationModels: ['gpt-6-luna'], limits: { ...DEFAULT_LIMITS, ...options.limits } };
  const quota = new Quota(join(directory, 'quota.sqlite'), config.limits);
  const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  const relay = createRelayServer({ config, quota, upstreamHttpOrigin: upstreamOrigin, upstreamWsOrigin: upstreamOrigin.replace('http:', 'ws:'), ...options.relayOptions });
  relay.server.listen(0, '127.0.0.1'); await once(relay.server, 'listening');
  const origin = `http://127.0.0.1:${relay.server.address().port}`;
  return { origin, config, quota, requests, events, upstreamSockets, headers: { authorization: `Bearer ${config.accessCode}` },
    connect(extraHeaders = {}, path = '/v1/realtime?intent=transcription') {
      const ws = new WebSocket(origin.replace('http:', 'ws:') + path, { headers: { authorization: `Bearer ${config.accessCode}`, ...extraHeaders } });
      ws.on('error', () => {}); return ws;
    },
    async close() {
      await relay.close();
      for (const socket of upstreamSockets) socket.terminate();
      for (const socket of rawSockets) socket.destroy();
      wss.close(); upstream.closeAllConnections();
      await new Promise(resolve => upstream.close(resolve)); quota.close(); rmSync(directory, { recursive: true, force: true });
    }
  };
}
export function message(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Fixture event timeout: ' + type)); }, 3000);
    const onMessage = raw => { const value = JSON.parse(raw.toString()); if (value.type === type) { cleanup(); resolve(value); } };
    const onClose = () => { cleanup(); reject(new Error('Socket closed before fixture event')); };
    function cleanup() { clearTimeout(timer); ws.off('message', onMessage); ws.off('close', onClose); }
    ws.on('message', onMessage); ws.on('close', onClose);
  });
}
export async function connectConfigured(f) {
  const ws = f.connect(); const ready = message(ws, 'session.updated');
  await once(ws, 'open'); ws.send(JSON.stringify(sessionUpdate())); await ready;
  return ws;
}
