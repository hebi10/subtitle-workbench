import { getConnectionControlState } from './credential-ui-state.js';

const CURRENT_TAB_NOTICE = 'API 키는 저장하지 않고 현재 탭에서만 사용합니다. 새로고침 후 다시 입력해 주세요.';
const LEGACY_STORAGE_KEYS = [
  'aiSubtitleGenerator.encryptedCredential.v1',
  'aiSubtitleGenerator.connection',
];

export function createCredentialController({
  controls,
  storage,
  getConnectionMode = () => 'worker',
  isPipelineBusy = () => false,
  onStateChange = () => {},
} = {}) {
  let status = CURRENT_TAB_NOTICE;

  function initialize() {
    status = CURRENT_TAB_NOTICE;
    render();
    return getState();
  }

  function render() {
    const busy = Boolean(isPipelineBusy());
    const connection = getConnectionControlState({
      isBusy: busy,
      credentialBusy: false,
      connectionMode: getConnectionMode(),
    });
    controls.apiKey.disabled = connection.apiKeyDisabled;
    controls.proxyUrl.disabled = connection.proxyUrlDisabled;
    for (const input of controls.connectionModeInputs) {
      input.disabled = connection.connectionModeDisabled;
    }
    controls.rememberCredentials.checked = false;
    controls.rememberCredentials.disabled = true;
    controls.credentialPassphraseFields.hidden = true;
    controls.localPassphraseConfirmationField.hidden = true;
    controls.localPassphrase.value = '';
    controls.localPassphraseConfirmation.value = '';
    controls.localPassphrase.disabled = true;
    controls.localPassphraseConfirmation.disabled = true;
    controls.saveCredentialButton.hidden = true;
    controls.saveCredentialButton.disabled = true;
    controls.unlockCredentialButton.hidden = true;
    controls.unlockCredentialButton.disabled = true;
    // Keep cleanup available without inspecting whether a saved key exists.
    controls.deleteCredentialButton.hidden = false;
    controls.deleteCredentialButton.disabled = busy;
    controls.credentialStatus.textContent = status;
  }

  function getState() {
    return {
      credentialBusy: false,
      hasEncryptedCredential: false,
      cryptoAvailable: false,
      isUnlocked: false,
    };
  }

  function getActiveApiKey() {
    return String(controls.apiKey.value ?? '').trim();
  }

  // Retained for existing event bindings; persistence and decryption are disabled.
  async function save() {
    return false;
  }

  async function unlock() {
    return false;
  }

  function deleteCredential() {
    if (isPipelineBusy()) {
      return false;
    }
    try {
      if (typeof storage?.removeItem !== 'function') {
        throw new Error('Storage cleanup unavailable');
      }
      for (const key of LEGACY_STORAGE_KEYS) {
        storage.removeItem(key);
      }
      controls.credentialError.textContent = '';
      controls.credentialError.hidden = true;
      status = '이전 버전에서 저장한 키 정보를 삭제했습니다. ' + CURRENT_TAB_NOTICE;
      render();
      onStateChange();
      return true;
    } catch {
      controls.credentialError.textContent = '기존 저장 키를 삭제하지 못했습니다. 브라우저의 사이트 데이터 설정에서 삭제해 주세요.';
      controls.credentialError.hidden = false;
      return false;
    }
  }

  return {
    deleteCredential,
    getActiveApiKey,
    getState,
    initialize,
    render,
    save,
    unlock,
  };
}
