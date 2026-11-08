import { DatabaseSync } from 'node:sqlite';
import { RelayError } from './errors.mjs';

const DIMENSIONS = ['requests', 'audioSeconds', 'realtimeSeconds', 'textChars'];

export class Quota {
  constructor(path, limits, clock = () => new Date()) {
    if (DIMENSIONS.some(key => !Number.isSafeInteger(limits[key]) || limits[key] < 1)) throw new Error('Invalid quota limits');
    this.limits = limits;
    this.clock = clock;
    this.closed = false;
    try {
      this.db = new DatabaseSync(path);
      this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      this.db.exec(`CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0,
        audioSeconds INTEGER NOT NULL DEFAULT 0, realtimeSeconds INTEGER NOT NULL DEFAULT 0, textChars INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), latest_day TEXT NOT NULL);`);
    } catch {
      this.db?.close();
      throw new Error('Quota storage unavailable');
    }
  }

  reserve(amount) {
    if (Object.keys(amount).some(key => !DIMENSIONS.includes(key)) || DIMENSIONS.some(key =>
      amount[key] !== undefined && (!Number.isSafeInteger(amount[key]) || amount[key] < 0))) throw new Error('Invalid quota reservation');
    let transaction = false;
    try {
      this.db.exec('BEGIN IMMEDIATE'); transaction = true;
      const current = this.clock().toISOString().slice(0, 10);
      const previous = this.db.prepare('SELECT latest_day FROM state WHERE id = 1').get()?.latest_day;
      const day = previous && previous > current ? previous : current;
      this.db.prepare('INSERT INTO state(id, latest_day) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET latest_day = excluded.latest_day').run(day);
      this.db.prepare('INSERT OR IGNORE INTO usage(day) VALUES (?)').run(day);
      const used = this.db.prepare('SELECT * FROM usage WHERE day = ?').get(day);
      const next = DIMENSIONS.map(key => used[key] + (amount[key] || 0));
      if (DIMENSIONS.some((key, i) => next[i] > this.limits[key])) throw new RelayError(429, 'insufficient_quota');
      this.db.prepare('UPDATE usage SET requests = ?, audioSeconds = ?, realtimeSeconds = ?, textChars = ? WHERE day = ?').run(...next, day);
      this.db.exec('COMMIT'); transaction = false;
    } catch (error) {
      if (transaction) { try { this.db.exec('ROLLBACK'); } catch { /* Fail closed below. */ } }
      if (error instanceof RelayError) throw error;
      throw new RelayError(503, 'quota_storage_unavailable');
    }
  }

  close() { if (!this.closed) { this.closed = true; this.db.close(); } }
}
