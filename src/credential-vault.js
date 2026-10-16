export const ENCRYPTED_CREDENTIAL_KEY = 'aiSubtitleGenerator.encryptedCredential.v1';
export const LEGACY_CONNECTION_KEY = 'aiSubtitleGenerator.connection';

const PBKDF2_ITERATIONS = 310000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const CRYPTO_UNAVAILABLE_ERROR = '이 브라우저에서는 암호화 저장을 지원하지 않습니다.';
const EMPTY_API_KEY_ERROR = 'OpenAI API 키를 입력해 주세요.';
const PASSPHRASE_LENGTH_ERROR = '로컬 암호는 10자 이상이어야 합니다.';
const PASSPHRASE_MISMATCH_ERROR = '로컬 암호 확인이 일치하지 않습니다.';
const FORMAT_ERROR = '지원하지 않는 저장 형식입니다.';
const DECRYPTION_ERROR = '로컬 암호가 맞지 않거나 저장 데이터가 손상되었습니다.';
const RECORD_KEYS = ['ciphertext', 'iv', 'salt', 'version'];
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function isWebCryptoAvailable(cryptoProvider = globalThis.crypto) {
  try {
    return Boolean(
      cryptoProvider
      && typeof cryptoProvider.getRandomValues === 'function'
      && cryptoProvider.subtle
      && typeof cryptoProvider.subtle.importKey === 'function'
      && typeof cryptoProvider.subtle.deriveKey === 'function'
      && typeof cryptoProvider.subtle.encrypt === 'function'
      && typeof cryptoProvider.subtle.decrypt === 'function'
    );
  } catch {
    return false;
  }
}

export function validateLocalPassphrase(passphrase, confirmation) {
  assertPassphraseLength(passphrase);
  if (passphrase !== confirmation) {
    throw new Error(PASSPHRASE_MISMATCH_ERROR);
  }
  return true;
}

export async function encryptApiKey(
  apiKey,
  passphrase,
  cryptoProvider = globalThis.crypto,
) {
  assertCryptoAvailable(cryptoProvider);
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error(EMPTY_API_KEY_ERROR);
  }
  validateLocalPassphrase(passphrase, passphrase);

  const salt = cryptoProvider.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = cryptoProvider.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveEncryptionKey(passphrase, salt, cryptoProvider);
  const ciphertext = await cryptoProvider.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(apiKey),
  );

  return {
    version: 1,
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
  };
}

export async function decryptApiKey(
  record,
  passphrase,
  cryptoProvider = globalThis.crypto,
) {
  assertCryptoAvailable(cryptoProvider);
  assertPassphraseLength(passphrase);
  assertRecordShape(record);

  let ciphertext;
  let salt;
  let iv;
  try {
    ciphertext = base64ToBytes(record.ciphertext);
    salt = base64ToBytes(record.salt);
    iv = base64ToBytes(record.iv);
    if (ciphertext.byteLength <= 16 || salt.byteLength !== SALT_BYTES || iv.byteLength !== IV_BYTES) {
      throw new Error(DECRYPTION_ERROR);
    }
  } catch {
    throw new Error(DECRYPTION_ERROR);
  }

  try {
    const key = await deriveEncryptionKey(passphrase, salt, cryptoProvider);
    const plaintext = await cryptoProvider.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );
    const apiKey = textDecoder.decode(plaintext);
    if (apiKey.length === 0) {
      throw new Error(DECRYPTION_ERROR);
    }
    return apiKey;
  } catch {
    throw new Error(DECRYPTION_ERROR);
  }
}

export function readEncryptedCredential(storage) {
  try {
    const serialized = storage?.getItem(ENCRYPTED_CREDENTIAL_KEY);
    if (!serialized) {
      return null;
    }
    const record = JSON.parse(serialized);
    assertRecordShape(record);
    const ciphertext = base64ToBytes(record.ciphertext);
    const salt = base64ToBytes(record.salt);
    const iv = base64ToBytes(record.iv);
    if (ciphertext.byteLength <= 16 || salt.byteLength !== SALT_BYTES || iv.byteLength !== IV_BYTES) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export function hasStoredEncryptedCredential(storage) {
  try {
    return storage?.getItem(ENCRYPTED_CREDENTIAL_KEY) != null;
  } catch {
    return false;
  }
}

export function writeEncryptedCredential(storage, record) {
  try {
    assertRecordShape(record);
    const ciphertext = base64ToBytes(record.ciphertext);
    const salt = base64ToBytes(record.salt);
    const iv = base64ToBytes(record.iv);
    if (ciphertext.byteLength <= 16 || salt.byteLength !== SALT_BYTES || iv.byteLength !== IV_BYTES) {
      return false;
    }
    const serializedRecord = {
      version: record.version,
      ciphertext: record.ciphertext,
      salt: record.salt,
      iv: record.iv,
    };
    storage?.setItem(ENCRYPTED_CREDENTIAL_KEY, JSON.stringify(serializedRecord));
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function removeEncryptedCredential(storage) {
  try {
    storage?.removeItem(ENCRYPTED_CREDENTIAL_KEY);
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function removeLegacyPlaintextCredential(storage) {
  try {
    storage?.removeItem(LEGACY_CONNECTION_KEY);
    return Boolean(storage);
  } catch {
    return false;
  }
}

function assertCryptoAvailable(cryptoProvider) {
  if (!isWebCryptoAvailable(cryptoProvider)) {
    throw new Error(CRYPTO_UNAVAILABLE_ERROR);
  }
}

function assertPassphraseLength(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 10) {
    throw new Error(PASSPHRASE_LENGTH_ERROR);
  }
}

function assertRecordShape(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(FORMAT_ERROR);
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== RECORD_KEYS.length
    || keys.some((key, index) => key !== RECORD_KEYS[index])
    || record.version !== 1
    || typeof record.ciphertext !== 'string'
    || typeof record.salt !== 'string'
    || typeof record.iv !== 'string'
  ) {
    throw new Error(FORMAT_ERROR);
  }
}

async function deriveEncryptionKey(passphrase, salt, cryptoProvider) {
  const material = await cryptoProvider.subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return cryptoProvider.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  if (!value || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throw new Error(DECRYPTION_ERROR);
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64(bytes) !== value) {
    throw new Error(DECRYPTION_ERROR);
  }
  return bytes;
}
