import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = path => readFile(resolve(root, path), 'utf8');

test('Ads are consent-gated, native and restricted to new-task screen', async () => {
  const [controller, main, app, manifest] = await Promise.all([
    read('android/app/src/main/java/com/haebi/subtitle/MonetizationController.java'),
    read('android/app/src/main/java/com/haebi/subtitle/MainActivity.java'),
    read('android/web/app.js'),
    read('android/app/src/main/AndroidManifest.xml'),
  ]);
  assert.match(controller, /"video"\.equals\(screen\)/);
  assert.match(controller, /consent\.canRequestAds\(\)/);
  assert.match(controller, /loadAndShowConsentFormIfRequired/);
  assert.match(controller, /getCurrentOrientationAnchoredAdaptiveBannerAdSize/);
  assert.doesNotMatch(controller, /grantPremium|setPremium\(true\)/);
  assert.match(main, /case "setAdScreen":/);
  assert.match(app, /nativeCall\('setAdScreen', \{ screen: next \}\)/);
  assert.match(manifest, /com\.google\.android\.gms\.ads\.APPLICATION_ID/);
});

test('Purchase requires a verified service and ad removal requires a time-limited grant', async () => {
  const [ads, controller, verifier, gradle, html, privacy] = await Promise.all([
    read('android/app/src/main/java/com/haebi/subtitle/MonetizationController.java'),
    read('android/app/src/main/java/com/haebi/subtitle/SubscriptionController.java'),
    read('android/app/src/main/java/com/haebi/subtitle/SubscriptionVerifier.java'),
    read('android/app/build.gradle'),
    read('android/web/index.html'),
    read('docs/privacy-policy.html'),
  ]);
  assert.match(controller, /subtitle_remove_ads/);
  assert.match(controller, /"monthly"/);
  assert.match(controller, /"yearly"/);
  assert.match(controller, /if \(!ready \|\| hasPurchase \|\| pendingPurchase/);
  assert.match(controller, /verifier\.verify\(new ArrayList<>\(tokens\)/);
  assert.match(controller, /verifiedUntil > SystemClock\.elapsedRealtime\(\)/);
  assert.match(verifier, /candidate >= 0 && candidate <= MAX_VALID_MS/);
  assert.match(ads, /consent\.canRequestAds\(\) && !subscriptionsVerified\(\)/);
  assert.match(gradle, /billing:9\.1\.0/);
  assert.match(gradle, /verifySubtitleAdMobReleaseIds/);
  assert.match(html, /id="subtitleCheckSubscriptions"/);
  assert.match(html, /id="subtitleRestoreSubscription" type="button" hidden/);
  assert.match(privacy, /Google AdMob/);
});
