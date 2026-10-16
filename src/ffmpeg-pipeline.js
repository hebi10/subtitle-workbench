import { parseSilenceLog } from './core.js';
import { resolveClassWorkerURL } from './ffmpeg-config.js';

const FFMPEG_CORE_BASE_URL = new URL('../vendor/ffmpeg/core/', import.meta.url);

async function loadDependencies() {
  const [{ FFmpeg }, { fetchFile }] = await Promise.all([
    import('../vendor/ffmpeg/ffmpeg/index.js'),
    import('../vendor/ffmpeg/util/index.js'),
  ]);
  return { FFmpeg, fetchFile };
}

export class BrowserFfmpeg {
  constructor({ onLog, onProgress, loadDependencies: dependencyLoader = loadDependencies } = {}) {
    this.ffmpeg = null;
    this.loadDependencies = dependencyLoader;
    this.files = new Set();
    this.generation = 0;
    this.loaded = false;
    this.logs = [];
    this.onLog = onLog;
    this.onProgress = onProgress;
  }

  async load() {
    if (this.loaded) {
      return;
    }

    const generation = this.generation;
    const checkActive = () => {
      if (generation !== this.generation) throw new DOMException('FFmpeg loading cancelled', 'AbortError');
    };
    try {
      const { FFmpeg, fetchFile } = await this.loadDependencies();
      checkActive();
      const worker = new FFmpeg();
      this.ffmpeg = worker;
      this.fetchFile = fetchFile;
      worker.on('log', ({ message }) => {
        if (generation !== this.generation) return;
        this.logs.push(message);
        this.onLog?.(message);
      });
      worker.on('progress', ({ progress, time }) => {
        if (generation === this.generation) this.onProgress?.({ progress, time });
      });
      const coreURL = new URL('ffmpeg-core.js', FFMPEG_CORE_BASE_URL).href;
      const wasmURL = new URL('ffmpeg-core.wasm', FFMPEG_CORE_BASE_URL).href;
      await worker.load({ classWorkerURL: resolveClassWorkerURL(), coreURL, wasmURL });
      checkActive();
      this.loaded = true;
    } catch (error) {
      if (generation === this.generation) this.terminate();
      throw error;
    }
  }

  terminate() {
    this.generation += 1;
    const worker = this.ffmpeg;
    this.ffmpeg = null;
    this.loaded = false;
    this.files.clear();
    this.logs.length = 0;
    worker?.terminate();
  }

  async cleanup() {
    for (const name of this.files) await this.safeDelete(name);
    this.logs.length = 0;
  }

  async exec(args) {
    const exitCode = await this.ffmpeg.exec(args);
    if (exitCode !== 0) throw new Error(`FFmpeg failed (exit code ${exitCode}).`);
  }

  async writeInput(file) {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'mp4';
    const inputName = `input.${extension.replace(/[^a-z0-9]/g, '') || 'mp4'}`;
    await this.safeDelete(inputName);
    this.files.add(inputName);
    await this.ffmpeg.writeFile(inputName, await this.fetchFile(file));
    return inputName;
  }

  async extractAudio({ inputName, outputName = 'audio.mp3', bitrate = '48k' }) {
    await this.safeDelete(outputName);
    this.files.add(outputName);
    await this.exec([
      '-i',
      inputName,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      bitrate,
      outputName,
    ]);
    return outputName;
  }

  async detectSilence({ audioName, noiseDb, silenceDuration }) {
    const logStart = this.logs.length;
    await this.exec([
      '-i',
      audioName,
      '-af',
      `silencedetect=n=${noiseDb}dB:d=${silenceDuration}`,
      '-f',
      'null',
      '-',
    ]);

    return parseSilenceLog(this.logs.slice(logStart).join('\n'));
  }

  async *splitAudio({ audioName, chunks, bitrate = '48k' }) {
    for (const chunk of chunks) {
      const outputName = `chunk-${chunk.index}.mp3`;
      const duration = Math.max(0.1, chunk.extractEnd - chunk.extractStart);

      await this.safeDelete(outputName);
      this.files.add(outputName);
      let data;
      try {
        await this.exec([
          '-ss',
          secondsArg(chunk.extractStart),
          '-t',
          secondsArg(duration),
          '-i',
          audioName,
          '-ac',
          '1',
          '-ar',
          '16000',
          '-b:a',
          bitrate,
          outputName,
        ]);

        data = await this.ffmpeg.readFile(outputName);
      } finally {
        await this.safeDelete(outputName);
      }

      yield {
        ...chunk,
        startTime: chunk.extractStart,
        coreStartTime: chunk.start,
        coreEndTime: chunk.end,
        audioBlob: new Blob([data], { type: 'audio/mpeg' }),
        fileName: outputName,
      };
    }
  }

  async safeDelete(name) {
    try {
      await this.ffmpeg?.deleteFile(name);
      this.files.delete(name);
    } catch {
      // ffmpeg.wasm throws when the file does not exist; that is harmless cleanup.
    }
  }
}

function secondsArg(seconds) {
  return Number(seconds).toFixed(3);
}
