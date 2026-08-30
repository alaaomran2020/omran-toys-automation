/**
 * Database bootstrap using the built-in `node:sqlite` module (Node >= 22.5).
 *
 * Zero-infrastructure choice: a single SQLite file, WAL mode, foreign keys on.
 * This is NOT a copy of the store database — it only holds automation state
 * (users, conversation state, drafts, logs).
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MIGRATIONS } from './migrations.js';

export type Db = DatabaseSync;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  const rows = db.prepare('SELECT name FROM schema_migrations').all() as Array<Record<string, unknown>>;
  const applied = new Set(rows.map((r) => String(r.name)));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(migration.name);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
