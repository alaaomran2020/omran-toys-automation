import type { Db } from '../database.js';

/**
 * Webhook retry protection: Telegram may redeliver the same update
 * (timeout, network retry). Each update_id is processed exactly once.
 */
export function isUpdateProcessed(db: Db, updateId: number): boolean {
  const row = db.prepare('SELECT update_id FROM webhook_updates WHERE update_id = ?').get(updateId);
  return row !== undefined && row !== null;
}

export function markUpdateProcessed(db: Db, updateId: number): void {
  db.prepare('INSERT OR IGNORE INTO webhook_updates (update_id) VALUES (?)').run(updateId);
  // Prune entries older than 24h (keeps the table tiny; cheap indexed scan).
  db.prepare("DELETE FROM webhook_updates WHERE received_at < datetime('now', '-1 day')").run();
}
