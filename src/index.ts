/**
 * Omran Toys Automation — server entry point.
 *
 * Telegram → Webhook → Auth → Product Workflow → AI (1 call) → Draft →
 * Human Approval → Store Adapter → Omran Toys Store
 */
import { loadConfig } from './config.js';
import { processEnvWithFile } from './lib/env.js';
import { createConsoleLogger } from './lib/logger.js';
import { openDatabase } from './db/database.js';
import { TelegramClient } from './telegram/client.js';
import { OpenAiProductAnalyzer } from './ai/openai.js';
import { StoreProductService } from './store/client.js';
import { MediaService } from './core/media.js';
import { SlidingWindowRateLimiter } from './core/rateLimit.js';
import { ProductWorkflow } from './core/workflow.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const env = processEnvWithFile();
  const config = loadConfig(env);

  const db = openDatabase(config.database.path);
  const logger = createConsoleLogger();
  const telegram = new TelegramClient({
    botToken: config.telegram.botToken,
    apiBaseUrl: config.telegram.apiBaseUrl,
  });
  const analyzer = new OpenAiProductAnalyzer({
    apiKey: config.ai.apiKey,
    model: config.ai.model,
    baseUrl: config.ai.baseUrl,
    timeoutMs: config.ai.timeoutMs,
  });
  const store = new StoreProductService({
    apiBaseUrl: config.store.apiBaseUrl,
    apiKey: config.store.apiKey,
    apiSecret: config.store.apiSecret,
    timeoutMs: config.store.timeoutMs,
  });
  const media = new MediaService(config.storage.dir, config.publicBaseUrl);
  const limiter = new SlidingWindowRateLimiter();

  const workflow = new ProductWorkflow({ db, config, telegram, analyzer, store, media, limiter, logger });
  const app = buildApp({ config, db, workflow, media });

  await app.listen({ port: config.port, host: config.host });
  logger.info(`Omran Toys Automation listening on ${config.host}:${config.port}`, {
    env: config.env,
    model: config.ai.model,
  });
}

main().catch((err) => {
  // Fail fast with a clear message (missing env vars, bad config, ...).
  console.error('FATAL: failed to start automation server:', err);
  process.exit(1);
});
