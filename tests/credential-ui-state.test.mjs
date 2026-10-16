import assert from 'node:assert/strict';
import test from 'node:test';

import * as credentialUiStateModule from '../src/credential-ui-state.js';
import {
  getCredentialUiState,
  getStartRequirement,
} from '../src/credential-ui-state.js';

test('getConnectionControlState locks mutable connection controls during credential work', () => {
  assert.deepEqual(
    credentialUiStateModule.getConnectionControlState({
      isBusy: false,
      credentialBusy: true,
      connectionMode: 'worker',
    }),
    {
      apiKeyDisabled: true,
      connectionModeDisabled: true,
      proxyUrlDisabled: true,
    },
  );
});

test('getConnectionControlState preserves pipeline busy locking', () => {
  assert.deepEqual(
    credentialUiStateModule.getConnectionControlState({
      isBusy: true,
      credentialBusy: false,
      connectionMode: 'worker',
    }),
    {
      apiKeyDisabled: true,
      connectionModeDisabled: true,
      proxyUrlDisabled: true,
    },
  );
});

test('getConnectionControlState enables idle Worker controls and keeps browser proxy disabled', () => {
  assert.deepEqual(
    credentialUiStateModule.getConnectionControlState({
      isBusy: false,
      credentialBusy: false,
      connectionMode: 'worker',
    }),
    {
      apiKeyDisabled: false,
      connectionModeDisabled: false,
      proxyUrlDisabled: false,
    },
  );
  assert.deepEqual(
    credentialUiStateModule.getConnectionControlState({
      isBusy: false,
      credentialBusy: false,
      connectionMode: 'browser',
    }),
    {
      apiKeyDisabled: false,
      connectionModeDisabled: false,
      proxyUrlDisabled: true,
    },
  );
});

test('getCredentialUiState returns the empty compatible state for a fresh browser', () => {
  assert.deepEqual(
    getCredentialUiState({
      hasEncryptedCredential: false,
      isUnlocked: false,
      rememberCredential: false,
      cryptoAvailable: true,
    }),
    {
      showPassphraseFields: false,
      showConfirmationField: false,
      showSaveButton: false,
      showUnlockButton: false,
      showDeleteButton: false,
      rememberDisabled: false,
      status: '',
    },
  );
});

test('getCredentialUiState shows save controls only when encrypted saving is selected', () => {
  assert.deepEqual(
    getCredentialUiState({
      hasEncryptedCredential: false,
      isUnlocked: false,
      rememberCredential: true,
      cryptoAvailable: true,
    }),
    {
      showPassphraseFields: true,
      showConfirmationField: true,
      showSaveButton: true,
      showUnlockButton: false,
      showDeleteButton: false,
      rememberDisabled: false,
      status: '',
    },
  );
});

test('getCredentialUiState shows unlock and delete controls for a locked stored credential', () => {
  assert.deepEqual(
    getCredentialUiState({
      hasEncryptedCredential: true,
      isUnlocked: false,
      rememberCredential: false,
      cryptoAvailable: true,
    }),
    {
      showPassphraseFields: true,
      showConfirmationField: false,
      showSaveButton: false,
      showUnlockButton: true,
      showDeleteButton: true,
      rememberDisabled: false,
      status: '암호화된 API 키가 이 기기에 저장되어 있습니다.',
    },
  );
});

test('getCredentialUiState keeps only delete available for an unlocked stored credential', () => {
  assert.deepEqual(
    getCredentialUiState({
      hasEncryptedCredential: true,
      isUnlocked: true,
      rememberCredential: false,
      cryptoAvailable: true,
    }),
    {
      showPassphraseFields: false,
      showConfirmationField: false,
      showSaveButton: false,
      showUnlockButton: false,
      showDeleteButton: true,
      rememberDisabled: false,
      status: '암호화된 API 키의 잠금을 해제했습니다.',
    },
  );
});

test('getCredentialUiState reports unsupported crypto without stored data', () => {
  assert.deepEqual(
    getCredentialUiState({
      hasEncryptedCredential: false,
      isUnlocked: false,
      rememberCredential: false,
      cryptoAvailable: false,
    }),
    {
      showPassphraseFields: false,
      showConfirmationField: false,
      showSaveButton: false,
      showUnlockButton: false,
      showDeleteButton: false,
      rememberDisabled: true,
      status: '이 브라우저에서는 API 키 암호화 저장을 지원하지 않습니다.',
    },
  );
});

test('getCredentialUiState keeps delete available when stored data cannot be unlocked', () => {
  assert.deepEqual(
    getCredentialUiState({
      hasEncryptedCredential: true,
      isUnlocked: false,
      rememberCredential: false,
      cryptoAvailable: false,
    }),
    {
      showPassphraseFields: false,
      showConfirmationField: false,
      showSaveButton: false,
      showUnlockButton: false,
      showDeleteButton: true,
      rememberDisabled: true,
      status: '저장된 API 키가 있지만 이 브라우저에서는 잠금을 해제할 수 없습니다.',
    },
  );
});

test('getStartRequirement asks for a source file first', () => {
  assert.equal(
    getStartRequirement({
      hasFile: false,
      hasDuration: false,
      hasApiKey: false,
      connectionMode: 'worker',
      proxyUrl: '',
    }),
    '영상 또는 오디오 파일을 선택해 주세요.',
  );
});

test('getStartRequirement reports an invalid duration before credential requirements', () => {
  assert.equal(
    getStartRequirement({
      hasFile: true,
      hasDuration: false,
      hasApiKey: false,
      connectionMode: 'worker',
      proxyUrl: '',
    }),
    '영상 길이를 확인할 수 없습니다.',
  );
});

test('getStartRequirement rejects missing and whitespace-only API keys', () => {
  assert.equal(
    getStartRequirement({
      hasFile: true,
      hasDuration: true,
      hasApiKey: false,
      connectionMode: 'browser',
      proxyUrl: '',
    }),
    'OpenAI API 키를 입력해 주세요.',
  );
  assert.equal(
    getStartRequirement({
      hasFile: true,
      hasDuration: true,
      hasApiKey: '   ',
      connectionMode: 'worker',
      proxyUrl: 'https://worker.example',
    }),
    'OpenAI API 키를 입력해 주세요.',
  );
});

test('getStartRequirement rejects missing and whitespace-only Worker URLs', () => {
  assert.equal(
    getStartRequirement({
      hasFile: true,
      hasDuration: true,
      hasApiKey: true,
      connectionMode: 'worker',
      proxyUrl: '',
    }),
    'Worker 프록시 URL을 입력해 주세요.',
  );
  assert.equal(
    getStartRequirement({
      hasFile: true,
      hasDuration: true,
      hasApiKey: 'sk-test',
      connectionMode: 'worker',
      proxyUrl: '   ',
    }),
    'Worker 프록시 URL을 입력해 주세요.',
  );
});

test('getStartRequirement returns empty when Worker requirements are met', () => {
  assert.equal(
    getStartRequirement({
      hasFile: true,
      hasDuration: true,
      hasApiKey: 'sk-test',
      connectionMode: 'worker',
      proxyUrl: 'https://worker.example',
    }),
    '',
  );
});

test('getStartRequirement treats unknown modes as browser mode', () => {
  assert.equal(
    getStartRequirement({
      hasFile: true,
      hasDuration: true,
      hasApiKey: true,
      connectionMode: 'unexpected',
      proxyUrl: '',
    }),
    '',
  );
});
