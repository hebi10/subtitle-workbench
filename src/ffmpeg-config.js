export const FFMPEG_CLASS_WORKER_PATH = './vendor/ffmpeg-worker.js';

export function resolveClassWorkerURL(baseHref) {
  if (baseHref === undefined) return new URL('../vendor/ffmpeg-worker.js', import.meta.url).href;
  return new URL(FFMPEG_CLASS_WORKER_PATH, baseHref).href;
}
