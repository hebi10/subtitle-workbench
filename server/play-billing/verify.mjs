import { createHash } from 'node:crypto';

export const PACKAGE = 'com.haebi.subtitle';
export const PRODUCT = 'subtitle_remove_ads';
const plans = new Set(['monthly', 'yearly']);
const eligible = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED']);
const ACKNOWLEDGED = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
const MAX_GRANT_MS = 15 * 60 * 1000;

export function verifyIntegrity(verdict, tokens, now) {
  const request = verdict?.requestDetails;
  const timestamp = Number(request?.timestampMillis);
  const hash = createHash('sha256').update(tokens.join('\n')).digest('hex');
  return request?.requestPackageName === PACKAGE
    && request.requestHash === hash
    && Number.isSafeInteger(timestamp) && timestamp <= now + 10000 && timestamp > now - 120000
    && verdict.appIntegrity?.packageName === PACKAGE
    && verdict.appIntegrity.appRecognitionVerdict === 'PLAY_RECOGNIZED'
    && verdict.accountDetails?.appLicensingVerdict === 'LICENSED'
    && Array.isArray(verdict.deviceIntegrity?.deviceRecognitionVerdict)
    && verdict.deviceIntegrity.deviceRecognitionVerdict.includes('MEETS_DEVICE_INTEGRITY');
}

function eligibleUntil(purchase) {
  if (!eligible.has(purchase?.subscriptionState) || !Array.isArray(purchase.lineItems)) return 0;
  let expiry = 0;
  for (const item of purchase.lineItems) {
    if (item?.productId !== PRODUCT || !plans.has(item.offerDetails?.basePlanId)) continue;
    const time = Date.parse(item.expiryTime);
    if (Number.isFinite(time)) expiry = Math.max(expiry, time);
  }
  return expiry;
}

export async function verifyEntitlement(tokens, play, clock = Date.now) {
  let expiry = 0;
  for (const token of tokens) {
    let purchase = await play.read(token);
    if (eligibleUntil(purchase) <= clock()) continue;
    if (purchase.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
      await play.acknowledge(token);
      purchase = await play.read(token);
    }
    if (purchase?.acknowledgementState === ACKNOWLEDGED) expiry = Math.max(expiry, eligibleUntil(purchase));
  }
  return Math.max(0, Math.min(MAX_GRANT_MS, expiry - clock()));
}
