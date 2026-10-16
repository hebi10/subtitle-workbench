import { BrowserFfmpeg } from '../src/ffmpeg-pipeline.js';

const result = document.querySelector('#result');
const button = document.querySelector('#run');
button.addEventListener('click', async () => {
  button.disabled = true;
  const processor = new BrowserFfmpeg();
  const timeout = setTimeout(() => processor.terminate(), 30000);
  try {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Local test only');
    result.textContent = '자체 호스팅 엔진 로드 중';
    await processor.load();
    const buffer = new ArrayBuffer(44 + 16000 * 2);
    const view = new DataView(buffer);
    const write = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE');
    write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, 32000, true);
    const inputName = await processor.writeInput(new File([buffer], 'fixture.wav', { type: 'audio/wav' }));
    const audioName = await processor.extractAudio({ inputName });
    const silence = await processor.detectSilence({ audioName, noiseDb: -35, silenceDuration: 0.2 });
    if (!silence.length) throw new Error('Expected silence detection from real engine');
    const bytes = await processor.ffmpeg.readFile(audioName);
    if (bytes.length < 100) throw new Error('Encoded MP3 missing');
    result.textContent = JSON.stringify({ passed: true, outputBytes: bytes.length, silence,
      note: 'Real local WASM/worker/audio processing; no model API request.' }, null, 2);
  } catch (error) {
    result.textContent = JSON.stringify({ passed: false, error: error.message }, null, 2);
  } finally {
    clearTimeout(timeout);
    await processor.cleanup();
    processor.terminate();
    button.disabled = false;
  }
});
