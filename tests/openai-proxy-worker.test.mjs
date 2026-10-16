import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleProxyRequest } from '../worker/openai-proxy-worker.js';

const ALLOWED_ORIGIN = 'https://app.example';
const DEFAULT_ENV = {
  ALLOWED_ORIGINS: `${ALLOWED_ORIGIN}, https://preview.example`,
};

function createRequest(path, {
  method = 'POST',
  origin = ALLOWED_ORIGIN,
  authorization = 'Bearer user-secret-key',
  contentType = 'application/json',
  contentLength = null,
  body = '{}',
} = {}) {
  const headers = new Headers();
  if (origin !== null) {
    headers.set('Origin', origin);
  }
  if (authorization !== null) {
    headers.set('Authorization', authorization);
  }
  if (contentType !== null) {
    headers.set('Content-Type', contentType);
  }
  if (contentLength !== null) {
    headers.set('Content-Length', contentLength);
  }

  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD' && body !== null) {
    init.body = body;
    if (body instanceof ReadableStream) {
      init.duplex = 'half';
    }
  }

  return new Request(`https://proxy.example${path}`, init);
}

function createObservedBodyStream(chunks) {
  const observations = {
    enqueuedChunks: 0,
    cancelCalls: 0,
  };
  let nextChunk = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (nextChunk >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[nextChunk]);
      nextChunk += 1;
      observations.enqueuedChunks += 1;
    },
    cancel() {
      observations.cancelCalls += 1;
    },
  }, { highWaterMark: 0 });

  return { stream, observations };
}

function corsAssertions(response, origin = ALLOWED_ORIGIN) {
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Vary'), 'Origin');
}

function successfulFetch(body = '{"ok":true}', init = {}) {
  return async () => new Response(body, {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: {
      'Content-Type': init.contentType ?? 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

test('missing and disallowed origins are rejected without permissive CORS', async (t) => {
  for (const [name, origin] of [
    ['missing', null],
    ['unlisted', 'https://attacker.example'],
    ['substring', 'https://app.example.attacker.example'],
  ]) {
    await t.test(name, async () => {
      let upstreamCalls = 0;
      const response = await handleProxyRequest(
        createRequest('/responses', { origin }),
        DEFAULT_ENV,
        {
          fetchImpl: async () => {
            upstreamCalls += 1;
            return new Response();
          },
        },
      );

      assert.equal(response.status, 403);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
      assert.equal(response.headers.get('Vary'), 'Origin');
      assert.equal(upstreamCalls, 0);
    });
  }
});

test('comma-separated allowed origins are trimmed and matched exactly', async () => {
  const response = await handleProxyRequest(
    createRequest('/responses', { origin: 'https://preview.example' }),
    DEFAULT_ENV,
    { fetchImpl: successfulFetch() },
  );

  assert.equal(response.status, 200);
  corsAssertions(response, 'https://preview.example');
});

test('only exact allowed paths are accepted', async (t) => {
  const rejectedPaths = [
    '/models',
    '/responses/',
    '/responses/extra',
    '/prefix/responses',
    '/responses-suffix',
    '/%72esponses',
    '/responses%2fextra',
    '/audio/transcriptions/',
    '/audio%2ftranscriptions',
  ];

  for (const path of rejectedPaths) {
    await t.test(path, async () => {
      let upstreamCalls = 0;
      const response = await handleProxyRequest(
        createRequest(path),
        DEFAULT_ENV,
        {
          fetchImpl: async () => {
            upstreamCalls += 1;
            return new Response();
          },
        },
      );

      assert.equal(response.status, 404);
      corsAssertions(response);
      assert.equal(upstreamCalls, 0);
    });
  }
});

test('allowed-route OPTIONS returns a credential-free restricted preflight', async () => {
  let upstreamCalls = 0;
  const response = await handleProxyRequest(
    createRequest('/responses', {
      method: 'OPTIONS',
      authorization: null,
      contentType: null,
      body: null,
    }),
    DEFAULT_ENV,
    {
      fetchImpl: async () => {
        upstreamCalls += 1;
        return new Response();
      },
    },
  );

  assert.equal(response.status, 204);
  corsAssertions(response);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), 'Authorization, Content-Type');
  assert.equal(upstreamCalls, 0);
});

test('non-POST methods are rejected after route validation', async (t) => {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    await t.test(method, async () => {
      const response = await handleProxyRequest(
        createRequest('/responses', { method, authorization: null, contentType: null }),
        DEFAULT_ENV,
        { fetchImpl: successfulFetch() },
      );

      assert.equal(response.status, 405);
      corsAssertions(response);
    });
  }
});

test('missing or malformed Bearer credentials are rejected', async (t) => {
  for (const [name, authorization] of [
    ['missing', null],
    ['Basic', 'Basic dXNlcjpwYXNz'],
    ['empty Bearer', 'Bearer'],
    ['whitespace-only Bearer', 'Bearer     '],
    ['token containing whitespace', 'Bearer token with-space'],
  ]) {
    await t.test(name, async () => {
      let upstreamCalls = 0;
      const response = await handleProxyRequest(
        createRequest('/responses', { authorization }),
        DEFAULT_ENV,
        {
          fetchImpl: async () => {
            upstreamCalls += 1;
            return new Response();
          },
        },
      );

      assert.equal(response.status, 401);
      corsAssertions(response);
      assert.equal(upstreamCalls, 0);
    });
  }
});

test('/responses accepts only application/json media type', async (t) => {
  for (const contentType of ['text/plain', 'application/problem+json', 'multipart/form-data']) {
    await t.test(contentType, async () => {
      const response = await handleProxyRequest(
        createRequest('/responses', { contentType }),
        DEFAULT_ENV,
        { fetchImpl: successfulFetch() },
      );

      assert.equal(response.status, 415);
      corsAssertions(response);
    });
  }
});

test('/responses normalizes Content-Type parameters before validation', async () => {
  const response = await handleProxyRequest(
    createRequest('/responses', { contentType: 'Application/JSON; Charset=UTF-8' }),
    DEFAULT_ENV,
    { fetchImpl: successfulFetch() },
  );

  assert.equal(response.status, 200);
});

test('/audio/transcriptions accepts only multipart/form-data media type', async (t) => {
  for (const contentType of ['application/json', 'audio/mpeg', 'text/plain']) {
    await t.test(contentType, async () => {
      const response = await handleProxyRequest(
        createRequest('/audio/transcriptions', { contentType }),
        DEFAULT_ENV,
        { fetchImpl: successfulFetch() },
      );

      assert.equal(response.status, 415);
      corsAssertions(response);
    });
  }
});

test('/audio/transcriptions normalizes multipart Content-Type parameters', async () => {
  const response = await handleProxyRequest(
    createRequest('/audio/transcriptions', {
      contentType: 'Multipart/Form-Data; boundary=example',
      body: new Uint8Array([1, 2, 3]),
    }),
    DEFAULT_ENV,
    { fetchImpl: successfulFetch() },
  );

  assert.equal(response.status, 200);
});

test('actual buffered body bytes enforce the configured inclusive limit', async () => {
  let upstreamCalls = 0;
  const atLimit = await handleProxyRequest(
    createRequest('/responses', {
      body: new Uint8Array([1, 2, 3, 4]),
    }),
    { ...DEFAULT_ENV, MAX_REQUEST_BYTES: '4' },
    {
      fetchImpl: async () => {
        upstreamCalls += 1;
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      },
    },
  );
  const overLimit = await handleProxyRequest(
    createRequest('/responses', {
      body: new Uint8Array([1, 2, 3, 4, 5]),
    }),
    { ...DEFAULT_ENV, MAX_REQUEST_BYTES: '4' },
    {
      fetchImpl: async () => {
        upstreamCalls += 1;
        return new Response('{}');
      },
    },
  );

  assert.equal(atLimit.status, 200);
  assert.equal(overLimit.status, 413);
  assert.equal(upstreamCalls, 1);
});

test('a chunked body is cancelled on the first byte over limit without reading later chunks', async () => {
  const { stream, observations } = createObservedBodyStream([
    new Uint8Array([1, 2, 3, 4]),
    new Uint8Array([5]),
    new Uint8Array([6, 7, 8]),
  ]);
  let upstreamCalls = 0;

  const response = await handleProxyRequest(
    createRequest('/responses', { body: stream }),
    { ...DEFAULT_ENV, MAX_REQUEST_BYTES: '4' },
    {
      fetchImpl: async () => {
        upstreamCalls += 1;
        return new Response('{}');
      },
    },
  );

  assert.equal(response.status, 413);
  assert.equal(observations.enqueuedChunks, 2);
  assert.equal(observations.cancelCalls, 1);
  assert.equal(upstreamCalls, 0);
});

test('an oversized Content-Length is rejected before rate limiting or body consumption', async () => {
  const { stream, observations } = createObservedBodyStream([
    new Uint8Array([1]),
  ]);
  let limiterCalls = 0;

  const response = await handleProxyRequest(
    createRequest('/responses', {
      contentLength: '5',
      body: stream,
    }),
    {
      ...DEFAULT_ENV,
      MAX_REQUEST_BYTES: '4',
      RATE_LIMITER: {
        async limit() {
          limiterCalls += 1;
          return { success: true };
        },
      },
    },
    { fetchImpl: successfulFetch() },
  );

  assert.equal(response.status, 413);
  assert.equal(limiterCalls, 0);
  assert.equal(observations.enqueuedChunks, 0);
});

test('a limiter denial does not consume the request body', async () => {
  const { stream, observations } = createObservedBodyStream([
    new Uint8Array([1, 2, 3]),
  ]);
  let upstreamCalls = 0;

  const response = await handleProxyRequest(
    createRequest('/responses', { body: stream }),
    {
      ...DEFAULT_ENV,
      RATE_LIMITER: {
        async limit() {
          return { success: false };
        },
      },
    },
    {
      fetchImpl: async () => {
        upstreamCalls += 1;
        return new Response();
      },
    },
  );

  assert.equal(response.status, 429);
  assert.equal(observations.enqueuedChunks, 0);
  assert.equal(upstreamCalls, 0);
});

test('smaller and invalid Content-Length values cannot bypass streamed-byte enforcement', async (t) => {
  for (const contentLength of ['1', 'invalid']) {
    await t.test(contentLength, async () => {
      const { stream, observations } = createObservedBodyStream([
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5]),
        new Uint8Array([6]),
      ]);

      const response = await handleProxyRequest(
        createRequest('/responses', { contentLength, body: stream }),
        { ...DEFAULT_ENV, MAX_REQUEST_BYTES: '4' },
        { fetchImpl: successfulFetch() },
      );

      assert.equal(response.status, 413);
      assert.equal(observations.enqueuedChunks, 2);
      assert.equal(observations.cancelCalls, 1);
    });
  }
});

test('invalid non-positive maximum sizes fall back to the exact 26214400-byte limit', async (t) => {
  const bytes = new Uint8Array(26214401);

  for (const value of ['invalid', '0', '-1']) {
    await t.test(value, async () => {
      let upstreamCalls = 0;
      const atLimit = await handleProxyRequest(
        createRequest('/responses', {
          body: bytes.subarray(0, 26214400),
        }),
        { ...DEFAULT_ENV, MAX_REQUEST_BYTES: value },
        {
          fetchImpl: async () => {
            upstreamCalls += 1;
            return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
          },
        },
      );
      const overLimit = await handleProxyRequest(
        createRequest('/responses', {
          body: bytes,
        }),
        { ...DEFAULT_ENV, MAX_REQUEST_BYTES: value },
        {
          fetchImpl: async () => {
            upstreamCalls += 1;
            return new Response('{}');
          },
        },
      );

      assert.equal(atLimit.status, 200);
      assert.equal(overLimit.status, 413);
      assert.equal(upstreamCalls, 1);
    });
  }
});

test('the optional limiter uses the exact allowed origin as its key', async () => {
  const received = [];
  const response = await handleProxyRequest(
    createRequest('/responses'),
    {
      ...DEFAULT_ENV,
      RATE_LIMITER: {
        async limit(input) {
          received.push(input);
          return { success: true };
        },
      },
    },
    { fetchImpl: successfulFetch() },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(received, [{ key: ALLOWED_ORIGIN }]);
});

test('a limiter denial returns 429 without contacting upstream', async () => {
  let upstreamCalls = 0;
  const response = await handleProxyRequest(
    createRequest('/responses'),
    {
      ...DEFAULT_ENV,
      RATE_LIMITER: {
        async limit() {
          return { success: false };
        },
      },
    },
    {
      fetchImpl: async () => {
        upstreamCalls += 1;
        return new Response();
      },
    },
  );

  assert.equal(response.status, 429);
  corsAssertions(response);
  assert.equal(upstreamCalls, 0);
});

test('upstream URLs use exact allowed routes and discard source queries', async (t) => {
  for (const [requestPath, expectedUrl, contentType] of [
    [
      '/responses?api-version=attacker&x=1',
      'https://api.openai.com/v1/responses',
      'application/json',
    ],
    [
      '/audio/transcriptions?redirect=/models',
      'https://api.openai.com/v1/audio/transcriptions',
      'multipart/form-data; boundary=example',
    ],
  ]) {
    await t.test(requestPath, async () => {
      let receivedUrl;
      const response = await handleProxyRequest(
        createRequest(requestPath, { contentType }),
        DEFAULT_ENV,
        {
          fetchImpl: async (url) => {
            receivedUrl = String(url);
            return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
          },
        },
      );

      assert.equal(response.status, 200);
      assert.equal(receivedUrl, expectedUrl);
    });
  }
});

test('upstream receives only the original Authorization and Content-Type headers', async () => {
  const request = createRequest('/responses');
  request.headers.set('X-Forwarded-For', '203.0.113.9');
  request.headers.set('Cookie', 'session=secret');
  request.headers.set('X-Custom', 'should-not-pass');
  let receivedHeaders;

  const response = await handleProxyRequest(
    request,
    DEFAULT_ENV,
    {
      fetchImpl: async (_url, init) => {
        receivedHeaders = [...init.headers.entries()];
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(receivedHeaders, [
    ['authorization', 'Bearer user-secret-key'],
    ['content-type', 'application/json'],
  ]);
});

test('upstream receives the exact buffered request body bytes', async () => {
  const expected = new Uint8Array([0, 255, 17, 32, 128]);
  let received;

  const response = await handleProxyRequest(
    createRequest('/audio/transcriptions', {
      contentType: 'multipart/form-data; boundary=example',
      body: expected,
    }),
    DEFAULT_ENV,
    {
      fetchImpl: async (_url, init) => {
        received = new Uint8Array(init.body);
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(received, expected);
});

test('upstream success and failure preserve status, body, safe Content-Type, and CORS only', async (t) => {
  for (const fixture of [
    { name: 'success', status: 201, body: '{"id":"response"}', contentType: 'application/json' },
    { name: 'failure', status: 400, body: '{"error":"bad request"}', contentType: 'application/problem+json' },
  ]) {
    await t.test(fixture.name, async () => {
      const response = await handleProxyRequest(
        createRequest('/responses'),
        DEFAULT_ENV,
        {
          fetchImpl: successfulFetch(fixture.body, {
            status: fixture.status,
            contentType: fixture.contentType,
            headers: {
              'Set-Cookie': 'upstream=secret',
              'X-Request-Id': 'req_secret',
              'X-RateLimit-Remaining-Requests': '99',
            },
          }),
        },
      );

      assert.equal(response.status, fixture.status);
      assert.equal(await response.text(), fixture.body);
      assert.equal(response.headers.get('Content-Type'), fixture.contentType);
      assert.equal(response.headers.get('Set-Cookie'), null);
      assert.equal(response.headers.get('X-Request-Id'), null);
      assert.equal(response.headers.get('X-RateLimit-Remaining-Requests'), null);
      corsAssertions(response);
    });
  }
});

test('upstream timeout returns a generic 504 without leaking request or exception details', async () => {
  const secretBody = 'private-body-value';
  const response = await handleProxyRequest(
    createRequest('/responses', { body: secretBody }),
    DEFAULT_ENV,
    {
      timeoutMs: 5,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new Error('timeout exception with user-secret-key and private-body-value'));
        }, { once: true });
      }),
    },
  );
  const text = await response.text();

  assert.equal(response.status, 504);
  assert.equal(response.headers.get('Content-Type'), 'application/json');
  corsAssertions(response);
  assert.deepEqual(JSON.parse(text), { error: 'Upstream request timed out.' });
  assert.equal(text.includes('user-secret-key'), false);
  assert.equal(text.includes(secretBody), false);
  assert.equal(text.includes('timeout exception'), false);
});

test('upstream timeout includes complete response-body consumption', async () => {
  const response = await handleProxyRequest(
    createRequest('/responses', { body: 'private-body-value' }),
    DEFAULT_ENV,
    {
      timeoutMs: 5,
      fetchImpl: async (_url, init) => new Response(
        new ReadableStream({
          start(controller) {
            init.signal.addEventListener('abort', () => {
              controller.error(
                new Error('stalled response with user-secret-key and private-body-value'),
              );
            }, { once: true });
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    },
  );

  assert.equal(response.status, 504);
  const text = await response.text();
  assert.equal(response.headers.get('Content-Type'), 'application/json');
  corsAssertions(response);
  assert.deepEqual(JSON.parse(text), { error: 'Upstream request timed out.' });
  assert.equal(text.includes('user-secret-key'), false);
  assert.equal(text.includes('private-body-value'), false);
  assert.equal(text.includes('stalled response'), false);
});

test('upstream network exceptions return a generic 502 without secret details', async () => {
  const secretBody = 'private-body-value';
  const response = await handleProxyRequest(
    createRequest('/responses', { body: secretBody }),
    DEFAULT_ENV,
    {
      fetchImpl: async () => {
        throw new Error('network exception with user-secret-key and private-body-value');
      },
    },
  );
  const text = await response.text();

  assert.equal(response.status, 502);
  corsAssertions(response);
  assert.deepEqual(JSON.parse(text), { error: 'Upstream request failed.' });
  assert.equal(text.includes('user-secret-key'), false);
  assert.equal(text.includes(secretBody), false);
  assert.equal(text.includes('network exception'), false);
});

test('rate limiter exceptions return a generic 503 without secret details', async () => {
  let upstreamCalls = 0;
  const response = await handleProxyRequest(
    createRequest('/responses', { body: 'private-body-value' }),
    {
      ...DEFAULT_ENV,
      RATE_LIMITER: {
        async limit() {
          throw new Error('limiter exception with user-secret-key and private-body-value');
        },
      },
    },
    {
      fetchImpl: async () => {
        upstreamCalls += 1;
        return new Response();
      },
    },
  );
  const text = await response.text();

  assert.equal(response.status, 503);
  corsAssertions(response);
  assert.deepEqual(JSON.parse(text), { error: 'Rate limiter is unavailable.' });
  assert.equal(text.includes('user-secret-key'), false);
  assert.equal(text.includes('private-body-value'), false);
  assert.equal(text.includes('limiter exception'), false);
  assert.equal(upstreamCalls, 0);
});
