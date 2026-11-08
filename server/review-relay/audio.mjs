import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RelayError } from './errors.mjs';

const PCM_BYTES_PER_SECOND = 32000;
const CODEC_PADDING_BYTES = 6400;

export function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function normalizeAudio(file, maxSeconds, signal, { timeoutMs = 30000, ffmpeg = 'ffmpeg', tempRoot = tmpdir() } = {}) {
  const directory = await mkdtemp(join(tempRoot, 'subtitle-review-'));
  const maxPcmBytes = maxSeconds * PCM_BYTES_PER_SECOND + CODEC_PADDING_BYTES;
  try {
    if (signal?.aborted) throw new RelayError(408, 'request_timeout');
    const input = join(directory, 'upload');
    await writeFile(input, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    const pcm = await new Promise((resolve, reject) => {
      const child = spawn(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error',
        '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,wav,mp3,ogg,flac,aac',
        '-threads', '1', '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn', '-t', String(maxSeconds + 1),
        '-threads', '1', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks = []; let length = 0; let failure;
      const fail = error => { failure ||= error; child.kill('SIGKILL'); };
      const onAbort = () => fail(new RelayError(408, 'request_timeout'));
      const timer = setTimeout(onAbort, timeoutMs); timer.unref();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      child.stdout.on('data', chunk => {
        length += chunk.length;
        if (length > maxPcmBytes) fail(new RelayError(413, 'audio_duration_exceeded'));
        else chunks.push(chunk);
      });
      child.on('error', () => { failure ||= new RelayError(503, 'audio_decoder_unavailable'); });
      child.on('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
        if (failure) reject(failure);
        else if (code !== 0 || length < 2 || length % 2) reject(new RelayError(400, 'invalid_audio'));
        else resolve(Buffer.concat(chunks));
      });
    });
    return { audio: wav(pcm), seconds: Math.ceil(pcm.length / PCM_BYTES_PER_SECOND) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
