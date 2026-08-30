import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/database.js';
import type { MediaService } from './core/media.js';
import type { ProductWorkflow } from './core/workflow.js';
import { registerWebhookRoute } from './telegram/webhook.js';

export interface AppDeps {
  config: Config;
  db: Db;
  workflow: ProductWorkflow;
  media: MediaService;
}

/**
 * HTTP surface (intentionally minimal):
 *   POST /api/telegram/webhook  — Telegram deliveries (secret verified)
 *   GET  /health                — liveness probe
 *   GET  /api/media/:filename   — public product images (served to the store)
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: deps.config.env === 'production' ? 'info' : 'warn',
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: 1_048_576,
  });

  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  registerWebhookRoute(app, deps);

  app.get('/api/media/:filename', async (req, reply) => {
    const filename = (req.params as { filename: string }).filename;
    const media = deps.media.readImage(filename);
    if (!media) {
      return reply.code(404).send({ error: 'not found' });
    }
    reply.header('content-type', media.mimeType);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(media.buffer);
  });

  return app;
}
