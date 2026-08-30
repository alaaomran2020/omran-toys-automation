# Deploy Runbook — omrantoys.store Product API (Worker + D1)

This makes the **store-side** of the automation live: a Cloudflare Worker API
(`POST /api/products`, catalog reads) backed by **D1**, plus the small SPA
changes so published products appear on `omrantoys.store`.

> Everything here is **already applied and verified** against the store repo
> (`alaaomran2020/omrantoys-store`):
> - Worker: `src/worker/index.js`, `src/worker/store-db.js`
> - Migration: `migrations/001_add_idempotency_key.sql`
> - Config: `wrangler.toml` (with `account_id` filled in)
> - Frontend: `src/lib/storeApi.js` + `src/context/StoreContext.jsx`
>
> Apply via `git apply omrantoys-store-integration.patch` (or copy the files
> per `store-integration/README.md`). A dry-run deploy passed and the SPA
> builds cleanly.

---

## Credentials used

| Item | Value |
|---|---|
| Account ID | `16e18ca29e464009c0b59cc37f48b67a` |
| Zone ID (`omrantoys.store`) | `8079b7b64ca4ec729b782c537fedcfa4` |
| Worker name | `omrantoys-store` |
| D1 database name | `omran-toys-db` |

---

## Prerequisite: Cloudflare auth (required — not available in this sandbox)

The deployment commands below need a Cloudflare API token. Set it in your
environment (do **not** paste the token into a chat):

```bash
export CLOUDFLARE_API_TOKEN="<your token>"          # Account-scoped, Workers + D1 edit
# or, interactively:
npx wrangler login
```

Verify:

```bash
npx wrangler whoami
# → "You are authenticated" (or an account row) = OK
```

---

## Step 1 — Provision the D1 database (one-time)

The store repo currently has a **placeholder** `database_id`
(`00000000-0000-0000-0000-000000000000`). Create the real database once:

```bash
cd omrantoys-store
npx wrangler d1 create omran-toys-db
```

Copy the returned **`database_id`** into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "omran-toys-db"
database_id = "<REAL database_id from the command above>"
```

---

## Step 2 — Apply the migration to the remote D1 database

```bash
cd omrantoys-store
npx wrangler d1 execute DB --remote --file=migrations/001_add_idempotency_key.sql
```

This adds the `idempotency_key` column + unique index (one product per
automation draft id; replays can never create duplicates).

---

## Step 3 — Create the server-to-server secrets

These must **match** the automation server's
`STORE_API_KEY` / `STORE_API_SECRET` env vars:

```bash
cd omrantoys-store
npx wrangler secret put STORE_API_KEY
npx wrangler secret put STORE_API_SECRET
```

---

## Step 4 — Build + deploy the Worker

```bash
cd omrantoys-store
npm run build          # Vite → ./dist (SPA assets)
npx wrangler deploy
```

### Ensure the Worker serves the custom domain

The Worker needs to be reachable at `https://omrantoys.store`. If it isn't
already attached to that domain, add a custom-domain binding (dashboard:
**Workers & Pages → omrantoys-store → Settings → Domains & Routes → Add custom
domain**) or add a route in `wrangler.toml` using your Zone ID:

```toml
routes = [
  { pattern = "omrantoys.store", zone_id = "8079b7b64ca4ec729b782c537fedcfa4" },
  { pattern = "www.omrantoys.store", zone_id = "8079b7b64ca4ec729b782c537fedcfa4" },
]
```

---

## Step 5 — Verify

```bash
curl https://omrantoys.store/api/health
# → {"status":"ok"}

curl https://omrantoys.store/api/products?limit=3
# → [ ... ]   (empty array is fine before any product is published)
```

---

## Step 6 — Point the automation server at it

In `omran-toys-automation` `.env`:

```dotenv
STORE_API_URL=https://omrantoys.store
STORE_API_KEY=<same as wrangler secret STORE_API_KEY>
STORE_API_SECRET=<same as wrangler secret STORE_API_SECRET>
STORE_BASE_URL=https://omrantoys.store
```

Then run the full flow: Telegram → image → `350 - 8` → AI (1 call) → Draft →
✅ publish → `POST /api/products` → product in D1 → `GET /api/products` →
SPA → `#product=<id>`.

---

## What's already done in this session

- ✅ Integration applied + verified in `omrantoys-store` (build passes, 10/10
  worker tests pass, real-D1 SQL smoke passes — insert + idempotent duplicate).
- ✅ `wrangler deploy --dry-run` bundles the Worker and surfaces the correct
  bindings (`DB`, `ASSETS`, `STORE_BASE_URL`).
- ✅ `account_id` written into both the automation `store-integration/wrangler.toml`
  and the store repo's `wrangler.toml`.
- ⛔ **Not done:** live `wrangler deploy` / D1 create / secrets — blocked by
  missing Cloudflare auth (no `CLOUDFLARE_API_TOKEN`) and the placeholder
  `database_id`.
