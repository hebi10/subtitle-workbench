import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONNECTION_SETTINGS_KEY,
  normalizeConnectionSettings,
  readConnectionSettings,
  writeConnectionSettings,
} from '../src/connection-settings.js';

const SECRET_API_KEY = 'sk-must-not-persist';

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
}

test('worker connection settings trim and persist the Worker URL', () => {
  const storage = new MemoryStorage();

  assert.equal(
    writeConnectionSettings(storage, {
      connectionMode: 'worker',
      proxyUrl: '  https://worker.example.test/api  ',
    }),
    true,
  );
  assert.deepEqual(readConnectionSettings(storage), {
    connectionMode: 'worker',
    proxyUrl: 'https://worker.example.test/api',
  });
});

test('connection settings never return or serialize an API key', () => {
  const storage = new MemoryStorage();
  const settings = {
    connectionMode: 'worker',
    proxyUrl: 'https://worker.example.test/api',
    apiKey: SECRET_API_KEY,
  };

  assert.deepEqual(normalizeConnectionSettings(settings), {
    connectionMode: 'worker',
    proxyUrl: 'https://worker.example.test/api',
  });
  writeConnectionSettings(storage, settings);

  const serialized = storage.getItem(CONNECTION_SETTINGS_KEY);
  assert.equal(serialized.includes(SECRET_API_KEY), false);
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), ['connectionMode', 'proxyUrl']);
});

test('browser connection settings always store an empty Worker URL', () => {
  const storage = new MemoryStorage();

  writeConnectionSettings(storage, {
    connectionMode: 'browser',
    proxyUrl: 'https://must-be-discarded.example.test',
  });

  assert.deepEqual(readConnectionSettings(storage), {
    connectionMode: 'browser',
    proxyUrl: '',
  });
});

test('unknown connection modes normalize to secure Worker mode', () => {
  assert.deepEqual(
    normalizeConnectionSettings({
      connectionMode: 'unexpected',
      proxyUrl: '  https://worker.example.test/default  ',
    }),
    {
      connectionMode: 'worker',
      proxyUrl: 'https://worker.example.test/default',
    },
  );
});

test('readConnectionSettings returns null for missing or malformed stored JSON', () => {
  const missing = new MemoryStorage();
  const malformed = new MemoryStorage({ [CONNECTION_SETTINGS_KEY]: '{not-json' });

  assert.equal(readConnectionSettings(missing), null);
  assert.equal(readConnectionSettings(malformed), null);
});

test('connection settings storage restrictions are swallowed without leaking input values', () => {
  const restrictedStorage = {
    getItem() {
      throw new Error(`blocked ${SECRET_API_KEY}`);
    },
    setItem() {
      throw new Error(`blocked ${SECRET_API_KEY}`);
    },
  };
  const settings = {
    connectionMode: 'worker',
    proxyUrl: `https://${SECRET_API_KEY}.example.test`,
    apiKey: SECRET_API_KEY,
  };

  assert.equal(writeConnectionSettings(restrictedStorage, settings), false);
  assert.equal(readConnectionSettings(restrictedStorage), null);
});
