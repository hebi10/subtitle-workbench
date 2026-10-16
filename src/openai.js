export const OPENAI_DEFAULTS = {
  apiBaseUrl: 'https://api.openai.com/v1',
  sttModel: 'whisper-1',
  translationModel: 'gpt-5.5',
  translationBatchSize: 30,
};

export async function requestTranscription({ audioBlob, fileName, settings, signal }) {
  const form = new FormData();
  form.append('file', audioBlob, fileName);
  form.append('model', settings.sttModel || OPENAI_DEFAULTS.sttModel);
  form.append('response_format', 'verbose_json');

  if ((settings.sttModel || OPENAI_DEFAULTS.sttModel) === 'whisper-1') {
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');
  }

  if (settings.sourceLanguage && settings.sourceLanguage !== 'auto') {
    form.append('language', settings.sourceLanguage);
  }

  const response = await apiFetch('/audio/transcriptions', {
    method: 'POST',
    body: form,
    settings,
    signal,
  });

  return withExactSecretRedaction(() => response.json(), settings.apiKey);
}

export async function translateSubtitles({ subtitles, settings, signal, onProgress }) {
  const targetLanguage = settings.targetLanguage || 'ko';
  const batchSize = Math.max(1, Number(settings.translationBatchSize) || OPENAI_DEFAULTS.translationBatchSize);
  const translated = [];
  const batches = [];

  for (let index = 0; index < subtitles.length; index += batchSize) {
    batches.push(subtitles.slice(index, index + batchSize));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    onProgress?.({ batchIndex, batchCount: batches.length, done: translated.length });
    translated.push(
      ...(await translateBatchWithFallback({
        batch,
        targetLanguage,
        settings,
        signal,
      })),
    );
  }

  onProgress?.({ batchIndex: batches.length, batchCount: batches.length, done: translated.length });
  return translated;
}

export function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string') {
    return payload.output_text;
  }

  if (typeof payload?.text === 'string') {
    return payload.text;
  }

  if (Array.isArray(payload?.output)) {
    return payload.output
      .flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? content.output_text ?? '')
      .join('');
  }

  if (Array.isArray(payload?.choices)) {
    return payload.choices.map((choice) => choice.message?.content ?? choice.text ?? '').join('');
  }

  return '';
}

async function translateBatchWithFallback({ batch, targetLanguage, settings, signal }) {
  try {
    const translated = await translateBatch({ batch, targetLanguage, settings, signal });
    return await retryMissingTranslations({
      translated,
      targetLanguage,
      settings,
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.isApiError) {
      throw error;
    }

    if (batch.length <= 1) {
      return batch.map((subtitle) => markTranslationFailed(subtitle, error.message));
    }

    const fallbackSize = batch.length > 5 ? 5 : 1;
    const translated = [];

    for (let index = 0; index < batch.length; index += fallbackSize) {
      translated.push(
        ...(await translateBatchWithFallback({
          batch: batch.slice(index, index + fallbackSize),
          targetLanguage,
          settings,
          signal,
        })),
      );
    }

    return translated;
  }
}

async function retryMissingTranslations({ translated, targetLanguage, settings, signal }) {
  const retryTargets = translated
    .map((subtitle, index) => ({ subtitle, index }))
    .filter(({ subtitle }) => isMissingTranslationFailure(subtitle));

  if (retryTargets.length === 0) {
    return translated;
  }

  const next = [...translated];

  for (const { subtitle, index } of retryTargets) {
    try {
      const [retried] = await translateBatch({
        batch: [subtitle],
        targetLanguage,
        settings,
        signal,
      });
      next[index] = retried;
    } catch (error) {
      if (error?.name === 'AbortError' || error?.isApiError) {
        throw error;
      }
      next[index] = markTranslationFailed(subtitle, error.message);
    }
  }

  return next;
}

async function translateBatch({ batch, targetLanguage, settings, signal }) {
  const input = batch.map((subtitle, index) => ({
    id: index,
    text: subtitle.original,
  }));

  const response = await apiFetch('/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.translationModel || OPENAI_DEFAULTS.translationModel,
      reasoning: {
        effort: 'low',
      },
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'subtitle_translations',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['translations'],
            properties: {
              translations: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'translated'],
                  properties: {
                    id: { type: 'number' },
                    translated: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      instructions: [
        'Translate subtitle text into the requested target language.',
        'Return JSON that matches the provided schema.',
        'Each translation item must keep the same numeric id.',
        'Keep timing, numbering, names, and meaning intact.',
        'If a line cannot be translated, return "[번역 불가]" for that line.',
      ].join(' '),
      input: JSON.stringify({
        targetLanguage,
        subtitles: input,
      }),
    }),
    settings,
    signal,
  });

  const payload = await withExactSecretRedaction(() => response.json(), settings.apiKey);
  const text = extractResponseText(payload);
  const parsed = await withExactSecretRedaction(() => parseJsonArray(text), settings.apiKey);
  if (batch.length > 0 && parsed.length === 0) {
    throw new Error('Translation response did not include translations');
  }

  const byId = new Map(parsed.map((item) => [Number(item.id), item.translated]));

  return batch.map((subtitle, index) => {
    const translated = cleanTranslation(byId.get(index));
    if (!translated) {
      return markTranslationFailed(subtitle, 'Translation response did not include this segment');
    }

    return {
      ...subtitle,
      translated,
      status: 'translated',
    };
  });
}

function markTranslationFailed(subtitle, reason) {
  return {
    ...subtitle,
    translated: '[번역 실패]',
    status: 'failed',
    translationError: reason || 'Translation failed',
  };
}

function isMissingTranslationFailure(subtitle) {
  return (
    subtitle?.status === 'failed' &&
    subtitle?.translationError === 'Translation response did not include this segment'
  );
}

async function apiFetch(path, { method, headers = {}, body, settings, signal }) {
  const apiKey = String(settings.apiKey ?? '').trim();
  if (!apiKey) {
    throw new Error('OpenAI API 키를 입력해 주세요.');
  }

  if (settings.connectionMode === 'worker' && !String(settings.proxyUrl ?? '').trim()) {
    throw new Error('Worker 프록시 URL을 입력해 주세요.');
  }

  const requestHeaders = new Headers(headers);
  requestHeaders.set('Authorization', `Bearer ${apiKey}`);

  return withExactSecretRedaction(async () => {
    const url = resolveApiUrl(path, settings);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      signal?.throwIfAborted();
      let failure;
      let response;
      try {
        response = await fetch(url, { method, headers: requestHeaders, body, signal,
          credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        signal?.throwIfAborted();
        failure = new Error(error?.message ?? String(error));
        failure.retryable = true;
      }

      if (response) {
        if (response.ok) return response;
        failure = new Error(await formatApiError(response));
        failure.status = response.status;
        failure.retryable = response.status === 429 || response.status >= 500;
        failure.retryAfterMs = parseRetryAfter(response.headers?.get('Retry-After'));
      }

      failure.isApiError = true;
      if (!failure.retryable || attempt === 2) throw failure;
      const delay = Math.min(30000, Math.max(500 * (2 ** attempt), failure.retryAfterMs ?? 0));
      await waitForRetry(delay, signal);
    }
  }, apiKey);
}

function parseRetryAfter(value) {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : undefined;
}

function waitForRetry(delay, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function resolveApiUrl(path, settings) {
  const base = settings.connectionMode === 'worker'
    ? String(settings.proxyUrl ?? '').trim()
    : OPENAI_DEFAULTS.apiBaseUrl;
  let endpoint;
  try { endpoint = new URL(base); } catch { throw new Error('유효한 HTTPS Worker URL을 입력해 주세요.'); }
  const host = endpoint.hostname.toLowerCase().replace(/\.$/, '');
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      host === 'blogflow.kr' || host === 'www.blogflow.kr' ||
      (globalThis.location && endpoint.origin === globalThis.location.origin)) {
    throw new Error('WordPress와 다른 출처의 HTTPS Worker URL을 입력해 주세요. URL에 인증 정보나 쿼리를 포함할 수 없습니다.');
  }
  return `${endpoint.href.replace(/\/+$/, '')}${path}`;
}

function redactExactSecret(text, secret) {
  return secret ? String(text).split(secret).join('[REDACTED]') : String(text);
}

async function withExactSecretRedaction(operation, secret) {
  try {
    return await operation();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }

    const redactedError = new Error(
      redactExactSecret(error?.message ?? error, String(secret ?? '').trim()),
    );
    redactedError.name = error?.name || 'Error';
    for (const field of ['status', 'retryAfterMs']) {
      if (typeof error?.[field] === 'number' && Number.isFinite(error[field])) {
        redactedError[field] = error[field];
      }
    }
    for (const field of ['isApiError', 'retryable']) {
      if (typeof error?.[field] === 'boolean') redactedError[field] = error[field];
    }
    throw redactedError;
  }
}

function parseJsonArray(text) {
  const trimmed = String(text ?? '').trim();

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : parsed.translations ?? [];
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    }
  }

  return [];
}

function cleanTranslation(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function formatApiError(response) {
  const status = `${response.status} ${response.statusText}`.trim();
  let text;
  try {
    text = await response.text();
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return `OpenAI API ${status}: Request failed.`;
  }

  try {
    const parsed = JSON.parse(text);
    return `OpenAI API ${status}: ${parsed.error?.message ?? text}`;
  } catch {
    return `OpenAI API ${status}: ${text || 'Request failed.'}`;
  }
}
