import type { Db } from '../database.js';

export interface TelegramUser {
  id: number;
  telegramUserId: number;
  username: string | null;
  role: 'employee' | 'admin';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapUser(row: Record<string, unknown>): TelegramUser {
  return {
    id: Number(row.id),
    telegramUserId: Number(row.telegram_user_id),
    username: (row.username as string | null) ?? null,
    role: (row.role as TelegramUser['role']) ?? 'employee',
    isActive: Number(row.is_active) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function upsertTelegramUser(db: Db, telegramUserId: number, username?: string | null): TelegramUser {
  db.prepare(
    `INSERT INTO telegram_users (telegram_user_id, username)
     VALUES (?, ?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET
       username = COALESCE(excluded.username, telegram_users.username),
       updated_at = datetime('now')`,
  ).run(telegramUserId, username ?? null);
  const row = db.prepare('SELECT * FROM telegram_users WHERE telegram_user_id = ?').get(telegramUserId) as Record<
    string,
    unknown
  >;
  return mapUser(row);
}

export function findTelegramUser(db: Db, telegramUserId: number): TelegramUser | null {
  const row = db.prepare('SELECT * FROM telegram_users WHERE telegram_user_id = ?').get(telegramUserId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapUser(row) : null;
}
