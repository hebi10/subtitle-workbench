import assert from 'node:assert/strict';
import test from 'node:test';

import * as credentialVaultModule from '../src/credential-vault.js';
import {
  ENCRYPTED_CREDENTIAL_KEY,
  LEGACY_CONNECTION_KEY,
  decryptApiKey,
  encryptApiKey,
  isWebCryptoAvailable,
  readEncryptedCredential,
  removeEncryptedCredential,
  removeLegacyPlaintextCredential,
  validateLocalPassphrase,
  writeEncryptedCredential,
} from '../src/credential-vault.js';

const API_KEY = 'sk-user-secret';
const PASSPHRASE = 'correct horse battery staple';
const DECRYPTION_ERROR = '로컬 암호가 맞지 않거나 저장 데이터가 손상되었습니다.';
const FORMAT_ERROR = '지원하지 않는 저장 형식입니다.';

class MemoryStorage {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.entries.has(key) ? this.entries.get(key) : null;
  }

  setItem(key, value) {
    this.entries.set(key, String(value));
  }

  removeItem(key) {
    this.entries.delete(key);
  }
}

function createValidRecord(overrides = {}) {
  return {
    version: 1,
    ciphertext: 'Tm90IGEgcmVhbCBjaXBoZXJ0ZXh0',
    salt: 'AAECAwQFBgcICQoLDA0ODw==',
    iv: 'EBESExQVFhcYGRob',
    ...overrides,
  };
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function createCryptoProvider({ decrypt = globalThis.crypto.subtle.decrypt.bind(globalThis.crypto.subtle) } = {}) {
  const subtle = globalThis.crypto.subtle;
  return {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    subtle: {
      importKey: subtle.importKey.bind(subtle),
      deriveKey: subtle.deriveKey.bind(subtle),
      encrypt: subtle.encrypt.bind(subtle),
      decrypt,
    },
  };
}

function makeBase64NonCanonical(value) {
  const replacementByCanonicalCharacter = {
    A: 'B',
    Q: 'R',
    g: 'h',
    w: 'x',
  };
  const characterIndex = value.length - 3;
  return [
    value.slice(0, characterIndex),
    replacementByCanonicalCharacter[value[characterIndex]],
    value.slice(characterIndex + 1),
  ].join('');
}

test('encryptApiKey uses fresh salt, IV, and ciphertext for every encryption', async () => {
  const first = await encryptApiKey(API_KEY, PASSPHRASE);
  const second = await encryptApiKey(API_KEY, PASSPHRASE);

  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test('encryptApiKey returns only the versioned encrypted record fields with required sizes', async () => {
  const record = await encryptApiKey(API_KEY, PASSPHRASE);

  assert.deepEqual(Object.keys(record).sort(), ['ciphertext', 'iv', 'salt', 'version']);
  assert.equal(record.version, 1);
  assert.equal(fromBase64(record.salt).byteLength, 16);
  assert.equal(fromBase64(record.iv).byteLength, 12);
});

test('encryptApiKey uses PBKDF2 SHA-256 with 310000 iterations and AES-GCM-256', async () => {
  let nextByte = 0;
  const deterministicCrypto = {
    subtle: globalThis.crypto.subtle,
    getRandomValues(target) {
      for (let index = 0; index < target.length; index += 1) {
        target[index] = nextByte;
        nextByte += 1;
      }
      return target;
    },
  };

  const record = await encryptApiKey(API_KEY, PASSPHRASE, deterministicCrypto);

  assert.deepEqual(record, {
    version: 1,
    ciphertext: 'NoITag2C0qbitobePNwDwQyW2bpPLwGVdiJhcGMM',
    salt: 'AAECAwQFBgcICQoLDA0ODw==',
    iv: 'EBESExQVFhcYGRob',
  });
});

test('decryptApiKey restores the original API key with the correct passphrase', async () => {
  const record = await encryptApiKey(API_KEY, PASSPHRASE);

  assert.equal(await decryptApiKey(record, PASSPHRASE), API_KEY);
});

test('the serialized encrypted record contains neither API key nor passphrase', async () => {
  const serialized = JSON.stringify(await encryptApiKey(API_KEY, PASSPHRASE));

  assert.equal(serialized.includes(API_KEY), false);
  assert.equal(serialized.includes(PASSPHRASE), false);
});

test('decryptApiKey hides native crypto errors when the passphrase is wrong', async () => {
  const record = await encryptApiKey(API_KEY, PASSPHRASE);

  await assert.rejects(
    decryptApiKey(record, 'wrong passphrase value'),
    { message: DECRYPTION_ERROR },
  );
});

test('decryptApiKey rejects unsupported versions and wrong record shapes', async () => {
  const invalidRecords = [
    createValidRecord({ version: 2 }),
    { version: 1, ciphertext: 'YQ==', salt: 'Yg==' },
    createValidRecord({ apiKey: API_KEY }),
    null,
  ];

  for (const record of invalidRecords) {
    await assert.rejects(decryptApiKey(record, PASSPHRASE), { message: FORMAT_ERROR });
  }
});

test('decryptApiKey rejects invalid Base64 before invoking AES-GCM', async () => {
  await assert.rejects(
    decryptApiKey(createValidRecord({ ciphertext: 'not base64!' }), PASSPHRASE),
    { message: DECRYPTION_ERROR },
  );
});

test('decryptApiKey rejects non-canonical Base64 before invoking AES-GCM', async () => {
  const record = await encryptApiKey(API_KEY, PASSPHRASE);
  let decryptCalls = 0;
  const observingCrypto = createCryptoProvider({
    decrypt(...args) {
      decryptCalls += 1;
      return globalThis.crypto.subtle.decrypt(...args);
    },
  });
  const nonCanonicalRecord = {
    ...record,
    salt: makeBase64NonCanonical(record.salt),
  };

  await assert.rejects(
    decryptApiKey(nonCanonicalRecord, PASSPHRASE, observingCrypto),
    { message: DECRYPTION_ERROR },
  );
  assert.equal(decryptCalls, 0);
});

test('decryptApiKey rejects an empty decrypted API key as damaged data', async () => {
  const record = await encryptApiKey(API_KEY, PASSPHRASE);
  const emptyDecryptCrypto = createCryptoProvider({
    async decrypt() {
      return new ArrayBuffer(0);
    },
  });

  await assert.rejects(
    decryptApiKey(record, PASSPHRASE, emptyDecryptCrypto),
    { message: DECRYPTION_ERROR },
  );
});

test('encryptApiKey rejects an empty API key with a stable message', async () => {
  await assert.rejects(
    encryptApiKey('   ', PASSPHRASE),
    { message: 'OpenAI API 키를 입력해 주세요.' },
  );
});

test('vault operations reject unavailable Web Crypto with a stable message', async () => {
  const message = '이 브라우저에서는 암호화 저장을 지원하지 않습니다.';

  assert.equal(isWebCryptoAvailable(null), false);
  assert.equal(isWebCryptoAvailable(globalThis.crypto), true);
  await assert.rejects(encryptApiKey(API_KEY, PASSPHRASE, null), { message });
  await assert.rejects(decryptApiKey(createValidRecord(), PASSPHRASE, null), { message });
});

test('validateLocalPassphrase requires at least 10 characters and matching confirmation', () => {
  assert.throws(
    () => validateLocalPassphrase('short', 'short'),
    { message: '로컬 암호는 10자 이상이어야 합니다.' },
  );
  assert.throws(
    () => validateLocalPassphrase('long enough', 'different value'),
    { message: '로컬 암호 확인이 일치하지 않습니다.' },
  );
  assert.equal(validateLocalPassphrase('long enough', 'long enough'), true);
});

test('encrypted credential storage round-trips only valid encrypted records', async () => {
  const storage = new MemoryStorage();
  const record = await encryptApiKey(API_KEY, PASSPHRASE);

  assert.equal(writeEncryptedCredential(storage, record), true);
  assert.deepEqual(readEncryptedCredential(storage), record);
  assert.equal(
    writeEncryptedCredential(storage, { ...record, apiKey: API_KEY }),
    false,
  );
  assert.deepEqual(readEncryptedCredential(storage), record);
});

test('writeEncryptedCredential ignores inherited toJSON serialization hooks', () => {
  const storage = new MemoryStorage();
  const record = Object.assign(
    Object.create({
      toJSON() {
        return { apiKey: API_KEY };
      },
    }),
    createValidRecord(),
  );

  assert.equal(writeEncryptedCredential(storage, record), true);
  const serialized = storage.getItem(ENCRYPTED_CREDENTIAL_KEY);
  assert.equal(serialized.includes(API_KEY), false);
  assert.deepEqual(JSON.parse(serialized), createValidRecord());
});

test('credential storage rejects ciphertext containing only the AES-GCM tag', () => {
  const tagOnlyRecord = createValidRecord({
    ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==',
  });
  const storage = new MemoryStorage({
    [ENCRYPTED_CREDENTIAL_KEY]: JSON.stringify(tagOnlyRecord),
  });

  assert.equal(writeEncryptedCredential(new MemoryStorage(), tagOnlyRecord), false);
  assert.equal(readEncryptedCredential(storage), null);
});

test('readEncryptedCredential returns null for malformed or invalid stored data', () => {
  const malformed = new MemoryStorage({ [ENCRYPTED_CREDENTIAL_KEY]: '{not-json' });
  const invalid = new MemoryStorage({
    [ENCRYPTED_CREDENTIAL_KEY]: JSON.stringify(createValidRecord({ version: 2 })),
  });

  assert.equal(readEncryptedCredential(malformed), null);
  assert.equal(readEncryptedCredential(invalid), null);
});

test('hasStoredEncryptedCredential distinguishes malformed stored data from absence', () => {
  const malformed = new MemoryStorage({ [ENCRYPTED_CREDENTIAL_KEY]: '{not-json' });
  const empty = new MemoryStorage({ [ENCRYPTED_CREDENTIAL_KEY]: '' });
  const absent = new MemoryStorage();

  assert.equal(credentialVaultModule.hasStoredEncryptedCredential(malformed), true);
  assert.equal(credentialVaultModule.hasStoredEncryptedCredential(empty), true);
  assert.equal(credentialVaultModule.hasStoredEncryptedCredential(absent), false);
});

test('hasStoredEncryptedCredential returns false when storage cannot be read', () => {
  const restrictedStorage = {
    getItem() {
      throw new Error(`blocked ${API_KEY}`);
    },
  };

  assert.equal(credentialVaultModule.hasStoredEncryptedCredential(restrictedStorage), false);
  assert.equal(credentialVaultModule.hasStoredEncryptedCredential(null), false);
});

test('encrypted credential storage helpers swallow storage access restrictions', () => {
  const restrictedStorage = {
    getItem() {
      throw new Error(`blocked ${API_KEY}`);
    },
    setItem() {
      throw new Error(`blocked ${API_KEY}`);
    },
    removeItem() {
      throw new Error(`blocked ${API_KEY}`);
    },
  };

  assert.equal(readEncryptedCredential(restrictedStorage), null);
  assert.equal(writeEncryptedCredential(restrictedStorage, createValidRecord()), false);
  assert.equal(removeEncryptedCredential(restrictedStorage), false);
});

test('removeEncryptedCredential removes only the encrypted credential key', () => {
  const storage = new MemoryStorage({
    [ENCRYPTED_CREDENTIAL_KEY]: JSON.stringify(createValidRecord()),
    unrelated: 'keep-me',
  });

  assert.equal(removeEncryptedCredential(storage), true);
  assert.equal(storage.getItem(ENCRYPTED_CREDENTIAL_KEY), null);
  assert.equal(storage.getItem('unrelated'), 'keep-me');
});

test('removeLegacyPlaintextCredential removes the legacy connection record', () => {
  const storage = new MemoryStorage({
    [LEGACY_CONNECTION_KEY]: JSON.stringify({ apiKey: API_KEY }),
    unrelated: 'keep-me',
  });

  assert.equal(removeLegacyPlaintextCredential(storage), true);
  assert.equal(storage.getItem(LEGACY_CONNECTION_KEY), null);
  assert.equal(storage.getItem('unrelated'), 'keep-me');
});
