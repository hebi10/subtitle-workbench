export const CONNECTION_SETTINGS_KEY = 'aiSubtitleGenerator.connectionSettings.v1';

export function normalizeConnectionSettings({
  connectionMode,
  proxyUrl,
} = {}) {
  const normalizedMode = connectionMode === 'browser' ? 'browser' : 'worker';

  return {
    connectionMode: normalizedMode,
    proxyUrl: normalizedMode === 'browser'
      ? ''
      : typeof proxyUrl === 'string'
        ? proxyUrl.trim()
        : '',
  };
}

export function readConnectionSettings(storage) {
  try {
    const serialized = storage?.getItem(CONNECTION_SETTINGS_KEY);
    if (!serialized) {
      return null;
    }
    const storedSettings = JSON.parse(serialized);
    if (!storedSettings || typeof storedSettings !== 'object' || Array.isArray(storedSettings)) {
      return null;
    }
    return normalizeConnectionSettings(storedSettings);
  } catch {
    return null;
  }
}

export function writeConnectionSettings(storage, settings) {
  try {
    const normalizedSettings = normalizeConnectionSettings(settings);
    storage?.setItem(CONNECTION_SETTINGS_KEY, JSON.stringify(normalizedSettings));
    return Boolean(storage);
  } catch {
    return false;
  }
}
