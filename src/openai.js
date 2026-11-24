export const OPENAI_DEFAULTS = {
  apiBaseUrl: 'https://api.openai.com/v1',
  sttModel: 'whisper-1',
  translationModel: 'gpt-6-luna',
  translationBatchSize: 30,
};

export async function requestTranscription({ audioBlob, fileName, settings, signal }) {
  const form = new FormData();
  form.append('file', audioBlob, fileName);
  const model = settings.sttModel || OPENAI_DEFAULTS.sttModel;
  if (!['whisper-1', 'gpt-transcribe', 'gpt-4o-transcribe-diarize'].includes(model)) {
    throw new Error('지원하지 않는 음성 인식 모델입니다.');
  }
  form.append('model', model);
  form.append('response_format', model === 'whisper-1' ? 'verbose_json' :
    model === 'gpt-4o-transcribe-diarize' ? 'diarized_json' : 'json');

  if (model === 'whisper-1') {
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');
  }
  if (model === 'gpt-4o-transcribe-diarize') form.append('chunking_strategy', 'auto');
  if (settings.sourceLanguage && settings.sourceLanguage !== 'auto') {
    form.append(model === 'gpt-transcribe' ? 'languages[]' : 'language', settings.sourceLanguage);
  }

  const response = await apiFetch('/audio/transcriptions', {
    method: 'POST',
    body: form,
    settings,
    signal,
  });

  return withExactSecretRedaction(() => response.json(), settings.apiKey);
}

export async function translateSubtitles({ subtitles, settings, signal, onProgress, onCheckpoint, resume = false }) {
  const targetLanguage = settings.targetLanguage || 'ko';
  const batchSize = Math.max(1, Math.floor(Number(settings.translationBatchSize) || OPENAI_DEFAULTS.translationBatchSize));
  const result = subtitles.map((subtitle) => ({ ...subtitle }));
  const pending = result.map((subtitle, index) => ({ subtitle, index }))
    .filter(({ subtitle }) => !resume || !(['translated', 'edited'].includes(subtitle.status) && cleanTranslation(subtitle.translated)));
  const batches = [];
  for (let index = 0; index < pending.length; index += batchSize) batches.push(pending.slice(index, index + batchSize));

  let done = result.length - pending.length;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    signal?.throwIfAborted();
    const batch = batches[batchIndex];
    onProgress?.({ batchIndex, batchCount: batches.length, done });
    await translateBatchWithFallback({
      batch: batch.map(({ subtitle }) => subtitle),
      targetLanguage, settings, signal,
      onResult: (offset, translated) => {
        const patches = translated.map((subtitle, index) => {
          const originalIndex = batch[offset + index].index;
          result[originalIndex] = { ...subtitle };
          return { index: originalIndex, subtitle: { ...subtitle } };
        });
        onCheckpoint?.(patches);
      },
    });
    done += batch.length;
  }
  signal?.throwIfAborted();
  onProgress?.({ batchIndex: batches.length, batchCount: batches.length, done });
  return result;
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

async function translateBatchWithFallback({ batch, targetLanguage, settings, signal, onResult }) {
  signal?.throwIfAborted();
  let translated;
  try {
    translated = await translateBatch({ batch, targetLanguage, settings, signal });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.isApiError) throw error;
    if (batch.length <= 1) {
      onResult(0, batch.map((subtitle) => markTranslationFailed(subtitle, error.message)));
      return;
    }
    const fallbackSize = batch.length > 5 ? 5 : 1;
    for (let index = 0; index < batch.length; index += fallbackSize) {
      await translateBatchWithFallback({
        batch: batch.slice(index, index + fallbackSize), targetLanguage, settings, signal,
        onResult: (offset, items) => onResult(index + offset, items),
      });
    }
    return;
  }

  // Preserve valid siblings before retrying missing IDs. A later request may fail or be cancelled.
  onResult(0, translated);
  for (const [index, subtitle] of translated.entries()) {
    if (!isMissingTranslationFailure(subtitle)) continue;
    signal?.throwIfAborted();
    let retried;
    try {
      [retried] = await translateBatch({ batch: [subtitle], targetLanguage, settings, signal });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.isApiError) throw error;
      retried = markTranslationFailed(subtitle, error.message);
    }
    onResult(index, [retried]);
  }
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
                    id: { type: 'integer' },
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
  if ((payload?.status != null && payload.status !== 'completed') || payload?.error != null ||
      (Array.isArray(payload?.output) && payload.output.some((item) =>
        Array.isArray(item?.content) && item.content.some((part) => part?.type === 'refusal')))) {
    throw new Error('Translation response was incomplete or refused');
  }
  const text = extractResponseText(payload);
  const parsed = await withExactSecretRedaction(() => parseJsonArray(text), settings.apiKey);
  if (!Array.isArray(parsed) || (batch.length > 0 && parsed.length === 0)) {
    throw new Error('Translation response did not include translations');
  }

  const byId = new Map();
  const seen = new Set();
  for (const item of parsed) {
    const id = item?.id;
    if (!Number.isInteger(id) || id < 0 || id >= batch.length) continue;
    if (seen.has(id)) {
      byId.delete(id);
      continue;
    }
    seen.add(id);
    byId.set(id, item.translated);
  }

  return batch.map((subtitle, index) => {
    const translated = cleanTranslation(byId.get(index));
    if (!translated) {
      return markTranslationFailed(subtitle, 'Translation response did not include this segment');
    }

    const { translationError, ...source } = subtitle;
    return {
      ...source,
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
        failure = new Error((error?.message ?? String(error)) + ' · 서버 처리 여부를 확인할 수 없어 자동 재요청하지 않습니다. 다시 실행하면 추가 비용이 발생할 수 있습니다.');
        failure.retryable = false;
      }

      if (response) {
        if (response.ok) return response;
        const detail = await formatApiError(response);
        failure = new Error(detail.message);
        failure.status = response.status;
        const quota = ['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active', 'usage_limit_reached'].includes(detail.code);
        failure.retryable = (response.status === 429 && !quota) || response.status >= 500;
        failure.retryAfterMs = parseRetryAfter(response.headers?.get('Retry-After'));
      }

      failure.isApiError = true;
      if (!failure.retryable || attempt === 2 || (failure.retryAfterMs ?? 0) > 30000) throw failure;
      const delay = Math.max(500 * (2 ** attempt), failure.retryAfterMs ?? 0);
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
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '[번역 불가]' || text === '[번역 실패]' ? '' : text;
}

async function formatApiError(response) {
  const status = `${response.status} ${response.statusText}`.trim();
  let text;
  try {
    text = await response.text();
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { message: `OpenAI API ${status}: Request failed.` };
  }

  try {
    const parsed = JSON.parse(text);
    return { message: `OpenAI API ${status}: ${parsed.error?.message ?? text}`, code: parsed.error?.code };
  } catch {
    return { message: `OpenAI API ${status}: ${text || 'Request failed.'}` };
  }
}
