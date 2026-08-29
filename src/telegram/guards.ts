import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Authorization: only Telegram user IDs present in TELEGRAM_ADMIN_IDS
 * may use the bot. Every sensitive operation (AI, drafts, store API)
 * is reachable only after this check passes.
 */
export function isAuthorized(adminIds: readonly number[], telegramUserId: number | undefined | null): boolean {
  if (telegramUserId === undefined || telegramUserId === null) return false;
  return adminIds.includes(telegramUserId);
}

/** Constant-time string comparison (safe for secrets like the webhook secret). */
export function secureCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/** Access denied message for unauthorized users. */
export const ACCESS_DENIED_MESSAGE = '⛔ Access Denied\n\nهذا البوت مخصص للموظفين المصرح لهم فقط.';
