# Deploy `omrantoys-store` to Cloudflare

This deployment is a Cloudflare Worker with Workers Static Assets and D1. There are no platform adapters or external hosting integrations.

## One-time setup

```bash
npm ci
npx wrangler login
npx wrangler d1 create omran-toys-db
```

Copy the `database_id` printed by the last command into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

Create the Telegram webhook secret and store it only in Cloudflare:

```bash
openssl rand -hex 32
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Put the storefront build output in `public/` (or adapt the existing frontend build to emit `dist/`), then deploy:

```bash
npm run build
npm run db:migrate:remote
npm run deploy
```

Register Telegram after the Worker has a public URL:

```bash
TELEGRAM_BOT_TOKEN='<bot-token>' \
TELEGRAM_WEBHOOK_SECRET='<same-secret>' \
PUBLIC_BASE_URL='https://omrantoys-store.<subdomain>.workers.dev' \
npm run webhook:setup
```

## Existing D1 database

If `omran-toys-db` already exists, skip `wrangler d1 create`, obtain its UUID with:

```bash
npx wrangler d1 list
```

Then set that UUID in `wrangler.toml` and run the migration/deploy commands above.

## Routes

- `POST /api/telegram/webhook` validates Telegram's secret header and deduplicates `update_id` in D1.
- `GET /api/health` is the edge health check.
- All non-API requests go directly to Cloudflare Static Assets, with SPA fallback handled by the platform.
