import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { resolveClassWorkerURL } from '../src/ffmpeg-config.js';

test('vendored worker default core URL cannot fall back to an external origin', async () => {
  const { CORE_URL } = await import('../vendor/ffmpeg/ffmpeg/const.js');
  assert.equal(CORE_URL, new URL('../vendor/ffmpeg/core/ffmpeg-core.js', import.meta.url).href);
});

test('vendored FFmpeg distribution matches its file integrity manifest', async () => {
  const base = new URL('../vendor/ffmpeg/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  assert.equal(manifest.packages.length, 3);
  assert.ok(manifest.files.some((file) => file.path === 'core/ffmpeg-core.wasm'));
  for (const file of manifest.files) {
    const content = await readFile(new URL(file.path, base));
    assert.equal(content.length, file.bytes, file.path);
    assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256, file.path);
  }
});

test('resolveClassWorkerURL points ffmpeg class worker to a same-origin shim', () => {
  assert.equal(resolveClassWorkerURL(), new URL('../vendor/ffmpeg-worker.js', import.meta.url).href);
  assert.equal(
    resolveClassWorkerURL('http://127.0.0.1:4173/index.html'),
    'http://127.0.0.1:4173/vendor/ffmpeg-worker.js',
  );
});

async function createPipeline(options = {}) {
  const { BrowserFfmpeg } = await import('../src/ffmpeg-pipeline.js');
  const workers = [];
  const urls = [];
  const sources = [];
  class FakeFFmpeg {
    constructor() { this.files = new Map(); this.listeners = {}; this.exitCode = 0; workers.push(this); }
    on(name, fn) { this.listeners[name] = fn; }
    async load(config) { this.config = config; if (options.failFirstLoad && workers.length === 1) throw new Error('load failed'); }
    terminate() { this.terminated = true; this.files.clear(); }
    async writeFile(name, data) { this.files.set(name, data); }
    async deleteFile(name) { this.files.delete(name); }
    async exec(args) { if (args.at(-1) !== '-') this.files.set(args.at(-1), new Uint8Array([1])); return this.exitCode; }
    async readFile(name) { if (this.readFailure) throw new Error('read failed'); return this.files.get(name); }
  }
  const pipeline = new BrowserFfmpeg({ loadDependencies: async () => ({
    FFmpeg: FakeFFmpeg,
    fetchFile: async () => new Uint8Array([1]),
    toBlobURL: async (source) => { sources.push(source); const url = URL.createObjectURL(new Blob(['test'])); urls.push(url); return url; },
  }) });
  return { pipeline, workers, urls, sources };
}

test('BrowserFfmpeg resolves all core assets locally without requesting a CDN', async () => {
  const { pipeline, workers, sources } = await createPipeline();
  await loadPipeline(pipeline);
  assert.equal(sources.length, 0);
  for (const source of [workers[0].config.coreURL, workers[0].config.wasmURL]) {
    const url = new URL(source);
    assert.equal(url.protocol, 'file:');
    assert.match(url.pathname, /\/vendor\/ffmpeg\/core\/ffmpeg-core\.(js|wasm)$/);
  }
  assert.equal(workers[0].config.classWorkerURL, new URL('../vendor/ffmpeg-worker.js', import.meta.url).href);
});

async function loadPipeline(pipeline) {
  const previous = globalThis.location;
  globalThis.location = { href: 'http://localhost/index.html' };
  try { await pipeline.load(); } finally { globalThis.location = previous; }
}

test('BrowserFfmpeg loads on demand and retries a failed worker without creating blobs', async () => {
  const { pipeline, workers, urls } = await createPipeline({ failFirstLoad: true });
  assert.equal(workers.length, 0);
  await assert.rejects(loadPipeline(pipeline), /load failed/);
  assert.equal(pipeline.loaded, false);
  assert.equal(workers[0].terminated, true);
  await loadPipeline(pipeline);
  assert.equal(pipeline.loaded, true);
  assert.equal(workers.length, 2);
  assert.deepEqual(urls, []);
});

test('BrowserFfmpeg termination resets the worker and permits reload', async () => {
  const { pipeline, workers } = await createPipeline();
  await loadPipeline(pipeline);
  pipeline.terminate();
  assert.equal(workers[0].terminated, true);
  assert.equal(pipeline.loaded, false);
  await loadPipeline(pipeline);
  assert.equal(workers.length, 2);
  assert.equal(pipeline.loaded, true);
});

test('BrowserFfmpeg cleanup removes inputs across extensions, audio, and logs', async () => {
  const { pipeline, workers } = await createPipeline();
  await loadPipeline(pipeline);
  await pipeline.writeInput({ name: 'movie.mp4' });
  await pipeline.writeInput({ name: 'movie.webm' });
  await pipeline.extractAudio({ inputName: 'input.webm' });
  workers[0].listeners.log({ message: 'diagnostic' });
  await pipeline.cleanup();
  assert.equal(workers[0].files.size, 0);
  assert.deepEqual(pipeline.logs, []);
  assert.equal(pipeline.loaded, true);
});

for (const operation of ['extractAudio', 'detectSilence', 'splitAudio']) {
  test(`BrowserFfmpeg ${operation} rejects a nonzero FFmpeg exit code`, async () => {
    const { pipeline, workers } = await createPipeline();
    await loadPipeline(pipeline);
    workers[0].exitCode = 7;
    const args = { inputName: 'input.mp4', audioName: 'audio.mp3', noiseDb: -30, silenceDuration: 1,
      chunks: [{ index: 0, extractStart: 0, extractEnd: 1, start: 0, end: 1 }] };
    await assert.rejects(operation === 'splitAudio' ? pipeline.splitAudio(args).next() : pipeline[operation](args), /FFmpeg.*7/);
    await pipeline.cleanup();
    assert.equal(workers[0].files.size, 0);
  });
}

test('BrowserFfmpeg deletes chunks after reading and after read failure', async () => {
  const { pipeline, workers } = await createPipeline();
  await loadPipeline(pipeline);
  const args = { audioName: 'audio.mp3', chunks: [{ index: 0, extractStart: 0, extractEnd: 1, start: 0, end: 1 }] };
  const result = await pipeline.splitAudio(args).next();
  assert.equal(result.value.audioBlob.size, 1);
  assert.equal(workers[0].files.size, 0);
  workers[0].readFailure = true;
  await assert.rejects(pipeline.splitAudio(args).next(), /read failed/);
  assert.equal(workers[0].files.size, 0);
});

test('BrowserFfmpeg cancellation while dependencies load cannot revive the old worker', async () => {
  const { pipeline, workers } = await createPipeline();
  const loader = pipeline.loadDependencies;
  let resume;
  pipeline.loadDependencies = async () => {
    await new Promise((resolve) => { resume = resolve; });
    return loader();
  };
  const pending = loadPipeline(pipeline);
  pipeline.terminate();
  resume();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(pipeline.loaded, false);
  assert.equal(workers.length, 0);
  pipeline.loadDependencies = loader;
  await loadPipeline(pipeline);
  assert.equal(pipeline.loaded, true);
});
