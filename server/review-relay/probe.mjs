import { pathToFileURL } from 'node:url';

const TRANSLATION_DEFAULT = 'gpt-6-luna';
const MODELS = ['whisper-1', 'gpt-transcribe', 'gpt-4o-transcribe-diarize'];
const ERR = 'Review relay model-access probe failed';
const MAX_RESPONSE = 4096;

export function probeConfig(env) {
  let origin;
  try {
    const url = new URL(env.REVIEW_RELAY_ORIGIN || '');
    if (url.protocol !== 'https:' || url.port || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash || !url.hostname.includes('.')) throw new Error();
    origin = url.origin;
  } catch {
    throw new Error('Set REVIEW_RELAY_ORIGIN to the deployed HTTPS origin');
  }
  const code = env.REVIEW_ACCESS_CODE || '';
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(code) || code.startsWith('sk-')
      || /change|example|placeholder/i.test(code)) {
    throw new Error('Set the separate review access code in REVIEW_ACCESS_CODE');
  }
  const translation = env.REVIEW_PROBE_TRANSLATION_MODEL || TRANSLATION_DEFAULT;
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(translation)) throw new Error('Invalid translation model name');
  return { origin, code, models: [...new Set([...MODELS, translation])] };
}

async function boundedJson(response) {
  if (!response.body) throw new Error(ERR);
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE) throw new Error(ERR);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function probeReviewRelay(env, fetchImpl = globalThis.fetch) {
  const { origin, code, models } = probeConfig(env);
  async function request(model, authenticated) {
    try {
      const response = await fetchImpl(origin + '/v1/models/' + encodeURIComponent(model).replace(/%3A/g, ':'), {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        headers: authenticated ? { authorization: 'Bearer ' + code, accept: 'application/json' }
          : { accept: 'application/json' },
      });
      if (!authenticated) {
        if (response.body) await response.body.cancel().catch(() => {});
        if (response.status !== 401) throw new Error(ERR);
        return;
      }
      if (response.status !== 200) {
        if (response.body) await response.body.cancel().catch(() => {});
        throw new Error(ERR);
      }
      const body = await boundedJson(response);
      if (body?.id !== model || body?.object !== 'model') throw new Error(ERR);
    } catch {
      // Never print response bodies, request URLs, headers, credentials or underlying errors.
      throw new Error(ERR + ': ' + (authenticated ? 'model lookup' : 'unauthenticated request rejection'));
    }
  }
  await request(models[0], false);
  for (const model of models) await request(model, true);
  return { unauthorizedRejected: true, modelLookups: models.length,
    actualTranscription: false, actualTranslation: false, actualRealtime: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await probeReviewRelay(process.env);
    console.log('Unauthorized request rejected; model lookups verified: ' + result.modelLookups);
    console.log('Model metadata only. File transcription, translation, realtime and review quota remain unverified.');
  } catch (error) {
    // All errors generated above are fixed strings, but guard unexpected runtime errors too.
    const message = typeof error?.message === 'string' && [
      'Set REVIEW_RELAY_ORIGIN to the deployed HTTPS origin',
      'Set the separate review access code in REVIEW_ACCESS_CODE',
      'Invalid translation model name',
      ERR + ': model lookup', ERR + ': unauthenticated request rejection',
    ].includes(error.message) ? error.message : ERR;
    console.error(message);
    process.exitCode = 1;
  }
}
