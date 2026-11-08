import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeAudio, wav } from '../audio.mjs';
import { fixture } from './helpers.mjs';

test('decoder rejects full padded chunks beyond 421 seconds despite short claimed duration', async () => {
  const pcm = Buffer.alloc(422 * 32000);
  const source = wav(pcm);
  // A false RIFF container size is not trusted as an audio duration or upload bound.
  source.writeUInt32LE(36 + 32000, 4);
  await assert.rejects(normalizeAudio(new Blob([source]), 421), error => error.code === 'audio_duration_exceeded');
});

test('decoder accepts the actual 421-second padded limit', async () => {
  const result = await normalizeAudio(new Blob([wav(Buffer.alloc(421 * 32000))]), 421);
  assert.equal(result.seconds, 421); assert.equal(result.audio.length, 44 + 421 * 32000);
});

test('decoder rejects playlist and concat demuxers before referencing another file or URL', async t => {
  const f = await fixture(); t.after(() => f.close());
  for (const body of [
    `ffconcat version 1.0\nfile '${f.origin}/must-not-be-read.wav'\n`,
    `#EXTM3U\n#EXTINF:1,\n${f.origin}/must-not-be-read.wav\n#EXT-X-ENDLIST\n`,
    'ffconcat version 1.0\nfile /etc/passwd\n'
  ]) await assert.rejects(normalizeAudio(new Blob([body]), 31), error => error.code === 'invalid_audio');
  assert.equal(f.requests.length, 0);
});

test('temporary input files are removed after timeout, abort, and decoder failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'relay-audio-test-'));
  try {
    const options = { tempRoot: root, timeoutMs: 1 };
    await assert.rejects(normalizeAudio(new Blob([wav(Buffer.alloc(421 * 32000))]), 421, undefined, options), error => error.code === 'request_timeout');
    assert.deepEqual(readdirSync(root), []);
    const controller = new AbortController();
    const operation = normalizeAudio(new Blob([wav(Buffer.alloc(421 * 32000))]), 421, controller.signal, { tempRoot: root });
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(operation, error => error.code === 'request_timeout');
    assert.deepEqual(readdirSync(root), []);
    await assert.rejects(normalizeAudio(new Blob(['bad']), 31, undefined, { tempRoot: root }));
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
