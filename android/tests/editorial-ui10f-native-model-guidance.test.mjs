import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const dir = resolve(root, 'android/app/src/main/java/com/haebi/subtitle');
const source = async filename => readFile(resolve(dir, filename), 'utf8');

test('UI-10-F1 OS support and model-download readiness remain conditional', async () => {
  const java = await source('OnDeviceRecognitionActivity.java');
  for (const term of ['isOnDeviceRecognitionAvailable', 'createOnDeviceSpeechRecognizer', 'checkRecognitionSupport',
     "선택한 언어 모델은 아직 확인되지 않았으니", "Whisper/Vosk 파일을 다운로드하는 기능이 아닙니다"]) {
    assert.ok(java.includes(term), term);
  }
  assert.match(java, /Manifest\.permission\.RECORD_AUDIO/);
});

test('UI-10-F2 actual gpt-live-transcribe model, charging and five-minute limit', async () => {
  const [ui,protocol,client] = await Promise.all([source('CloudLiveRecognitionActivity.java'),
    source('RealtimeTranscriptionProtocol.java'), source('LiveTranscriptionClient.java')]);
  assert.match(protocol, /MODEL = "gpt-live-transcribe"/);
  assert.match(ui, /실제 모델 gpt-live-transcribe/);
  assert.match(ui, /서버 공유 한도가 적용/);
  assert.match(ui, /API 이용 요금이 본인 계정에 별도 청구/);
  assert.match(ui, /마이크 권한이 없어/);
  assert.match(client, /MAX_RECORDING_MS = 5L \* 60_000/);
});

test('UI-10-F3 Vosk model metadata, integrity, local processing and cancellation', async () => {
  const [ui,catalog,installer] = await Promise.all([source('OfflineVoskActivity.java'),
    source('OfflineModelCatalog.java'), source('OfflineModelInstaller.java')]);
  for (const text of ['약 87MB 다운로드', '약 42MB 다운로드', '약 50MB 다운로드'])
    assert.ok(catalog.includes(text));
  assert.match(ui, /model\.approximateMegabytes/);
  assert.match(ui, /SHA-256 검사를 통과한 설치 모델/);
  assert.match(ui, /중단'은 일시정지가 아니며/);
  assert.match(ui, /cancel\.setEnabled\(busy\)/);
  assert.match(ui, /installer\.installedModel/);
  assert.match(ui, /원본은 복사하지 않고/);
  assert.match(installer, /SHA-256|sha256/i);
});
