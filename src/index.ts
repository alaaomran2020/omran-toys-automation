interface D1Result {
  success: boolean;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  DB: D1Database;
  ASSETS: AssetsBinding;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: JSON_HEADERS });
}

function secureEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }

  return difference === 0;
}

async function sendTelegramMessage(token: string, chatId: number, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  const suppliedSecret = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!env.TELEGRAM_WEBHOOK_SECRET || !secureEqual(suppliedSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return json({ error: 'content-type must be application/json' }, 415);
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  if (!Number.isSafeInteger(update?.update_id)) {
    return json({ error: 'invalid Telegram update' }, 400);
  }

  // حفظ التحديث في قاعدة البيانات
  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO webhook_updates (update_id, received_at) VALUES (?, datetime('now'))",
    )
      .bind(update.update_id)
      .run();
  } catch (dbError) {
    console.error('Database write error:', dbError);
  }

  // الرد الفوري على رسائل المستخدم في تليجرام
  if (update.message && update.message.chat && update.message.text) {
    const chatId = update.message.chat.id;
    const text = update.message.text.trim();

    if (text.startsWith('/start')) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        'أهلاً بك يا ألاء! تم استلام رسالتك بنجاح، وخادم أتمتة Omran Toys يعمل بكفاءة تامة على Cloudflare.'
      );
    } else {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `لقد استلمت رسالتك: "${text}"`
      );
    }
  }

  return json({ ok: true });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json({ status: 'ok' });
  }

  if (request.method === 'POST' && url.pathname === '/api/telegram/webhook') {
    return handleTelegramWebhook(request, env);
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    try {
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        return await handleApi(request, env);
      }

      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error('request failed', error instanceof Error ? error.message : String(error));
      return json({ error: 'internal server error' }, 500);
    }
  },
};
