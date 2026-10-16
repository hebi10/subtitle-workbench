import assert from 'node:assert/strict';
import test from 'node:test';

import { formatSrt } from '../src/core.js';
import { extractResponseText, requestTranscription, translateSubtitles } from '../src/openai.js';

test('extractResponseText reads output_text from Responses API payloads', () => {
  assert.equal(extractResponseText({ output_text: '[{"id":0,"translated":"hello"}]' }), '[{"id":0,"translated":"hello"}]');
});

test('extractResponseText joins nested output message content', () => {
  const payload = {
    output: [
      {
        type: 'message',
        content: [
          { type: 'output_text', text: '[{"id":0,' },
          { type: 'output_text', text: '"translated":"good"}]' },
        ],
      },
    ],
  };

  assert.equal(extractResponseText(payload), '[{"id":0,"translated":"good"}]');
});

test('requestTranscription asks OpenAI for verbose segment and word timestamps', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(
      JSON.stringify({
        text: 'Hello everyone.',
        segments: [{ start: 2.1, end: 5.8, text: 'Hello everyone.' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    const transcription = await requestTranscription({
      audioBlob: new Blob(['audio'], { type: 'audio/mpeg' }),
      fileName: 'chunk-001.mp3',
      settings: {
        apiKey: 'test-key',
        apiBaseUrl: 'https://attacker.example',
        sttModel: 'whisper-1',
        sourceLanguage: 'en',
      },
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(requests[0].init.credentials, 'omit');
    assert.equal(requests[0].init.redirect, 'error');
    assert.equal(requests[0].init.referrerPolicy, 'no-referrer');
    assert.equal(requests[0].init.headers.get('Authorization'), 'Bearer test-key');
    assert.equal(requests[0].init.body.get('model'), 'whisper-1');
    assert.equal(requests[0].init.body.get('response_format'), 'verbose_json');
    assert.deepEqual(requests[0].init.body.getAll('timestamp_granularities[]'), ['segment', 'word']);
    assert.equal(requests[0].init.body.get('language'), 'en');
    assert.deepEqual(transcription.segments, [{ start: 2.1, end: 5.8, text: 'Hello everyone.' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Worker destination rejects plaintext and WordPress endpoints before transmitting credentials', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  try {
    for (const proxyUrl of ['http://worker.example', 'https://blogflow.kr/wp-json', 'https://www.blogflow.kr', 'https://user:pass@worker.example', 'https://worker.example/?key=private']) {
      await assert.rejects(requestTranscription({ audioBlob: new Blob(['test']), fileName: 'test.mp3',
        settings: { connectionMode: 'worker', apiKey: 'fixture-key', proxyUrl } }));
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('requestTranscription routes Worker requests through the trimmed proxy URL with the user key', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ text: '', segments: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await requestTranscription({
      audioBlob: new Blob(['audio'], { type: 'audio/mpeg' }),
      fileName: 'chunk-001.mp3',
      settings: {
        connectionMode: 'worker',
        proxyUrl: ' https://worker.example/ ',
        apiKey: 'sk-user',
        sttModel: 'whisper-1',
      },
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://worker.example/audio/transcriptions');
    assert.equal(requests[0].init.headers.get('Authorization'), 'Bearer sk-user');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('translateSubtitles sends original captions for Korean translation and returns translated captions with status', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify([
          { id: 0, translated: 'ko hello' },
          { id: 1, translated: 'ko important' },
        ]),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    const subtitles = await translateSubtitles({
      subtitles: [
        { start: 2.1, end: 5.8, original: 'Hello everyone.', translated: '' },
        { start: 630.5, end: 634.2, original: 'This is an important point.', translated: '' },
      ],
      settings: {
        apiKey: 'test-key',
        apiBaseUrl: 'https://api.openai.com/v1',
        targetLanguage: 'ko',
        translationModel: 'gpt-5.5',
        translationBatchSize: 30,
      },
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
    assert.equal(requests[0].init.headers.get('Authorization'), 'Bearer test-key');

    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.model, 'gpt-5.5');
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.name, 'subtitle_translations');
    assert.equal(body.text.format.strict, true);
    const input = JSON.parse(body.input);
    assert.equal(input.targetLanguage, 'ko');
    assert.deepEqual(input.subtitles, [
      { id: 0, text: 'Hello everyone.' },
      { id: 1, text: 'This is an important point.' },
    ]);

    assert.deepEqual(subtitles, [
      {
        start: 2.1,
        end: 5.8,
        original: 'Hello everyone.',
        translated: 'ko hello',
        status: 'translated',
      },
      {
        start: 630.5,
        end: 634.2,
        original: 'This is an important point.',
        translated: 'ko important',
        status: 'translated',
      },
    ]);

    assert.equal(
      formatSrt(subtitles),
      ['1', '00:00:02,100 --> 00:00:05,800', 'ko hello', '', '2', '00:10:30,500 --> 00:10:34,200', 'ko important', ''].join('\n'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('translateSubtitles routes Worker requests through the trimmed proxy URL with the user key', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify([{ id: 0, translated: '안녕하세요' }]),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    await translateSubtitles({
      subtitles: [{ start: 0, end: 1, original: 'Hello.', translated: '' }],
      settings: {
        connectionMode: 'worker',
        proxyUrl: ' https://worker.example/ ',
        apiKey: 'sk-user',
        targetLanguage: 'ko',
        translationModel: 'gpt-5.5',
        translationBatchSize: 30,
      },
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://worker.example/responses');
    assert.equal(requests[0].init.headers.get('Authorization'), 'Bearer sk-user');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requestTranscription redacts every exact user key occurrence from JSON API errors', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: 'Credential sk-user-secret was rejected; retrying sk-user-secret is unsafe.',
        },
      }),
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' },
      },
    );

  try {
    await assert.rejects(
      requestTranscription({
        audioBlob: new Blob(['audio'], { type: 'audio/mpeg' }),
        fileName: 'chunk-001.mp3',
        settings: {
          connectionMode: 'browser',
          apiKey: ' sk-user-secret ',
          sttModel: 'whisper-1',
        },
      }),
      (error) => {
        assert.match(error.message, /\[REDACTED\].*\[REDACTED\]/);
        assert.doesNotMatch(error.message, /sk-user-secret/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requestTranscription redacts the exact user key from plain-text API errors', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response('Credential sk-user-secret is invalid.', {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'Content-Type': 'text/plain' },
    });

  try {
    await assert.rejects(
      requestTranscription({
        audioBlob: new Blob(['audio'], { type: 'audio/mpeg' }),
        fileName: 'chunk-001.mp3',
        settings: {
          connectionMode: 'browser',
          apiKey: 'sk-user-secret',
          sttModel: 'whisper-1',
        },
      }),
      (error) => {
        assert.match(error.message, /\[REDACTED\]/);
        assert.doesNotMatch(error.message, /sk-user-secret/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requestTranscription redacts every exact trimmed user key occurrence from successful response parse errors', async () => {
  const originalFetch = globalThis.fetch;
  const apiKey = 'successful-response-secret';

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => {
      throw new Error(
        `Could not decode ${apiKey} twice: ${apiKey}; keep successful-response and another-secret.`,
      );
    },
  });

  try {
    let thrown;

    try {
      await requestTranscription({
        audioBlob: new Blob(['audio'], { type: 'audio/mpeg' }),
        fileName: 'chunk-001.mp3',
        settings: {
          connectionMode: 'browser',
          apiKey: ` ${apiKey} `,
          sttModel: 'whisper-1',
        },
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'successful response parsing must reject');
    assert.equal(
      thrown.message.split('[REDACTED]').length - 1,
      2,
      'both exact key occurrences must be redacted',
    );
    assert.equal(thrown.message.includes(apiKey), false, 'the exact key must not remain');
    assert.match(thrown.message, /successful-response/);
    assert.match(thrown.message, /another-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('translateSubtitles redacts response parse errors from failed subtitle results and serialization', async () => {
  const originalFetch = globalThis.fetch;
  const apiKey = 'translation-response-secret';

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => {
      throw new Error(`Decode failed for ${apiKey}; repeated ${apiKey}.`);
    },
  });

  try {
    const subtitles = await translateSubtitles({
      subtitles: [{ start: 0, end: 1, original: 'Hello.', translated: '' }],
      settings: {
        connectionMode: 'browser',
        apiKey: ` ${apiKey} `,
        targetLanguage: 'ko',
        translationModel: 'gpt-5.5',
        translationBatchSize: 30,
      },
    });

    assert.equal(subtitles[0].status, 'failed');
    assert.equal(subtitles[0].translationError.split('[REDACTED]').length - 1, 2);
    assert.equal(subtitles[0].translationError.includes(apiKey), false);
    const serialized = JSON.stringify(subtitles);
    assert.equal(serialized.includes(apiKey), false);
    assert.match(serialized, /\[REDACTED\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('translateSubtitles redacts malformed translation output parse errors from failed subtitle results', async () => {
  const originalFetch = globalThis.fetch;
  const apiKey = 'k9X';

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text: `prefix [${apiKey} ${apiKey}] suffix`,
    }),
  });

  try {
    const subtitles = await translateSubtitles({
      subtitles: [{ start: 0, end: 1, original: 'Hello.', translated: '' }],
      settings: {
        connectionMode: 'browser',
        apiKey,
        targetLanguage: 'ko',
        translationModel: 'gpt-5.5',
        translationBatchSize: 30,
      },
    });

    assert.equal(subtitles[0].status, 'failed');
    assert.equal(subtitles[0].translationError.includes(apiKey), false);
    assert.match(subtitles[0].translationError, /\[REDACTED\]/);
    const serialized = JSON.stringify(subtitles);
    assert.equal(serialized.includes(apiKey), false);
    assert.match(serialized, /\[REDACTED\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requestTranscription preserves AbortError from fetch', async () => {
  const originalFetch = globalThis.fetch;
  const abortError = new DOMException('The operation was aborted.', 'AbortError');

  globalThis.fetch = async () => {
    throw abortError;
  };

  try {
    await assert.rejects(
      requestTranscription({
        audioBlob: new Blob(['audio'], { type: 'audio/mpeg' }),
        fileName: 'chunk-001.mp3',
        settings: {
          connectionMode: 'browser',
          apiKey: 'abort-test-key',
          sttModel: 'whisper-1',
        },
      }),
      (error) => {
        assert.equal(error, abortError);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('translateSubtitles preserves AbortError from successful response parsing', async () => {
  const originalFetch = globalThis.fetch;
  const abortError = new DOMException('The operation was aborted.', 'AbortError');

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => {
      throw abortError;
    },
  });

  try {
    await assert.rejects(
      translateSubtitles({
        subtitles: [{ start: 0, end: 1, original: 'Hello.', translated: '' }],
        settings: {
          connectionMode: 'browser',
          apiKey: 'abort-test-key',
          targetLanguage: 'ko',
          translationModel: 'gpt-5.5',
          translationBatchSize: 30,
        },
      }),
      (error) => {
        assert.equal(error, abortError);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requestTranscription rejects an empty user key before fetch', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch should not be called');
  };

  try {
    await assert.rejects(
      requestTranscription({
        audioBlob: new Blob(['audio'], { type: 'audio/mpeg' }),
        fileName: 'chunk-001.mp3',
        settings: {
          connectionMode: 'browser',
          apiKey: '   ',
          sttModel: 'whisper-1',
        },
      }),
      { message: 'OpenAI API 키를 입력해 주세요.' },
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requestTranscription rejects an empty Worker URL before fetch', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch should not be called');
  };

  try {
    await assert.rejects(
      requestTranscription({
        audioBlob: new Blob(['audio'], { type: 'audio/mpeg' }),
        fileName: 'chunk-001.mp3',
        settings: {
          connectionMode: 'worker',
          proxyUrl: '   ',
          apiKey: 'sk-user',
          sttModel: 'whisper-1',
        },
      }),
      { message: 'Worker 프록시 URL을 입력해 주세요.' },
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('translateSubtitles falls back from batch to 5 items and then single items without stopping', async () => {
  const originalFetch = globalThis.fetch;
  const requestSizes = [];

  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const input = JSON.parse(body.input);
    requestSizes.push(input.subtitles.length);

    const hasBadSegment = input.subtitles.some((subtitle) => subtitle.text === 'bad segment');
    if (hasBadSegment) {
      return new Response(JSON.stringify({ output_text: 'invalid translation response' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        output_text: JSON.stringify(
          input.subtitles.map((subtitle) => ({
            id: subtitle.id,
            translated: `ko:${subtitle.text}`,
          })),
        ),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    const subtitles = await translateSubtitles({
      subtitles: [
        { start: 0, end: 1, original: 'one', translated: '' },
        { start: 1, end: 2, original: 'two', translated: '' },
        { start: 2, end: 3, original: 'bad segment', translated: '' },
        { start: 3, end: 4, original: 'four', translated: '' },
        { start: 4, end: 5, original: 'five', translated: '' },
        { start: 5, end: 6, original: 'six', translated: '' },
      ],
      settings: {
        apiKey: 'test-key',
        apiBaseUrl: 'https://api.openai.com/v1',
        targetLanguage: 'ko',
        translationModel: 'gpt-5.2',
        translationBatchSize: 6,
      },
    });

    assert.deepEqual(requestSizes, [6, 5, 1, 1, 1, 1, 1, 1]);
    assert.deepEqual(
      subtitles.map((subtitle) => subtitle.status),
      ['translated', 'translated', 'failed', 'translated', 'translated', 'translated'],
    );
    assert.equal(subtitles[2].translated, '[번역 실패]');
    assert.match(subtitles[2].translationError, /did not include translations/);
    assert.equal(subtitles[5].translated, 'ko:six');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('translateSubtitles retries only segments missing from a successful translation response', async () => {
  const originalFetch = globalThis.fetch;
  const requestedTexts = [];

  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const input = JSON.parse(body.input);
    requestedTexts.push(input.subtitles.map((subtitle) => subtitle.text));

    if (input.subtitles.length === 3) {
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify([
            { id: 0, translated: 'ko one' },
            { id: 2, translated: 'ko three' },
          ]),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        output_text: JSON.stringify([{ id: 0, translated: `retry:${input.subtitles[0].text}` }]),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    const subtitles = await translateSubtitles({
      subtitles: [
        { start: 0, end: 1, original: 'one', translated: '' },
        { start: 1, end: 2, original: 'two', translated: '' },
        { start: 2, end: 3, original: 'three', translated: '' },
      ],
      settings: {
        apiKey: 'test-key',
        apiBaseUrl: 'https://api.openai.com/v1',
        targetLanguage: 'ko',
        translationModel: 'gpt-5.2',
        translationBatchSize: 3,
      },
    });

    assert.deepEqual(requestedTexts, [['one', 'two', 'three'], ['two']]);
    assert.deepEqual(
      subtitles.map((subtitle) => subtitle.translated),
      ['ko one', 'retry:two', 'ko three'],
    );
    assert.deepEqual(
      subtitles.map((subtitle) => subtitle.status),
      ['translated', 'translated', 'translated'],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const status of [400, 401, 403]) {
  test(`translation HTTP ${status} rejects immediately without splitting batches`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return new Response('Rejected secret-key', { status });
    });
    await assert.rejects(translateSubtitles({
      subtitles: Array.from({ length: 30 }, () => ({ original: 'Hello' })),
      settings: { apiKey: 'secret-key' },
    }), (error) => {
      assert.equal(error.status, status);
      assert.equal(error.isApiError, true);
      assert.equal(error.retryable, false);
      assert.doesNotMatch(error.message, /secret-key/);
      return true;
    });
    assert.equal(calls, 1);
  });
}

for (const failure of ['rate-limit', 'server', 'network']) {
  test(`exhausted ${failure} retries preserve the batch and safe metadata`, async (t) => {
    const sizes = [];
    const delays = [];
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
      delays.push(delay);
      queueMicrotask(callback);
      return 0;
    });
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      sizes.push(JSON.parse(JSON.parse(init.body).input).subtitles.length);
      if (failure === 'network') throw new TypeError('network secret-key');
      return new Response('failed secret-key', {
        status: failure === 'rate-limit' ? 429 : 503,
        headers: failure === 'rate-limit' ? { 'Retry-After': '2' } : {},
      });
    });
    await assert.rejects(translateSubtitles({
      subtitles: Array.from({ length: 30 }, () => ({ original: 'Hello' })),
      settings: { apiKey: 'secret-key' },
    }), (error) => {
      assert.equal(error.isApiError, true);
      assert.equal(error.retryable, true);
      if (failure !== 'network') assert.equal(error.status, failure === 'rate-limit' ? 429 : 503);
      if (failure === 'rate-limit') assert.equal(error.retryAfterMs, 2000);
      assert.doesNotMatch(error.message, /secret-key/);
      return true;
    });
    assert.deepEqual(sizes, [30, 30, 30]);
    assert.deepEqual(delays, failure === 'rate-limit' ? [2000, 2000] : [500, 1000]);
  });
}

test('transcription recovers from a transient error using bounded backoff', async (t) => {
  let calls = 0;
  const delays = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    delays.push(delay);
    queueMicrotask(callback);
    return 0;
  });
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return calls === 1
      ? new Response('temporary', { status: 503, headers: { 'Retry-After': '999' } })
      : new Response(JSON.stringify({ text: 'recovered' }));
  });
  assert.deepEqual(await requestTranscription({
    audioBlob: new Blob(['audio']), fileName: 'audio.mp3', settings: { apiKey: 'key' },
  }), { text: 'recovered' });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [30000]);
});

test('cancellation during retry backoff prevents another API call', async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return new Response('temporary', { status: 503 });
  });
  t.mock.method(globalThis, 'setTimeout', () => {
    queueMicrotask(() => controller.abort());
    return 0;
  });
  await assert.rejects(requestTranscription({
    audioBlob: new Blob(['audio']), fileName: 'audio.mp3', settings: { apiKey: 'key' },
    signal: controller.signal,
  }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('an unreadable HTTP error body retains status and never splits a translation batch', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return {
      ok: false, status: 401, statusText: 'Unauthorized', headers: new Headers(),
      text: async () => { throw new TypeError('body secret-key'); },
    };
  });
  await assert.rejects(translateSubtitles({
    subtitles: Array.from({ length: 30 }, () => ({ original: 'Hello' })),
    settings: { apiKey: 'secret-key' },
  }), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.isApiError, true);
    assert.doesNotMatch(error.message, /secret-key/);
    return true;
  });
  assert.equal(calls, 1);
});

test('missing-segment retries propagate permanent API failures instead of retrying the parent batch', async (t) => {
  const sizes = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sizes.push(JSON.parse(JSON.parse(init.body).input).subtitles.length);
    return sizes.length === 1
      ? new Response(JSON.stringify({ output_text: JSON.stringify([{ id: 0, translated: 'one' }]) }))
      : new Response('forbidden', { status: 403 });
  });
  await assert.rejects(translateSubtitles({
    subtitles: [{ original: 'one' }, { original: 'two' }],
    settings: { apiKey: 'key' },
  }), { status: 403 });
  assert.deepEqual(sizes, [2, 1]);
});
