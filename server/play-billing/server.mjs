import { createServer } from 'node:http';
import { verifyEntitlement, verifyIntegrity } from './verify.mjs';

const INVALID_PURCHASE_CHARACTER = /[^A-Za-z0-9._~+=/-]/;
const INVALID_INTEGRITY_CHARACTER = /[^A-Za-z0-9._~=-]/;
const MAX_BODY = 24 * 1024;

function send(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }).end(JSON.stringify(data));
}

async function readRequest(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) return null;
    chunks.push(chunk);
  }
  try {
    const { integrityToken, purchaseTokens } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof integrityToken !== 'string' || !integrityToken || integrityToken.length > 12000
        || INVALID_INTEGRITY_CHARACTER.test(integrityToken)
        || !Array.isArray(purchaseTokens) || purchaseTokens.length > 4
        || !purchaseTokens.every(token => typeof token === 'string' && token.length > 0
          && token.length <= 2048 && !INVALID_PURCHASE_CHARACTER.test(token))
        || new Set(purchaseTokens).size !== purchaseTokens.length) return null;
    return { integrityToken, purchaseTokens };
  } catch { return null; }
}

export function createBillingServer({ play, clock = Date.now }) {
  let inFlight = 0;
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/subscriptions/verify') return send(res, 404, {});
    if (inFlight >= 16) return send(res, 429, {});
    if (req.headers['content-type'] !== 'application/json; charset=utf-8') return send(res, 415, {});
    inFlight++;
    try {
      const input = await readRequest(req);
      if (!input) {
        res.setHeader('connection', 'close');
        return send(res, 400, {});
      }
      const { integrityToken, purchaseTokens } = input;
      const verdict = await play.decode(integrityToken);
      if (!verifyIntegrity(verdict, purchaseTokens, clock())) return send(res, 403, {});
      if (purchaseTokens.length === 0) await play.checkCatalog();
      const validForMs = await verifyEntitlement(purchaseTokens, play, clock);
      send(res, 200, { validForMs });
    } catch {
      send(res, 503, {});
    } finally { inFlight--; }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  server.maxConnections = 64;
  return server;
}
