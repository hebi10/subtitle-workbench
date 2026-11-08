import { isAbsolute } from 'node:path';

export const DEFAULT_LIMITS = Object.freeze({ requests: 100, audioSeconds: 3600, realtimeSeconds: 600, textChars: 60000 });
const QUOTA_SETTINGS = {
  requests: ['REVIEW_DAILY_REQUESTS', 1000], audioSeconds: ['REVIEW_DAILY_AUDIO_SECONDS', 86400],
  realtimeSeconds: ['REVIEW_DAILY_REALTIME_SECONDS', 3600], textChars: ['REVIEW_DAILY_TEXT_CHARS', 1000000]
};

export function loadConfig(env = process.env) {
  const fail = () => { throw new Error('Review relay configuration is missing or invalid.'); };
  if (env.REVIEW_RELAY_ENABLED !== 'true') fail();
  const accessCode = env.REVIEW_ACCESS_CODE || '';
  const apiKey = env.OPENAI_API_KEY || '';
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(accessCode) || accessCode.startsWith('sk-') || /change|example|placeholder/i.test(accessCode)
      || !/^sk-[A-Za-z0-9_-]{20,256}$/.test(apiKey) || /change|example|placeholder/i.test(apiKey)
      || !env.REVIEW_DB_PATH || !isAbsolute(env.REVIEW_DB_PATH)) fail();
  const limits = { ...DEFAULT_LIMITS };
  for (const [name, [variable, maximum]] of Object.entries(QUOTA_SETTINGS)) {
    if (env[variable] !== undefined && !/^[1-9]\d*$/.test(env[variable])) fail();
    if (env[variable] !== undefined) limits[name] = Number(env[variable]);
    if (!Number.isSafeInteger(limits[name]) || limits[name] < 1 || limits[name] > maximum) fail();
  }
  const translationModels = (env.REVIEW_TRANSLATION_MODELS || 'gpt-6-luna').split(',');
  if (translationModels.length > 4 || translationModels.some(model => !/^[A-Za-z0-9._:-]{1,100}$/.test(model))) fail();
  const port = env.PORT === undefined ? 8080 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail();
  return Object.freeze({ accessCode, apiKey, databasePath: env.REVIEW_DB_PATH, limits: Object.freeze(limits),
    translationModels: Object.freeze(translationModels), port, host: env.HOST || '127.0.0.1' });
}
