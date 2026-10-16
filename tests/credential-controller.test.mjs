import assert from 'node:assert/strict';
import test from 'node:test';
import { createCredentialController } from '../src/credential-controller.js';

const API_KEY = 'sk-controller-test-only';
const LEGACY_KEYS = [
  'aiSubtitleGenerator.encryptedCredential.v1',
  'aiSubtitleGenerator.connection',
];

function control(overrides = {}) {
  return { checked: false, disabled: false, hidden: false, value: '', textContent: '', ...overrides };
}

function createHarness({ mode = 'worker', storage, cryptoProvider, vault } = {}) {
  const controls = {
    apiKey: control(),
    proxyUrl: control(),
    connectionModeInputs: [
      control({ value: 'browser', checked: mode === 'browser' }),
      control({ value: 'worker', checked: mode === 'worker' }),
    ],
  };
  for (const name of [
    'rememberCredentials', 'credentialPassphraseFields', 'localPassphrase',
    'localPassphraseConfirmationField', 'localPassphraseConfirmation',
    'saveCredentialButton', 'unlockCredentialButton', 'deleteCredentialButton',
    'credentialStatus', 'credentialError',
  ]) {
    controls[name] = control();
  }
  const pipeline = { busy: false };
  const controller = createCredentialController({
    controls,
    storage,
    cryptoProvider,
    vault,
    getConnectionMode: () => mode,
    isPipelineBusy: () => pipeline.busy,
  });
  return { controller, controls, pipeline };
}

test('initialization, rendering, saving and unlocking never access storage or cryptography', async () => {
  const accessed = [];
  const forbidden = new Proxy({}, {
    get(_target, property) {
      accessed.push(property);
      throw new Error('Persistence must not be accessed');
    },
  });
  const { controller, controls } = createHarness({
    storage: forbidden,
    cryptoProvider: forbidden,
    vault: forbidden,
  });
  controls.apiKey.value = API_KEY;
  controls.rememberCredentials.checked = true;
  controls.localPassphrase.value = 'old passphrase';
  controller.initialize();
  controller.render();
  assert.equal(await controller.save(), false);
  assert.equal(await controller.unlock(), false);
  assert.equal(controller.getActiveApiKey(), API_KEY);
  assert.deepEqual(accessed, []);
  assert.equal(controls.rememberCredentials.checked, false);
  assert.equal(controls.rememberCredentials.disabled, true);
  assert.equal(controls.localPassphrase.value, '');
  for (const name of ['saveCredentialButton', 'unlockCredentialButton']) {
    assert.equal(controls[name].hidden, true);
    assert.equal(controls[name].disabled, true);
  }
  assert.equal(controls.deleteCredentialButton.hidden, false);
  assert.match(controls.credentialStatus.textContent, /현재 탭/);
});

test('active credential comes only from the current input and has no saved fallback', async () => {
  const { controller, controls } = createHarness();
  controller.initialize();
  controls.apiKey.value = '  ' + API_KEY + '  ';
  assert.equal(controller.getActiveApiKey(), API_KEY);
  controls.apiKey.value = '';
  await controller.unlock();
  assert.equal(controller.getActiveApiKey(), '');
  const nextTab = createHarness();
  nextTab.controller.initialize();
  assert.equal(nextTab.controller.getActiveApiKey(), '');
  assert.deepEqual(controller.getState(), {
    credentialBusy: false, hasEncryptedCredential: false,
    cryptoAvailable: false, isUnlocked: false,
  });
  assert.equal(controls.credentialStatus.textContent.includes(API_KEY), false);
});

for (const mode of ['browser', 'worker']) {
  test('pipeline locks connection controls in ' + mode + ' mode', () => {
    const { controller, controls, pipeline } = createHarness({ mode });
    controller.initialize();
    assert.equal(controls.apiKey.disabled, false);
    assert.equal(controls.proxyUrl.disabled, mode === 'browser');
    pipeline.busy = true;
    controller.render();
    assert.equal(controls.apiKey.disabled, true);
    assert.equal(controls.proxyUrl.disabled, true);
    assert.equal(controls.connectionModeInputs.every(input => input.disabled), true);
    assert.equal(controls.deleteCredentialButton.disabled, true);
    assert.equal(controller.deleteCredential(), false);
    pipeline.busy = false;
    controller.render();
    assert.equal(controls.apiKey.disabled, false);
    assert.equal(controls.proxyUrl.disabled, mode === 'browser');
  });
}

test('legacy cleanup removes only the two known records after explicit action without reading them', () => {
  const calls = [];
  const storage = {
    getItem() { assert.fail('Cleanup must not read saved keys'); },
    setItem() { assert.fail('Cleanup must not write saved keys'); },
    removeItem(key) { calls.push(key); },
    clear() { assert.fail('Unrelated storage must be preserved'); },
  };
  const { controller, controls } = createHarness({ storage });
  controls.apiKey.value = API_KEY;
  controller.initialize();
  controller.render();
  assert.deepEqual(calls, []);
  assert.equal(controller.deleteCredential(), true);
  assert.deepEqual(calls, LEGACY_KEYS);
  assert.equal(controller.getActiveApiKey(), API_KEY);
  assert.equal(controls.credentialError.hidden, true);
  assert.match(controls.credentialStatus.textContent, /삭제했습니다/);
});

test('cleanup failures do not expose exceptions or the active input', () => {
  const storage = {
    removeItem() { throw new Error('Sensitive failure ' + API_KEY); },
  };
  const { controller, controls } = createHarness({ storage });
  controller.initialize();
  controls.apiKey.value = API_KEY;
  assert.equal(controller.deleteCredential(), false);
  assert.equal(controller.getActiveApiKey(), API_KEY);
  assert.equal(controls.credentialError.hidden, false);
  assert.match(controls.credentialError.textContent, /사이트 데이터 설정/);
  assert.equal(controls.credentialError.textContent.includes(API_KEY), false);
  assert.equal(controls.credentialStatus.textContent.includes(API_KEY), false);
});
