import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyEntitlement, verifyIntegrity } from '../server/play-billing/verify.mjs';

const now = Date.parse('2026-11-16T08:00:00Z');
const expectedProduct = 'subtitle_remove_ads';
const future = new Date(now + 60000).toISOString();
const item = { productId: expectedProduct, expiryTime: future, offerDetails: { basePlanId: 'monthly' } };
const purchase = {
  subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
  lineItems: [item],
};
const packageName = 'com.haebi.subtitle';
const tokens = ['token_1', 'token_2'];
const details = {
  requestDetails: {
    requestPackageName: packageName,
    requestHash: createHash('sha256').update(tokens.join('\n')).digest('hex'),
    timestampMillis: String(now),
  },
  appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName },
  accountDetails: { appLicensingVerdict: 'LICENSED' },
  deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
};

test('Integrity verdict binds fresh Play-installed app to the exact token list', () => {
  assert.equal(verifyIntegrity(details, tokens, now), true);
  assert.equal(verifyIntegrity(details, ['token_1'], now), false);
  assert.equal(verifyIntegrity(details, tokens, now + 180000), false);
  assert.equal(verifyIntegrity({ ...details, accountDetails: { appLicensingVerdict: 'UNLICENSED' } }, tokens, now), false);
  assert.equal(verifyIntegrity({ ...details, deviceIntegrity: {} }, tokens, now), false);
});

test('eligible subscriptions expire and canceled subscriptions keep their paid period', async () => {
  const verify = value => verifyEntitlement(['token_1'], { read: async () => value }, () => now);
  for (const state of ['ACTIVE', 'IN_GRACE_PERIOD', 'CANCELED']) {
    assert.equal(await verify({ ...purchase, subscriptionState: 'SUBSCRIPTION_STATE_' + state }), 60000);
  }
  for (const state of ['PENDING', 'ON_HOLD', 'PAUSED', 'EXPIRED', 'PENDING_PURCHASE_CANCELED']) {
    assert.equal(await verify({ ...purchase, subscriptionState: 'SUBSCRIPTION_STATE_' + state }), 0);
  }
  assert.equal(await verify({ ...purchase, lineItems: [{ ...item, expiryTime: new Date(now).toISOString() }] }), 0);
});

test('unknown plans, unrelated products and absent purchases cannot become ad-free', async () => {
  const verify = value => verifyEntitlement(['token_1'], { read: async () => value }, () => now);
  assert.equal(await verify(null), 0);
  assert.equal(await verify({ ...purchase, lineItems: [{ ...item, productId: 'unrelated_product' }] }), 0);
  assert.equal(await verify({ ...purchase, lineItems: [{ ...item, offerDetails: { basePlanId: 'unknown' } }] }), 0);
});

test('only a verified pending acknowledgement can be acknowledged and grants require readback', async () => {
  const pending = { ...purchase, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' };
  const operations = [];
  let acknowledged = false;
  const play = {
    async read(token) { operations.push(['read', token]); return acknowledged ? purchase : pending; },
    async acknowledge(token) { operations.push(['acknowledge', token]); acknowledged = true; },
  };
  assert.equal(await verifyEntitlement(['token_1'], play, () => now), 60000);
  assert.deepEqual(operations, [['read', 'token_1'], ['acknowledge', 'token_1'], ['read', 'token_1']]);
  assert.equal(await verifyEntitlement(['token_1'], { read: async () => pending, acknowledge: async () => {} }, () => now), 0);
});
