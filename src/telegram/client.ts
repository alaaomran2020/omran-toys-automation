/**
 * Minimal Telegram Bot API client (raw HTTP — no SDK dependency).
 * Only the methods the automation actually needs:
 *   sendMessage, answerCallbackQuery, getFile, downloadFile, getMe
 */

export class TelegramApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly description: string,
  ) {
    super(`Telegram API error ${status}: ${description}`);
  }
}

export interface TelegramPhoto {
  file_id: string;
  file_unique_id: string;
  width?: number;
  height?: number;
  file_size?: number;
  mime_type?: string;
}

export interface SendMessageOptions {
  replyMarkup?: Record<string, unknown>;
}

export interface TelegramUserRef {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

/** Interface so tests can inject a fake. Production uses TelegramClient. */
export interface TelegramClientInterface {
  sendMessage(chatId: number, text: string, options?: SendMessageOptions): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
  getFile(fileId: string): Promise<TelegramFile>;
  downloadFile(filePath: string): Promise<Buffer>;
}

export class TelegramClient implements TelegramClientInterface {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      botToken: string;
      apiBaseUrl?: string;
      timeoutMs?: number;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private get baseUrl(): string {
    return (this.options.apiBaseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '');
  }

  private async call<T>(method: string, payload?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/bot${this.options.botToken}/${method}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new TelegramApiError(408, 'request timeout');
      throw new TelegramApiError(0, `network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: T };
    if (body.ok !== true) {
      throw new TelegramApiError(res.status, body.description ?? `unexpected response ${res.status}`);
    }
    return body.result as T;
  }

  async sendMessage(chatId: number, text: string, options?: SendMessageOptions): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    const result = await this.call<TelegramFile & { ok?: boolean }>('getFile', { file_id: fileId });
    return result;
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const url = `${this.baseUrl}/file/bot${this.options.botToken}/${filePath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: controller.signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new TelegramApiError(408, 'download timeout');
      throw new TelegramApiError(0, `download network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new TelegramApiError(res.status, `download failed: ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async getMe(): Promise<TelegramUserRef> {
    return this.call<TelegramUserRef>('getMe');
  }
}
