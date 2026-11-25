// Web-only local workspace storage. No credentials, connection settings, media or object URLs.
export const WORKSPACE_DB = 'subtitle-line-workspace';
const STORE = 'workspace';
const KEY = 'current';
const VERSION = 1;
const MAX_CHARS = 8 * 1024 * 1024;
const STATUSES = new Set(['transcribed', 'translated', 'failed', 'edited', 'skipped']);

function invalid() { return new Error('Invalid or oversized workspace data'); }
function text(value, max) {
  if (typeof value !== 'string' || value.length > max) throw invalid();
  return value;
}
function number(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid();
  return value;
}
function cueRecord(cue) {
  if (!cue || typeof cue !== 'object') throw invalid();
  const start = number(cue.start, NaN), end = number(cue.end, NaN);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw invalid();
  const result = { start, end, original: text(cue.original ?? '', 20000), translated: text(cue.translated ?? '', 20000) };
  if (STATUSES.has(cue.status)) result.status = cue.status;
  if (cue.status === 'failed') result.translationError = '번역 결과를 확인하고 다시 시도해 주세요.';
  if (typeof cue.speaker === 'string') result.speaker = text(cue.speaker, 512);
  if (typeof cue.speakerScope === 'string') result.speakerScope = text(cue.speakerScope, 512);
  else if (typeof cue.speakerScope === 'number' && Number.isFinite(cue.speakerScope)) result.speakerScope = cue.speakerScope;
  if (cue.timingAccuracy === 'estimated') result.timingAccuracy = 'estimated';
  return result;
}
function entryRecord(entry) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.subtitles) || entry.subtitles.length > 100000) throw invalid();
  const id = text(entry.id, 32);
  if (!/^[1-9]\d{0,14}$/.test(id)) throw invalid();
  const translationPending = entry.translationPending === true;
  const result = {
    id, fileName: text(entry.fileName, 1024), fileSize: number(entry.fileSize),
    duration: number(entry.duration), createdAt: text(entry.createdAt, 100),
    subtitles: entry.subtitles.map(cueRecord), offsetSeconds: number(entry.offsetSeconds),
    outputLanguage: text(entry.outputLanguage ?? 'original', 128), translationPending,
  };
  if (entry.translationSettings || translationPending) {
    const settings = entry.translationSettings;
    if (!settings || typeof settings !== 'object') throw invalid();
    const maxSubtitleChars = number(settings.maxSubtitleChars, 42);
    if (maxSubtitleChars <= 0) throw invalid();
    result.translationSettings = { targetLanguage: text(settings.targetLanguage, 128), maxSubtitleChars };
  }
  return result;
}

export function createWorkspaceSnapshot(entries, activeId) {
  if (!Array.isArray(entries) || entries.length > 200) throw invalid();
  const records = entries.map(entryRecord);
  const ids = new Set(records.map(entry => entry.id));
  if (ids.size !== records.length || (activeId != null && !ids.has(activeId))) throw invalid();
  const snapshot = { entries: records, activeId: activeId ?? records.at(-1)?.id ?? null };
  if (JSON.stringify(snapshot).length > MAX_CHARS) throw invalid();
  return snapshot;
}

function decodeRecord(record) {
  if (record === undefined) return { revision: 0, data: null };
  if (!record || record.version !== VERSION || !Number.isSafeInteger(record.revision) || record.revision <= 0) throw invalid();
  if (record.data === null) return { revision: record.revision, data: null };
  if (!record.data || !Array.isArray(record.data.entries)) throw invalid();
  return { revision: record.revision, data: createWorkspaceSnapshot(record.data.entries, record.data.activeId) };
}

export class WorkspaceConflict extends Error {
  constructor() { super('Workspace changed in another tab'); this.name = 'WorkspaceConflict'; }
}

function openDatabase(factory) {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('IndexedDB unavailable')); return; }
    let rejected = false;
    const request = factory.open(WORKSPACE_DB, VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onblocked = () => { rejected = true; reject(new Error('Workspace database blocked')); };
    request.onerror = () => reject(request.error || new Error('Workspace database unavailable'));
    request.onsuccess = () => {
      const db = request.result;
      if (rejected) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

export async function readWorkspace(factory = globalThis.indexedDB) {
  const db = await openDatabase(factory);
  try {
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error || new Error('Workspace read failed'));
      tx.onerror = () => reject(tx.error || new Error('Workspace read failed'));
    });
    return decodeRecord(record);
  } finally { db.close(); }
}

export async function writeWorkspace(expectedRevision, data, factory = globalThis.indexedDB) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw invalid();
  const snapshot = data === null ? null : createWorkspaceSnapshot(data.entries, data.activeId);
  const db = await openDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(STORE, 'readwrite', { durability: 'strict' }); }
      catch (error) {
        if (!(error instanceof TypeError)) throw error;
        tx = db.transaction(STORE, 'readwrite');
      }
      let failure;
      const revision = expectedRevision + 1;
      const store = tx.objectStore(STORE);
      const req = store.get(KEY);
      req.onsuccess = () => {
        try {
          if (decodeRecord(req.result).revision !== expectedRevision) throw new WorkspaceConflict();
          store.put({ version: VERSION, revision, data: snapshot }, KEY);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(revision);
      tx.onabort = () => reject(failure || tx.error || new Error('Workspace write failed'));
      tx.onerror = () => { /* Transaction abort reports the failure. */ };
    });
  } finally { db.close(); }
}
