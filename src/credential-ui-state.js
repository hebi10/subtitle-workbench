export function getCredentialUiState({
  hasEncryptedCredential = false,
  isUnlocked = false,
  rememberCredential = false,
  cryptoAvailable = false,
} = {}) {
  const canUseCrypto = Boolean(cryptoAvailable);
  const hasStoredCredential = Boolean(hasEncryptedCredential);
  const unlocked = Boolean(isUnlocked);
  const shouldSave = Boolean(rememberCredential);

  return {
    showPassphraseFields: canUseCrypto && (shouldSave || (hasStoredCredential && !unlocked)),
    showConfirmationField: canUseCrypto && shouldSave,
    showSaveButton: canUseCrypto && shouldSave,
    showUnlockButton: canUseCrypto && hasStoredCredential && !unlocked,
    showDeleteButton: hasStoredCredential,
    rememberDisabled: !canUseCrypto,
    status: getCredentialStatus({
      hasStoredCredential,
      unlocked,
      canUseCrypto,
    }),
  };
}

export function getConnectionControlState({
  isBusy = false,
  credentialBusy = false,
  connectionMode,
} = {}) {
  const controlsDisabled = Boolean(isBusy) || Boolean(credentialBusy);

  return {
    apiKeyDisabled: controlsDisabled,
    connectionModeDisabled: controlsDisabled,
    proxyUrlDisabled: controlsDisabled || connectionMode !== 'worker',
  };
}

export function getStartRequirement({
  hasFile = false,
  hasDuration = false,
  hasApiKey = false,
  connectionMode,
  proxyUrl,
} = {}) {
  if (!hasFile) {
    return '영상 또는 오디오 파일을 선택해 주세요.';
  }
  if (!hasDuration) {
    return '영상 길이를 확인할 수 없습니다.';
  }
  if (!hasMeaningfulValue(hasApiKey)) {
    return 'OpenAI API 키를 입력해 주세요.';
  }
  if (connectionMode === 'worker' && !hasMeaningfulValue(proxyUrl)) {
    return 'Worker 프록시 URL을 입력해 주세요.';
  }
  return '';
}

function getCredentialStatus({
  hasStoredCredential,
  unlocked,
  canUseCrypto,
}) {
  if (unlocked) {
    return '암호화된 API 키의 잠금을 해제했습니다.';
  }
  if (hasStoredCredential && canUseCrypto) {
    return '암호화된 API 키가 이 기기에 저장되어 있습니다.';
  }
  if (hasStoredCredential) {
    return '저장된 API 키가 있지만 이 브라우저에서는 잠금을 해제할 수 없습니다.';
  }
  if (!canUseCrypto) {
    return '이 브라우저에서는 API 키 암호화 저장을 지원하지 않습니다.';
  }
  return '';
}

function hasMeaningfulValue(value) {
  return typeof value === 'string'
    ? value.trim().length > 0
    : Boolean(value);
}
