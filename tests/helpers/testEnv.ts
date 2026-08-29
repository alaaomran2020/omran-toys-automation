import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../../src/config.js';
import { openDatabase, type Db } from '../../src/db/database.js';
import { buildApp } from '../../src/app.js';
import { MediaService } from '../../src/core/media.js';
import { SlidingWindowRateLimiter } from '../../src/core/rateLimit.js';
import { ProductWorkflow } from '../../src/core/workflow.js';
import { StoreProductService } from '../../src/store/client.js';
import type { AiAnalyzeInput, AiAnalysis, AiProductAnalyzer } from '../../src/ai/provider.js';
import { parseAiAnalysis } from '../../src/ai/parse.js';
import type {
  SendMessageOptions,
  TelegramClientInterface,
  TelegramFile,
  TelegramPhoto,
} from '../../src/telegram/client.js';
import { FakeStoreServer } from './fakeStoreServer.js';

/** 1x1 transparent PNG. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// ---------------------------------------------------------------------------
// Fakes (test doubles for external service boundaries only)
// ---------------------------------------------------------------------------

export class FakeTelegram implements TelegramClientInterface {
  messages: Array<{ chatId: number; text: string; options?: SendMessageOptions }> = [];
  answers: Array<{ callbackQueryId: string; text?: string }> = [];
  downloadedFiles: string[] = [];

  constructor(
    private readonly imageBuffer: Buffer = PNG_1X1,
    private readonly failDownload = false,
  ) {}

  async sendMessage(chatId: number, text: string, options?: SendMessageOptions): Promise<void> {
    this.messages.push({ chatId, text, options });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    this.answers.push({ callbackQueryId, text });
  }

  async getFile(_fileId: string): Promise<TelegramFile> {
    return { file_id: 'file', file_unique_id: 'u', file_path: 'files/test' };
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    this.downloadedFiles.push(filePath);
    if (this.failDownload) throw new Error('download failed');
    return this.imageBuffer;
  }

  lastMessage(chatId?: number) {
    return chatId === undefined ? this.messages.at(-1) : this.messages.filter((m) => m.chatId === chatId).at(-1);
  }
}

export const DEFAULT_ANALYSIS: AiAnalysis = {
  name: 'سيارة دريفت RC رباعية الدفع',
  shortDescription: 'سيارة دريفت سريعة بتحكم عن بعد مناسب للداخل والخارج',
  description: 'سيارة دريفت قوية محركاتها مدمجة مع عجلات مطاطية. تشمل بطارية قابلة للشحن وريموت تحكم.',
  category: 'تحكم عن بعد',
  brand: null,
  color: 'أحمر',
  ageRange: '6-8',
  features: ['تحكم عن بعد', 'بطارية قابلة للشحن'],
  keywords: ['سيارة', 'درفت', 'ريموت', 'تحكم عن بعد'],
};

export class FakeAnalyzer implements AiProductAnalyzer {
  calls = 0;
  inputs: AiAnalyzeInput[] = [];

  constructor(
    private readonly responder: (input: AiAnalyzeInput) => AiAnalysis | string | Error = () => DEFAULT_ANALYSIS,
  ) {}

  async analyze(input: AiAnalyzeInput): Promise<AiAnalysis> {
    this.calls += 1;
    this.inputs.push(input);
    const out = this.responder(input);
    if (out instanceof Error) throw out;
    if (typeof out === 'string') return parseAiAnalysis(out);
    return out;
  }
}

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ---------------------------------------------------------------------------
// Test world
// ---------------------------------------------------------------------------

export interface TestWorld {
  config: Config;
  db: Db;
  app: FastifyInstance;
  workflow: ProductWorkflow;
  telegram: FakeTelegram;
  analyzer: FakeAnalyzer;
  store: FakeStoreServer;
  storeClient: StoreProductService;
  media: MediaService;
  limiter: SlidingWindowRateLimiter;
  tmpDir: string;
  close(): Promise<void>;
}

export interface TestWorldOptions {
  adminIds?: number[];
  analyzer?: FakeAnalyzer;
  storeDelayMs?: number;
  webhookSecret?: string;
  telegram?: FakeTelegram;
}

export async function buildTestWorld(options: TestWorldOptions = {}): Promise<TestWorld> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'omran-automation-test-'));
  const webhookSecret = options.webhookSecret ?? 'test-webhook-secret';

  const config: Config = {
    env: 'test',
    port: 0,
    host: '127.0.0.1',
    publicBaseUrl: 'http://automation.test',
    telegram: {
      botToken: 'fake-token',
      webhookSecret,
      adminIds: options.adminIds ?? [111, 222],
      apiBaseUrl: 'http://telegram.test',
    },
    ai: { apiKey: 'fake-ai-key', model: 'fake-model', baseUrl: 'http://ai.test', timeoutMs: 5000 },
    store: {
      apiBaseUrl: 'http://store.test',
      apiKey: 'store-key',
      apiSecret: 'store-secret',
      storeBaseUrl: 'https://omrantoys.store',
      timeoutMs: 5000,
    },
    database: { path: ':memory:' },
    storage: { dir: join(tmpDir, 'storage'), maxImageMb: 10 },
    rateLimits: { webhookPerChatPerMin: 1000, aiPerChatPerHour: 100, publishPerChatPerHour: 100 },
  };

  const store = new FakeStoreServer({
    apiKey: config.store.apiKey,
    apiSecret: config.store.apiSecret,
    storeBaseUrl: config.store.storeBaseUrl,
    delayMs: options.storeDelayMs ?? 0,
  });
  await store.start();
  config.store.apiBaseUrl = store.url;

  const db = openDatabase(':memory:');
  const media = new MediaService(config.storage.dir, config.publicBaseUrl);
  const telegram = options.telegram ?? new FakeTelegram();
  const analyzer = options.analyzer ?? new FakeAnalyzer();
  const storeClient = new StoreProductService({
    apiBaseUrl: store.url,
    apiKey: config.store.apiKey,
    apiSecret: config.store.apiSecret,
    timeoutMs: 5000,
  });
  const limiter = new SlidingWindowRateLimiter();
  const workflow = new ProductWorkflow({
    db,
    config,
    telegram,
    analyzer,
    store: storeClient,
    media,
    limiter,
    logger: silentLogger,
  });
  const app = buildApp({ config, db, workflow, media });

  return {
    config,
    db,
    app,
    workflow,
    telegram,
    analyzer,
    store,
    storeClient,
    media,
    limiter,
    tmpDir,
    close: async () => {
      await app.close();
      await store.stop();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Telegram update builders + webhook helper
// ---------------------------------------------------------------------------

export function chatIdFor(userId: number): number {
  return 10000 + userId;
}

export function textUpdate(updateId: number, userId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: chatIdFor(userId), type: 'private' },
      from: { id: userId, first_name: 'Employee' },
      text,
    },
  };
}

export function photoUpdate(updateId: number, userId: number, fileId = 'file-1', mimeType = 'image/jpeg') {
  const photo: TelegramPhoto = { file_id: fileId, file_unique_id: 'u', file_size: PNG_1X1.length, mime_type: mimeType };
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: chatIdFor(userId), type: 'private' },
      from: { id: userId, first_name: 'Employee' },
      photo: [photo],
    },
  };
}

export function callbackUpdate(updateId: number, userId: number, data: string) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: userId, first_name: 'Employee' },
      message: { chat: { id: chatIdFor(userId), type: 'private' } },
      data,
    },
  };
}

export async function sendUpdate(app: FastifyInstance, update: unknown, secret = 'test-webhook-secret') {
  return app.inject({
    method: 'POST',
    url: '/api/telegram/webhook',
    payload: { ...(update as object), secret_token: secret },
  });
}

/** Extract the draft id from a preview message's inline keyboard. */
export function extractDraftId(message: { options?: SendMessageOptions }): string {
  const markup = message.options?.replyMarkup as
    | { inline_keyboard: Array<Array<{ callback_data: string }>> }
    | undefined;
  const first = markup?.inline_keyboard?.flat()?.find((b) => b.callback_data.startsWith('publish:'));
  if (!first) throw new Error('no publish button found in message');
  return first.callback_data.split(':')[1]!;
}
