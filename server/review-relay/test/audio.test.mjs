import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeAudio, wav } from '../audio.mjs';
import { fixture } from './helpers.mjs';

test('decoder rejects chunks beyond the 421.2-second codec allowance despite short claimed duration', async () => {
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

test('codec allowance accepts exactly 200ms of actual PCM and reserves rounded-up decoded seconds', async () => {
  for (const maxSeconds of [31, 421]) {
    const byteCap = maxSeconds * 32000 + 6400;
    const result = await normalizeAudio(new Blob([wav(Buffer.alloc(byteCap))]), maxSeconds);
    assert.equal(result.seconds, maxSeconds + 1);
    assert.equal(result.audio.length, 44 + byteCap);
    await assert.rejects(normalizeAudio(new Blob([wav(Buffer.alloc(byteCap + 2))]), maxSeconds), error => error.code === 'audio_duration_exceeded');
  }
});

test('real 24kHz AAC-LC clips at planned boundaries survive codec padding but longer clips are rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-aac-boundary-'));
  try {
    for (const maxSeconds of [31, 421]) {
      for (const extraSeconds of [0, 0.21]) {
        const path = join(directory, `audio-${maxSeconds}-${extraSeconds}.m4a`);
        execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
          '-t', String(maxSeconds + extraSeconds), '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '64000', '-use_editlist', '0', path], { timeout: 30000 });
        const source = new Blob([readFileSync(path)], { type: 'audio/mp4' });
        if (extraSeconds) await assert.rejects(normalizeAudio(source, maxSeconds), error => error.code === 'audio_duration_exceeded');
        else {
          const normalized = await normalizeAudio(source, maxSeconds);
          const decodedSeconds = (normalized.audio.length - 44) / 32000;
          assert.ok(decodedSeconds > maxSeconds, 'fixture must exercise actual AAC frame padding');
          assert.ok(decodedSeconds <= maxSeconds + 0.2);
          assert.equal(normalized.seconds, Math.ceil(decodedSeconds));
        }
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
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
