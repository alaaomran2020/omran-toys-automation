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
  TELEGRAM_WEBHOOK_SECRET: string;
}

interface TelegramUpdate {
  update_id: number;
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

  // D1's primary key makes Telegram retries idempotent. Keep only the update ID
  // at ingress to minimize edge memory, storage, and exposure of message data.
  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO webhook_updates (update_id, received_at) VALUES (?, datetime('now'))",
    )
      .bind(update.update_id)
      .run();
  } catch (dbError) {
    console.error('Database write error (ignoring for webhook response):', dbError);
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

      // Cloudflare Assets handles files and SPA navigation fallback natively.
      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error('request failed', error instanceof Error ? error.message : String(error));
      return json({ error: 'internal server error' }, 500);
    }
  },
};
