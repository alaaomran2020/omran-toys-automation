/**
 * Environment configuration.
 *
 * All secrets come from environment variables (never from source code).
 * In production the process fails fast if a required variable is missing.
 */

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  /** Public HTTPS base URL of this automation server (used to build image URLs for the store). */
  publicBaseUrl: string;

  telegram: {
    botToken: string;
    webhookSecret: string;
    /** Whitelisted Telegram user IDs. */
    adminIds: number[];
    apiBaseUrl: string;
  };

  ai: {
    apiKey: string;
    model: string;
    baseUrl: string;
    timeoutMs: number;
  };

  store: {
    apiBaseUrl: string;
    apiKey: string;
    apiSecret: string;
    /** Public base URL of the storefront (for product links). */
    storeBaseUrl: string;
    timeoutMs: number;
  };

  database: {
    path: string;
  };
  storage: {
    dir: string;
    maxImageMb: number;
  };

  rateLimits: {
    /** Messages per chat per minute accepted by the webhook. */
    webhookPerChatPerMin: number;
    /** AI calls per chat per hour (backstop — normal flow is 1 per product). */
    aiPerChatPerHour: number;
    /** Publish attempts per chat per hour (backstop against loops). */
    publishPerChatPerHour: number;
  };
}

function parsePositiveInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got: ${value}`);
  }
  return n;
}

function parseAdminIds(value: string | undefined): number[] {
  if (!value) return [];
  const ids = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const n = Number(part);
      if (!Number.isInteger(n) || n <= 0) {
        throw new ConfigError(`TELEGRAM_ADMIN_IDS contains an invalid user id: "${part}"`);
      }
      return n;
    });
  return ids;
}

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  const config: Config = {
    env: nodeEnv === 'production' ? 'production' : nodeEnv === 'test' ? 'test' : 'development',
    port: parsePositiveInt(env.PORT, 'PORT', 3000),
    host: env.HOST ?? '0.0.0.0',
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN ?? '',
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? '',
      adminIds: parseAdminIds(env.TELEGRAM_ADMIN_IDS),
      apiBaseUrl: (env.TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org').replace(/\/+$/, ''),
    },
    ai: {
      apiKey: env.OPENAI_API_KEY ?? '',
      model: env.OPENAI_MODEL ?? 'gpt-4o-mini',
      baseUrl: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
      timeoutMs: parsePositiveInt(env.OPENAI_TIMEOUT_MS, 'OPENAI_TIMEOUT_MS', 60_000),
    },
    store: {
      apiBaseUrl: (env.STORE_API_URL ?? '').replace(/\/+$/, ''),
      apiKey: env.STORE_API_KEY ?? '',
      apiSecret: env.STORE_API_SECRET ?? '',
      storeBaseUrl: (env.STORE_BASE_URL ?? 'https://omrantoys.store').replace(/\/+$/, ''),
      timeoutMs: parsePositiveInt(env.STORE_API_TIMEOUT_MS, 'STORE_API_TIMEOUT_MS', 30_000),
    },
    database: {
      path: env.DATABASE_PATH ?? './data/automation.db',
    },
    storage: {
      dir: env.STORAGE_DIR ?? './storage',
      maxImageMb: parsePositiveInt(env.MAX_IMAGE_MB, 'MAX_IMAGE_MB', 10),
    },
    rateLimits: {
      webhookPerChatPerMin: parsePositiveInt(env.WEBHOOK_PER_CHAT_PER_MIN, 'WEBHOOK_PER_CHAT_PER_MIN', 30),
      aiPerChatPerHour: parsePositiveInt(env.AI_CALLS_PER_CHAT_PER_HOUR, 'AI_CALLS_PER_CHAT_PER_HOUR', 5),
      publishPerChatPerHour: parsePositiveInt(
        env.PUBLISH_ATTEMPTS_PER_CHAT_PER_HOUR,
        'PUBLISH_ATTEMPTS_PER_CHAT_PER_HOUR',
        20,
      ),
    },
  };

  if (isProduction) {
    const missing: string[] = [];
    if (!config.telegram.botToken) missing.push('TELEGRAM_BOT_TOKEN');
    if (!config.telegram.webhookSecret) missing.push('TELEGRAM_WEBHOOK_SECRET');
    if (config.telegram.adminIds.length === 0) missing.push('TELEGRAM_ADMIN_IDS');
    if (!config.ai.apiKey) missing.push('OPENAI_API_KEY');
    if (!config.store.apiBaseUrl) missing.push('STORE_API_URL');
    if (!config.store.apiKey) missing.push('STORE_API_KEY');
    if (!config.store.apiSecret) missing.push('STORE_API_SECRET');
    if (!config.publicBaseUrl) missing.push('PUBLIC_BASE_URL');
    if (missing.length > 0) {
      throw new ConfigError(`Production environment is missing required variables: ${missing.join(', ')}`);
    }
  }

  return config;
}
