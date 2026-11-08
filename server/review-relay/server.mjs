import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { RelayError } from './errors.mjs';
import { normalizeAudio } from './audio.mjs';
import { TRANSCRIPTION_MODELS, transcriptionRequest, transcriptionResponse, translationRequest, translationResponse, validateRealtimeEvent } from './validation.mjs';

const MAX_BODY = 24 * 1024 * 1024;
const MAX_OUTPUT = 4 * 1024 * 1024;
const WS_BUFFER = 256 * 1024;
const REALTIME_SECONDS = 300;
const hash = value => createHash('sha256').update(value).digest();

function authorized(req, config) {
  const value = req.headers.authorization;
  return typeof value === 'string' && value.length <= 140 && value.startsWith('Bearer ')
    && timingSafeEqual(hash(value.slice(7)), hash(config.accessCode));
}
function fail(status, code) { throw new RelayError(status, code); }
function send(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function sendError(res, error) {
  res.shouldKeepAlive = false;
  if (!res.headersSent) res.setHeader('connection', 'close');
  send(res, error instanceof RelayError ? error.status : 503, { error: { code: error instanceof RelayError ? error.code : 'relay_unavailable', message: 'The review relay could not complete this request.' } });
}
async function readBody(req, maximum) {
  const declared = req.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) fail(413, 'request_too_large');
  const chunks = []; let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > maximum) fail(413, 'request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function upstreamJson(origin, path, config, options, signal) {
  let response;
  try {
    response = await fetch(origin + path, { ...options, redirect: 'error', signal,
      headers: { authorization: `Bearer ${config.apiKey}`, accept: 'application/json', ...options?.headers } });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) fail(429, 'insufficient_quota');
      if (response.status === 404) fail(404, 'model_unavailable');
      if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403) fail(400, 'invalid_request');
      fail(502, 'upstream_unavailable');
    }
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) fail(502, 'upstream_response_too_large');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { fail(502, 'invalid_upstream_response'); }
  } catch (error) {
    if (error instanceof RelayError) throw error;
    fail(signal.aborted ? 408 : 502, signal.aborted ? 'request_timeout' : 'upstream_unavailable');
  }
}

// Upstream overrides exist only for local fixture tests, never for request or environment data.
export function createRelayServer({ config, quota, upstreamHttpOrigin = 'https://api.openai.com',
  upstreamWsOrigin = 'wss://api.openai.com', httpTimeoutMs = 180000, realtimeLifetimeMs = 360000,
  realtimeHandshakeMs = 10000, decoderOptions } = {}) {
  if (!config?.accessCode || !config?.apiKey || !quota) throw new Error('Relay configuration required');
  let inFlight = 0;
  let audioInFlight = 0;
  const active = new Set();
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    const timer = setTimeout(() => { controller.abort(); sendError(res, new RelayError(408, 'request_timeout')); req.destroy(); }, httpTimeoutMs);
    timer.unref();
    let counted = false;
    let countedAudio = false;
    try {
      if (!authorized(req, config)) fail(401, 'authentication');
      if (inFlight >= 4) fail(429, 'rate_limit');
      if (req.url.includes('?') || req.url.includes('#')) fail(404, 'not_found');
      const model = req.method === 'GET' && /^\/v1\/models\/([A-Za-z0-9._:-]{1,100})$/.exec(req.url)?.[1];
      const transcribe = req.method === 'POST' && req.url === '/v1/audio/transcriptions';
      const translate = req.method === 'POST' && req.url === '/v1/responses';
      if (!model && !transcribe && !translate) fail(404, 'not_found');
      if (transcribe && audioInFlight >= 2) fail(429, 'rate_limit');
      if (model && ![...TRANSCRIPTION_MODELS, ...config.translationModels].includes(model)) fail(400, 'invalid_request');
      if (model && (req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) > 0)) fail(400, 'invalid_request');
      quota.reserve({ requests: 1 }); inFlight++; counted = true;
      if (transcribe) { audioInFlight++; countedAudio = true; }
      if (model) {
        const value = await upstreamJson(upstreamHttpOrigin, '/v1/models/' + model, config, { method: 'GET' }, controller.signal);
        if (value.id !== model) fail(502, 'invalid_upstream_response');
        send(res, 200, { id: model, object: 'model' });
      } else if (translate) {
        if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) fail(400, 'invalid_request');
        const raw = await readBody(req, 1024 * 1024);
        let value; try { value = JSON.parse(raw.toString('utf8')); } catch { fail(400, 'invalid_request'); }
        const checked = translationRequest(value, config.translationModels);
        quota.reserve({ textChars: checked.characters });
        const result = await upstreamJson(upstreamHttpOrigin, '/v1/responses', config,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(checked.body) }, controller.signal);
        send(res, 200, translationResponse(result, checked.count));
      } else {
        const raw = await readBody(req, MAX_BODY);
        const checked = await transcriptionRequest(raw, req.headers['content-type'] || '');
        const { audio, seconds } = await normalizeAudio(checked.file, checked.maxSeconds, controller.signal, decoderOptions);
        quota.reserve({ audioSeconds: seconds });
        const form = new FormData();
        form.set('model', checked.model); form.set('response_format', checked.format);
        for (const timestamp of checked.timestamps) form.append('timestamp_granularities[]', timestamp);
        if (checked.model === 'gpt-4o-transcribe-diarize') form.set('chunking_strategy', 'auto');
        if (checked.sourceLanguage) form.set(checked.languageKey, checked.sourceLanguage);
        form.set('file', new Blob([audio], { type: 'audio/wav' }), 'chunk.wav');
        const result = await upstreamJson(upstreamHttpOrigin, '/v1/audio/transcriptions', config, { method: 'POST', body: form }, controller.signal);
        send(res, 200, transcriptionResponse(result));
      }
    } catch (error) { sendError(res, error); }
    finally { clearTimeout(timer); res.off('close', disconnected); if (counted) inFlight--; if (countedAudio) audioInFlight--; }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 45000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 64;
  server.on('clientError', (_error, socket) => socket.destroy());
  const wss = new WebSocketServer({ noServer: true, maxPayload: 96 * 1024, perMessageDeflate: false, clientTracking: true });
  server.on('upgrade', (req, socket, head) => {
    try {
      if (!authorized(req, config)) fail(401, 'authentication');
      if (req.url !== '/v1/realtime?intent=transcription') fail(404, 'not_found');
      if (active.size >= 2) fail(429, 'rate_limit');
      if (req.headers['sec-websocket-protocol'] || req.headers.origin) fail(400, 'invalid_request');
      quota.reserve({ requests: 1, realtimeSeconds: REALTIME_SECONDS });
      wss.handleUpgrade(req, socket, head, ws => {
        const session = relayRealtime(ws, config, upstreamWsOrigin, { lifetimeMs: realtimeLifetimeMs, handshakeMs: realtimeHandshakeMs }, () => active.delete(session));
        active.add(session);
      });
    } catch (error) {
      const status = error instanceof RelayError ? error.status : 503;
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
  });
  return { server, async close() {
    for (const session of active) session.close();
    wss.close(); server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  } };
}

function relayRealtime(client, config, origin, options, onClose) {
  let closed = false, configured = false, committed = false, audioBytes = 0, outputBytes = 0, queuedBytes = 0;
  const queue = [];
  const upstream = new WebSocket(origin + '/v1/realtime?intent=transcription', {
    headers: { authorization: `Bearer ${config.apiKey}` }, handshakeTimeout: options.handshakeMs,
    followRedirects: false, maxPayload: 1024 * 1024, perMessageDeflate: false
  });
  const close = (code = 1000) => {
    if (closed) return;
    closed = true; clearTimeout(lifetime); clearTimeout(initialization); queue.length = 0;
    for (const socket of [client, upstream]) {
      if (socket.readyState === WebSocket.OPEN) socket.close(code, code === 1000 ? 'Session ended' : 'Review relay limit or invalid event');
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    }
    const termination = setTimeout(() => { client.terminate(); upstream.terminate(); }, 1000); termination.unref();
    onClose();
  };
  const lifetime = setTimeout(() => close(1008), options.lifetimeMs); lifetime.unref();
  const initialization = setTimeout(() => { if (!configured) close(1008); }, Math.min(15000, options.lifetimeMs)); initialization.unref();
  const forward = event => {
    if (upstream.bufferedAmount > WS_BUFFER) return close(1008);
    upstream.send(event, error => { if (error) close(1011); });
  };
  upstream.on('open', () => { for (const event of queue) { if (!closed) forward(event); } queue.length = 0; queuedBytes = 0; });
  upstream.on('error', () => close(1011));
  upstream.on('close', () => close());
  client.on('error', () => close(1008));
  client.on('close', () => close());
  client.on('message', (raw, isBinary) => {
    if (closed) return;
    try {
      if (isBinary) fail(400, 'invalid_request');
      const checked = validateRealtimeEvent(JSON.parse(raw.toString('utf8')));
      const event = checked.event;
      if (event.type === 'session.update') {
        if (configured || committed) fail(400, 'invalid_request');
        configured = true; clearTimeout(initialization);
      } else if (!configured || committed) fail(400, 'invalid_request');
      if (event.type === 'input_audio_buffer.commit') {
        if (audioBytes < 2) fail(400, 'invalid_request');
        committed = true;
      }
      audioBytes += checked.bytes;
      if (audioBytes > REALTIME_SECONDS * 48000) fail(413, 'audio_duration_exceeded');
      const payload = JSON.stringify(event);
      if (upstream.readyState === WebSocket.OPEN) forward(payload);
      else if (upstream.readyState === WebSocket.CONNECTING) {
        queuedBytes += Buffer.byteLength(payload);
        if (queuedBytes > WS_BUFFER) fail(413, 'request_too_large');
        queue.push(payload);
      } else close(1011);
    } catch { close(1008); }
  });
  upstream.on('message', (raw, isBinary) => {
    if (closed) return;
    try {
      outputBytes += raw.length;
      if (isBinary || outputBytes > MAX_OUTPUT || client.bufferedAmount > WS_BUFFER) return close(1008);
      const value = JSON.parse(raw.toString('utf8'));
      let event;
      if (value.type === 'session.created' || value.type === 'session.updated' || value.type === 'input_audio_buffer.committed') event = { type: value.type };
      else if (value.type === 'conversation.item.input_audio_transcription.delta' || value.type === 'conversation.item.input_audio_transcription.completed') {
        const key = value.type.endsWith('.completed') ? 'transcript' : 'delta';
        if (typeof value[key] !== 'string' || value[key].length > 200000) return close(1011);
        event = { type: value.type, [key]: value[key] };
      } else if (value.type === 'error' || value.type === 'conversation.item.input_audio_transcription.failed') {
        client.send(JSON.stringify({ type: 'error', error: { message: 'The review realtime request failed.' } }));
        return close(1011);
      }
      if (event) client.send(JSON.stringify(event), error => { if (error) close(1011); });
    } catch { close(1011); }
  });
  return { close };
}
