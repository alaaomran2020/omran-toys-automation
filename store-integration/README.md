# Store Integration — omrantoys-store Product API

This folder contains a **drop-in, minimal server-to-server Product API** for
the store repository `alaaomran2020/omrantoys-store`, plus the exact small
frontend changes that make published products visible on `omrantoys.store`.

## Why is this needed?

Audit result (PHASE 0): the store currently has **no server-side product
creation** — the catalog is a static file (`src/data/products.js`) merged with
the browser's `localStorage`, and the admin panel's "add product" only persists
to the admin's own browser. A real automation system cannot create products
without a server-side API.

Per the project rules this is the **smallest possible change**:

- No new database — uses the store's **existing Cloudflare D1 schema**
  (`cloudflare/d1-schema.sql`), which was already prepared.
- No new UI, no checkout changes, no auth changes.
- One small Worker + 1 migration column + 2 tiny frontend additions.
- Everything degrades gracefully: if the Worker is down, the SPA behaves
  exactly as today.

## What's inside

| File | Where it goes in the store repo | Purpose |
|---|---|---|
| `worker/index.js` | `src/worker/index.js` (new) | Worker API: `POST /api/products` (auth + HMAC + idempotent), `GET /api/products`, `GET /api/products/:id`, `GET /api/health`; everything else → SPA assets |
| `worker/store-db.js` | `src/worker/store-db.js` (new) | D1 data access (SQL) + row→frontend mapping |
| `wrangler.toml` | **replaces** `wrangler.toml` | Adds `main = "src/worker/index.js"` + `binding = "ASSETS"` + `STORE_BASE_URL` |
| `migrations/001_add_idempotency_key.sql` | `migrations/001_add_idempotency_key.sql` (new) | Adds `products.idempotency_key` (unique) — one product per automation draft id |
| `frontend/storeApi.js` | `src/lib/storeApi.js` (new) | Remote catalog loader with silent fallback |
| `frontend/StoreContext.patch.md` | instructions for `src/context/StoreContext.jsx` | 1 import + 2 small `useEffect`s (remote merge + `#product=<id>` deep link) |
| `tests/` | keep in this folder (not copied to the store) | 10 tests for the Worker contract |
| `scripts/sql-smoke.sh` | `store-integration/scripts/sql-smoke.sh` | Verifies the SQL against a REAL local D1 engine |

## API Contract (what the automation calls)

### `POST /api/products` — create product

Headers (server-to-server secret, never exposed to the client):

| Header | Value |
|---|---|
| `x-api-key` | `STORE_API_KEY` (created via `wrangler secret put`) |
| `x-api-signature` | `HMAC-SHA256(raw_body, STORE_API_SECRET)` hex |
| `idempotency-key` | the automation **draft id** — replays return the same product |

Body (JSON):

```json
{
  "name_ar": "string (3-200)",
  "name_en": "string | null",
  "description": "string | null",
  "category_id": "string | null",
  "retail_price": "number > 0",
  "stock_quantity": "integer >= 0",
  "brand": "string | null",
  "age_group": "0-2 | 3-5 | 6-8 | 9-12 | 12+ | null",
  "images": ["https://..."],
  "features": ["string"],
  "tags": ["string"],
  "sku": "string",
  "slug": "string"
}
```

Responses:

- `201 { id, url }` — created. `url` = `https://omrantoys.store/#product=<id>`
- `200 { id, url }` — idempotent replay of an existing `idempotency-key`
- `401 { error }` — bad API key / signature
- `400 { error }` — validation error

### `GET /api/products` / `GET /api/products/:id`

Public catalog in the **frontend product shape** (the same fields the SPA
renders: `name`, `price`, `stock`, `category`, `images`, `features`, ...).
This is what the SPA loads so published products appear on the store.

## Installation (in the store repo)

```bash
cd omrantoys-store

# 1) Copy the Worker
mkdir -p src/worker migrations
cp <automation>/store-integration/worker/index.js   src/worker/index.js
cp <automation>/store-integration/worker/store-db.js src/worker/store-db.js
cp <automation>/store-integration/migrations/001_add_idempotency_key.sql migrations/

# 2) Replace wrangler.toml with the new one (keeps your real database_id!)
cp <automation>/store-integration/wrangler.toml wrangler.toml
#    → then put YOUR real database_id back in the [[d1_databases]] section

# 3) Add the column to a FRESH local schema (for local development)
#    in cloudflare/d1-schema.sql, inside CREATE TABLE products, add:
#        idempotency_key TEXT,
#    (the migration covers existing remote databases)

# 4) Frontend
cp <automation>/store-integration/frontend/storeApi.js src/lib/storeApi.js
#    apply the two small changes described in
#    <automation>/store-integration/frontend/StoreContext.patch.md

# 5) Build & test
npm run build
node --test "<automation>/store-integration/tests/**/*.test.mjs"
```

## Deployment (Cloudflare)

```bash
cd omrantoys-store

# 1) Apply the migration to the REMOTE D1 database
npx wrangler d1 execute DB --remote --file=migrations/001_add_idempotency_key.sql

# 2) Create the server-to-server secrets (values must match the automation's
#    STORE_API_KEY / STORE_API_SECRET environment variables)
npx wrangler secret put STORE_API_KEY
npx wrangler secret put STORE_API_SECRET

# 3) Deploy
npm run build
npx wrangler deploy

# 4) Verify
curl https://omrantoys.store/api/health
# → {"status":"ok"}
```

## Configure the automation side

In the automation server's `.env`:

```
STORE_API_URL=https://omrantoys.store        # base URL of the Worker API
STORE_API_KEY=<same as wrangler secret>
STORE_API_SECRET=<same as wrangler secret>
STORE_BASE_URL=https://omrantoys.store
```

After that the full flow works end-to-end:

```
Telegram → Automation (1 AI call) → Draft → Approval
         → POST /api/products (HMAC + idempotency)
         → Product row in the store's D1
         → GET /api/products → SPA shows the product
         → #product=<id> deep link opens the product page
```

## Security notes

- The API key + secret live **only** in Cloudflare secrets and the
  automation's env file — never in Git, never sent to Telegram, never in
  client-side code.
- Signature is computed over the **raw body** (tamper-proof).
- `idempotency_key` is unique in D1, so even a network timeout + retry can
  never create a duplicate product.
- The catalog endpoints expose only public product data (same as the
  storefront itself).
