import type { Db } from '../database.js';

export type LogAction =
  | 'PRODUCT_RECEIVED'
  | 'PRICE_STOCK_RECEIVED'
  | 'AI_ANALYSIS_STARTED'
  | 'AI_ANALYSIS_COMPLETED'
  | 'AI_ANALYSIS_FAILED'
  | 'DRAFT_CREATED'
  | 'DRAFT_UPDATED'
  | 'PUBLISH_STARTED'
  | 'PRODUCT_PUBLISHED'
  | 'PUBLISH_FAILED'
  | 'DRAFT_CANCELLED'
  | 'ACCESS_DENIED'
  | 'RATE_LIMITED'
  | 'ERROR';

export interface LogEntry {
  action: LogAction;
  telegramUserId?: number;
  chatId?: number;
  draftId?: string;
  productId?: string;
  status?: string;
  error?: string;
  /** Small structured metadata. Never put secrets/tokens here. */
  meta?: Record<string, unknown>;
}

export function addLog(db: Db, entry: LogEntry): void {
  db.prepare(
    `INSERT INTO automation_logs (telegram_user_id, chat_id, action, draft_id, product_id, status, error, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.telegramUserId ?? null,
    entry.chatId ?? null,
    entry.action,
    entry.draftId ?? null,
    entry.productId ?? null,
    entry.status ?? null,
    entry.error ?? null,
    entry.meta ? JSON.stringify(entry.meta) : null,
  );
}
