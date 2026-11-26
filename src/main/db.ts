import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { safeStorage } from 'electron';
import type { Job } from '@shared/types';

/*
 * SQLite store for jobs and settings, main process only.
 * Uses the SQLite built into Electron's Node runtime (node:sqlite), so there is no
 * native module to rebuild per Electron version and platform.
 */

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     secret BLOB,
     status TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`
];

export class Db {
  private db: DatabaseSync;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'downloader.db'));
    this.db.exec('PRAGMA journal_mode = WAL');
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let v = row.user_version; v < MIGRATIONS.length; v++) {
      this.db.exec(MIGRATIONS[v]);
      this.db.exec(`PRAGMA user_version = ${v + 1}`);
    }
  }

  loadJobs(): Job[] {
    const rows = this.db.prepare('SELECT data, secret FROM jobs ORDER BY created_at').all() as {
      data: string;
      secret: Uint8Array | null;
    }[];
    return rows.map((r) => {
      const job = JSON.parse(r.data) as Job;
      const headers = decryptHeaders(r.secret);
      if (headers) job.options = { ...job.options, headers };
      return job;
    });
  }

  saveJob(job: Job): void {
    // Custom headers can hold cookies or Authorization: keep them out of the plain JSON.
    const { headers, ...rest } = job.options;
    const data = JSON.stringify({ ...job, options: rest, speed: 0, uploadSpeed: 0, eta: null });
    const secret = headers?.length ? encryptHeaders(headers) : null;
    this.db
      .prepare(
        `INSERT INTO jobs (id, data, secret, status, created_at, updated_at)
         VALUES (:id, :data, :secret, :status, :created, :updated)
         ON CONFLICT(id) DO UPDATE SET data = :data, secret = :secret, status = :status, updated_at = :updated`
      )
      .run({ id: job.id, data, secret, status: job.status, created: job.createdAt, updated: job.updatedAt });
  }

  saveJobs(jobs: Job[]): void {
    this.db.exec('BEGIN');
    try {
      jobs.forEach((j) => this.saveJob(j));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  deleteJob(id: string): void {
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  }

  getSetting<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  close(): void {
    this.db.close();
  }
}

function encryptHeaders(headers: string[]): Buffer | null {
  if (!safeStorage.isEncryptionAvailable()) return null; // never store secrets in plain text
  return safeStorage.encryptString(JSON.stringify(headers));
}

function decryptHeaders(secret: Uint8Array | null): string[] | undefined {
  if (!secret || !safeStorage.isEncryptionAvailable()) return undefined;
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(secret))) as string[];
  } catch {
    return undefined;
  }
}
