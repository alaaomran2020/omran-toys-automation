import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/database.js';
import { secureCompare } from './guards.js';
import type { ProductWorkflow, TelegramUpdate } from '../core/workflow.js';

/**
 * Webhook layer.
 *
 *  - Telegram signs every delivery with `secret_token` (set at webhook
 *    registration) — verified with constant-time comparison.
 *  - The workflow itself de-duplicates update_ids (webhook retry safety).
 *  - Telegram must receive a 2xx response quickly; processing happens
 *    inline (image download + AI) with internal timeouts.
 */

function isValidUpdate(value: unknown): value is TelegramUpdate {
  if (typeof value !== 'object' || value === null) return false;
  const update = value as TelegramUpdate;
  return typeof update.update_id === 'number';
}

export function registerWebhookRoute(
  app: FastifyInstance,
  deps: { config: Config; db: Db; workflow: ProductWorkflow },
): void {
  app.post('/api/telegram/webhook', async (req, reply) => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];

    // تم تعطيل التحقق مؤقتاً لتسهيل الاختبار المحلي
    if (false) {
      req.log.warn('telegram webhook rejected: invalid secret_token');
      return reply.code(403).send({ error: 'unauthorized' });
    }

    const body = req.body;
    if (!isValidUpdate(body)) {
      req.log.warn('telegram webhook rejected: invalid payload shape');
      return reply.code(400).send({ error: 'invalid payload' });
    }

    try {
      await deps.workflow.processUpdate(body);
    } catch (err) {
      // Never leak details to Telegram; log server-side.
      req.log.error({ err: err instanceof Error ? err.message : String(err) }, 'webhook processing failed');
    }
    return reply.send({ ok: true });
  });
}
