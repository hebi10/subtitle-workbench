const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const ALLOWED_PATHS = new Set(['/audio/transcriptions', '/responses']);
const DEFAULT_MAX_REQUEST_BYTES = 26214400;
const DEFAULT_TIMEOUT_MS = 60000;

function corsHeaders(origin) {
  const headers = new Headers({ Vary: 'Origin' });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return headers;
}

function jsonError(status, message, origin = null) {
  const headers = corsHeaders(origin);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

function allowedOrigins(env) {
  return new Set(
    String(env?.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function maximumRequestBytes(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_REQUEST_BYTES;
}

function isBearerAuthorization(value) {
  return typeof value === 'string' && /^Bearer[ \t]+\S+$/i.test(value);
}

function mediaType(value) {
  return String(value ?? '').split(';', 1)[0].trim().toLowerCase();
}

function contentLengthExceedsLimit(value, maximumBytes) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return false;
  }
  return BigInt(value) > BigInt(maximumBytes);
}

async function readBoundedBody(stream, maximumBytes) {
  if (!stream) {
    return { bytes: new Uint8Array(0), tooLarge: false };
  }

  const reader = stream.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (chunk.byteLength > maximumBytes - totalBytes) {
      try {
        await reader.cancel();
      } catch {
        // The size rejection remains authoritative if source cancellation fails.
      }
      return { bytes: null, tooLarge: true };
    }

    chunks.push(chunk);
    totalBytes += chunk.byteLength;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, tooLarge: false };
}

export async function handleProxyRequest(request, env, options = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');

  if (!origin || !allowedOrigins(env).has(origin)) {
    return jsonError(403, 'Origin is not allowed.');
  }

  if (!ALLOWED_PATHS.has(url.pathname)) {
    return jsonError(404, 'Route not found.', origin);
  }

  if (request.method === 'OPTIONS') {
    const headers = corsHeaders(origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return jsonError(405, 'Method is not allowed.', origin);
  }

  const authorization = request.headers.get('Authorization');
  if (!isBearerAuthorization(authorization)) {
    return jsonError(401, 'Bearer authorization is required.', origin);
  }

  const contentType = request.headers.get('Content-Type');
  const expectedMediaType = url.pathname === '/responses'
    ? 'application/json'
    : 'multipart/form-data';
  if (mediaType(contentType) !== expectedMediaType) {
    return jsonError(415, 'Unsupported media type.', origin);
  }

  const maxRequestBytes = maximumRequestBytes(env?.MAX_REQUEST_BYTES);
  if (contentLengthExceedsLimit(request.headers.get('Content-Length'), maxRequestBytes)) {
    return jsonError(413, 'Request body is too large.', origin);
  }

  if (env?.RATE_LIMITER) {
    let limitResult;
    try {
      limitResult = await env.RATE_LIMITER.limit({ key: origin });
    } catch {
      return jsonError(503, 'Rate limiter is unavailable.', origin);
    }

    if (!limitResult?.success) {
      return jsonError(429, 'Rate limit exceeded.', origin);
    }
  }

  const { bytes: body, tooLarge } = await readBoundedBody(request.body, maxRequestBytes);
  if (tooLarge) {
    return jsonError(413, 'Request body is too large.', origin);
  }

  const upstreamHeaders = new Headers();
  upstreamHeaders.set('Authorization', authorization);
  upstreamHeaders.set('Content-Type', contentType);

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let upstream;
  let upstreamBody;

  try {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    upstream = await fetchImpl(`${OPENAI_BASE_URL}${url.pathname}`, {
      method: 'POST',
      headers: upstreamHeaders,
      body,
      signal: controller.signal,
    });
    upstreamBody = upstream.body ? await upstream.arrayBuffer() : null;
  } catch {
    if (controller.signal.aborted) {
      return jsonError(504, 'Upstream request timed out.', origin);
    }
    return jsonError(502, 'Upstream request failed.', origin);
  } finally {
    clearTimeout(timeoutId);
  }

  const responseHeaders = corsHeaders(origin);
  const upstreamContentType = upstream.headers.get('Content-Type');
  if (upstreamContentType) {
    responseHeaders.set('Content-Type', upstreamContentType);
  }

  return new Response(upstreamBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request, env) {
    return handleProxyRequest(request, env);
  },
};
