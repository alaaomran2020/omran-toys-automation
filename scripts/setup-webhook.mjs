#!/usr/bin/env node
/**
 * Registers the Telegram webhook for this automation server.
 *
 * Usage:
 *   npm run webhook:setup           # register with secret token
 *   npm run webhook:setup -- --delete   # remove the webhook
 *
 * Reads TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and PUBLIC_BASE_URL
 * from the environment or .env.
 */
import { readFileSync, existsSync } from 'node:fs';

function loadEnvFile() {
  const vars = {};
  if (!existsSync('.env')) return vars;
  for (const rawLine of readFileSync('.env', 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return vars;
}

const fileVars = loadEnvFile();
const env = { ...fileVars, ...process.env };

const botToken = env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error('Missing TELEGRAM_BOT_TOKEN in environment or .env');
  process.exit(1);
}

const webhookUrl = (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '') + '/api/telegram/webhook';
const secret = env.TELEGRAM_WEBHOOK_SECRET ?? '';

const args = process.argv.slice(2);
const isDelete = args.includes('--delete');

async function call(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) {
    console.error(`Telegram error ${res.status}:`, body.description);
    process.exit(1);
  }
  return body.result;
}

if (isDelete) {
  await call('deleteWebhook');
  console.log('✅ Webhook deleted.');
  process.exit(0);
}

if (!webhookUrl.startsWith('https://')) {
  console.error('PUBLIC_BASE_URL must be a public HTTPS URL (Telegram requirement).');
  process.exit(1);
}
if (!secret) {
  console.error('TELEGRAM_WEBHOOK_SECRET is required (use a long random string).');
  process.exit(1);
}

const _result = await call('setWebhook', {
  url: webhookUrl,
  secret_token: secret,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: false,
});
console.log('✅ Webhook registered:', webhookUrl);
const current = await call('getWebhookInfo');
console.log('Pending updates:', current.pending_update_count);
if (current.last_error_message) console.warn('Last error:', current.last_error_message);
