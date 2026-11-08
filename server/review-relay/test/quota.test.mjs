import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Quota } from '../quota.mjs';
import { loadConfig } from '../config.mjs';
import { Worker } from 'node:worker_threads';

test('configuration is disabled without secrets and a persistent absolute database path', () => {
  assert.throws(() => loadConfig({}), /configuration/);
  assert.throws(() => loadConfig({ REVIEW_RELAY_ENABLED: 'true', REVIEW_ACCESS_CODE: 'short' }), /configuration/);
  assert.throws(() => loadConfig({ REVIEW_RELAY_ENABLED: 'true', REVIEW_ACCESS_CODE: 'x'.repeat(48), OPENAI_API_KEY: 'sk-' + 'y'.repeat(40), REVIEW_DB_PATH: 'relative.db' }), /configuration/);
});

test('atomic quota reservations exhaust globally and survive reopen and clock rollback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-quota-'));
  const path = join(dir, 'quota.sqlite');
  const limits = { requests: 10, audioSeconds: 5, realtimeSeconds: 300, textChars: 20 };
  let now = new Date('2026-11-08T12:00:00Z');
  const quota = new Quota(path, limits, () => now);
  try {
    const results = await Promise.all(Array.from({ length: 20 }, async () => {
      try { quota.reserve({ requests: 1, audioSeconds: 1 }); return true; } catch { return false; }
    }));
    assert.equal(results.filter(Boolean).length, 5);
    assert.throws(() => quota.reserve({ requests: 1, audioSeconds: 1 }), /quota/);
    quota.reserve({ requests: 5, textChars: 20 });
    assert.throws(() => quota.reserve({ requests: 1 }), /quota/);
    assert.throws(() => quota.reserve({ textChars: 1 }), /quota/);
    quota.reserve({ realtimeSeconds: 300 });
    assert.throws(() => quota.reserve({ realtimeSeconds: 1 }), /quota/);
    quota.close();
    const reopened = new Quota(path, limits, () => now);
    try {
      assert.throws(() => reopened.reserve({ requests: 1 }), /quota/);
      now = new Date('2026-11-07T12:00:00Z');
      assert.throws(() => reopened.reserve({ requests: 1 }), /quota/);
      now = new Date('2026-11-09T00:00:00Z');
      reopened.reserve({ requests: 1 });
      assert.throws(() => reopened.reserve({ requests: -1 }), /reservation/);
    } finally { reopened.close(); }
  } finally { quota.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('quota fails closed on unusable storage', () => {
  assert.throws(() => new Quota('/no-such-relay-directory/quota.sqlite', { requests: 1, audioSeconds: 1, realtimeSeconds: 1, textChars: 1 }));
});

test('independent concurrent SQLite connections cannot overspend the same daily quota', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-quota-workers-'));
  const path = join(dir, 'quota.sqlite');
  const limits = { requests: 10, audioSeconds: 5, realtimeSeconds: 300, textChars: 20 };
  const initial = new Quota(path, limits); initial.close();
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./quota-worker.mjs', import.meta.url), { workerData: { path, limits } });
      worker.once('message', resolve); worker.once('error', reject);
    })));
    assert.equal(results.reduce((a, b) => a + b, 0), 10);
    const reopened = new Quota(path, limits);
    try { assert.throws(() => reopened.reserve({ requests: 1 }), /quota/); } finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
