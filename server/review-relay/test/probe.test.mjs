import test from 'node:test';
import assert from 'node:assert/strict';
import { probeConfig, probeReviewRelay } from '../probe.mjs';

const env = { REVIEW_RELAY_ORIGIN: 'https://review.example.org', REVIEW_ACCESS_CODE: 'A'.repeat(43) };
const response = (status, body) => new Response(JSON.stringify(body), { status });

test('probe validates TLS origin and dedicated code without exposing values', () => {
  for (const origin of ['http://review.example.org', 'https://review.example.org:8443',
    'https://review.example.org/path', 'https://review.example.org/?x=y', 'https://a@review.example.org']) {
    assert.throws(() => probeConfig({ ...env, REVIEW_RELAY_ORIGIN: origin }), /HTTPS origin/);
  }
  assert.throws(() => probeConfig({ ...env, REVIEW_ACCESS_CODE: 'sk-' + 'B'.repeat(43) }), /separate review access code/);
});

test('probe uses metadata only, refuses redirects and never authenticates the first request', async () => {
  const calls = [];
  const result = await probeReviewRelay(env, async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    if (!options.headers.authorization) return response(401, {});
    assert.equal(options.headers.authorization, 'Bearer ' + env.REVIEW_ACCESS_CODE);
    return response(200, { id: decodeURIComponent(url.split('/').at(-1)), object: 'model' });
  });
  assert.deepEqual(result, { unauthorizedRejected: true, modelLookups: 4,
    actualTranscription: false, actualTranslation: false, actualRealtime: false });
  assert.equal(calls.length, 5);
  assert.equal(calls[0].options.headers.authorization, undefined);
  assert.ok(calls.every(call => call.url.startsWith(env.REVIEW_RELAY_ORIGIN + '/v1/models/')));
});

test('probe fails closed on unexpected auth, redirect, bad metadata, rate limits and network errors', async () => {
  await assert.rejects(probeReviewRelay(env, async () => response(200, {})), /unauthenticated request rejection/);
  for (const fake of [
    async () => response(302, {}),
    async () => response(429, {}),
    async () => response(200, { id: 'wrong', object: 'model' }),
    async () => response(200, { id: 'whisper-1', object: 'model', excess: 'x'.repeat(5000) }),
    async () => { throw new Error(env.REVIEW_ACCESS_CODE); },
  ]) {
    let calls = 0;
    await assert.rejects(probeReviewRelay(env, async () => ++calls === 1 ? response(401, {}) : fake()),
      error => /model lookup/.test(error.message) && !error.message.includes(env.REVIEW_ACCESS_CODE));
  }
});
