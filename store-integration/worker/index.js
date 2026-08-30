/**
 * Omran Toys Store — minimal server-to-server Product API (Cloudflare Worker).
 *
 * Install as: src/worker/index.js
 *
 * This is the SMALLEST possible API to make real product creation possible
 * (the current store has no server-side product creation — admin products
 * live in the browser's localStorage). It writes to the existing Cloudflare
 * D1 schema (cloudflare/d1-schema.sql).
 *
 * Endpoints:
 *   GET  /api/health          — liveness
 *   POST /api/products        — create product (authenticated, idempotent)
 *   GET  /api/products        — public catalog (frontend shape)
 *   GET  /api/products/:id    — public product (frontend shape)
 *
 * Everything else falls through to the SPA assets (env.ASSETS).
 *
 * Auth (server-to-server secret, spec §21-22):
 *   header x-api-key       — must equal env.STORE_API_KEY
 *   header x-api-signature — HMAC-SHA256(raw body, env.STORE_API_SECRET) hex
 *   header idempotency-key — required; replays return the SAME product
 */
import {
  findProductById,
  findProductByIdempotencyKey,
  insertProduct,
  listActiveProducts,
  rowToFrontend,
} from './store-db.js';

const AGE_GROUPS = ['0-2', '3-5', '6-8', '9-12', '12+'];

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(request, url, env);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('worker error:', err);
      return jsonResponse(500, { error: 'internal error' });
    }
  },
};

async function handleApi(request, url, env) {
  const { method, pathname } = { method: request.method, pathname: url.pathname };

  if (method === 'GET' && pathname === '/api/health') {
    return jsonResponse(200, { status: 'ok' });
  }

  if (method === 'POST' && pathname === '/api/products') {
    return await handleCreateProduct(request, env);
  }

  if (method === 'GET' && pathname === '/api/products') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 200);
    const rows = await listActiveProducts(env.DB, limit);
    const base = baseStoreUrl(request, env);
    return jsonResponse(200, rows.map((row) => rowToFrontend(row, productUrl(base, row.id))));
  }

  const productMatch = pathname.match(/^\/api\/products\/([\w-]+)$/);
  if (method === 'GET' && productMatch) {
    const row = await findProductById(env.DB, productMatch[1]);
    if (!row) return jsonResponse(404, { error: 'product not found' });
    const base = baseStoreUrl(request, env);
    return jsonResponse(200, rowToFrontend(row, productUrl(base, row.id)));
  }

  return jsonResponse(404, { error: 'not found' });
}

// ---------------------------------------------------------------------------
// POST /api/products
// ---------------------------------------------------------------------------

async function handleCreateProduct(request, env) {
  const rawBody = await request.text();

  // 1) API key
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey || !(await constantTimeEqual(apiKey, env.STORE_API_KEY ?? ''))) {
    return jsonResponse(401, { error: 'invalid api key' });
  }

  // 2) HMAC signature over the raw body
  const signature = request.headers.get('x-api-signature') ?? '';
  const expected = await hmacSha256Hex(rawBody, env.STORE_API_SECRET ?? '');
  if (!(await constantTimeEqual(signature, expected))) {
    return jsonResponse(401, { error: 'invalid signature' });
  }

  // 3) Idempotency key (the automation sends the draft id)
  const idempotencyKey = (request.headers.get('idempotency-key') ?? '').trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 64) {
    return jsonResponse(400, { error: 'idempotency-key required (8-64 chars)' });
  }
  const existing = await findProductByIdempotencyKey(env.DB, idempotencyKey);
  if (existing) {
    const base = baseStoreUrl(request, env);
    return jsonResponse(200, { id: existing.id, url: productUrl(base, existing.id) });
  }

  // 4) Validation
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' });
  }

  const nameAr = typeof body.name_ar === 'string' ? body.name_ar.trim() : '';
  if (nameAr.length < 3 || nameAr.length > 200) {
    return jsonResponse(400, { error: 'name_ar required (3-200 chars)' });
  }
  const price = body.retail_price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 10_000_000) {
    return jsonResponse(400, { error: 'retail_price must be a number > 0' });
  }
  const stock = body.stock_quantity;
  if (typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0 || stock > 1_000_000) {
    return jsonResponse(400, { error: 'stock_quantity must be an integer >= 0' });
  }
  if (!Array.isArray(body.images) || body.images.length === 0 || !body.images.every((u) => typeof u === 'string' && u.startsWith('http'))) {
    return jsonResponse(400, { error: 'images must be a non-empty array of http(s) URLs' });
  }
  if (body.category_id !== null && body.category_id !== undefined && typeof body.category_id !== 'string') {
    return jsonResponse(400, { error: 'category_id must be a string or null' });
  }
  if (body.age_group !== null && body.age_group !== undefined && !AGE_GROUPS.includes(body.age_group)) {
    return jsonResponse(400, { error: 'age_group invalid' });
  }
  const description = typeof body.description === 'string' ? body.description.slice(0, 2000) : null;
  const brand = typeof body.brand === 'string' ? body.brand.slice(0, 80) : null;
  const features = Array.isArray(body.features) ? body.features.filter((f) => typeof f === 'string').slice(0, 10) : [];
  const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string').slice(0, 10) : [];

  const id = crypto.randomUUID();
  await insertProduct(env.DB, {
    id,
    sku: typeof body.sku === 'string' && body.sku.length > 0 ? body.sku.slice(0, 64) : `OMR-AUTO-${id.slice(0, 8)}`,
    slug: typeof body.slug === 'string' && body.slug.length > 0 ? body.slug.slice(0, 80) : `product-${id.slice(0, 8)}`,
    nameAr,
    nameEn: typeof body.name_en === 'string' ? body.name_en : null,
    description,
    categoryId: body.category_id ?? null,
    price,
    stock,
    ageGroup: body.age_group ?? null,
    brand,
    images: JSON.stringify(body.images.slice(0, 5)),
    tags: JSON.stringify(tags),
    features: JSON.stringify(features),
    toyType: typeof body.toy_type === 'string' ? body.toy_type : null,
    idempotencyKey,
  });

  // Re-read (covers the INSERT OR IGNORE race between concurrent duplicates).
  const created = (await findProductByIdempotencyKey(env.DB, idempotencyKey)) ?? (await findProductById(env.DB, id));
  const base = baseStoreUrl(request, env);
  return jsonResponse(201, { id: created.id, url: productUrl(base, created.id) });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function productUrl(base, id) {
  // The SPA opens a product from its hash deep link (see frontend/ patch).
  return `${base}/#product=${id}`;
}

function baseStoreUrl(request, env) {
  if (env.STORE_BASE_URL) return env.STORE_BASE_URL.replace(/\/+$/, '');
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/** Constant-time string comparison (hash both, compare fixed-length digests). */
async function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const viewA = new Uint8Array(da);
  const viewB = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < viewA.length; i++) diff |= viewA[i] ^ viewB[i];
  return diff === 0;
}

async function hmacSha256Hex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
