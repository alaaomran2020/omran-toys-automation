import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../worker/index.js';
import { createFakeD1 } from './helpers/fakeD1.mjs';

function makeEnv() {
  return {
    DB: createFakeD1(),
    STORE_API_KEY: 'test-api-key',
    STORE_API_SECRET: 'test-api-secret',
    STORE_BASE_URL: 'https://omrantoys.store',
    ASSETS: { fetch: async () => new Response('<html>spa</html>', { headers: { 'content-type': 'text/html' } }) },
  };
}

const BODY = {
  name_ar: 'سيارة دريفت RC رباعية الدفع',
  name_en: null,
  description: 'سيارة دريفت سريعة',
  category_id: 'rc-electronic',
  retail_price: 350,
  stock_quantity: 8,
  brand: null,
  age_group: '6-8',
  images: ['https://automation.omrantoys.store/api/media/abc.jpg'],
  features: ['تحكم عن بعد'],
  tags: ['سيارة'],
  sku: 'OMR-AUTO-abcdef12',
  slug: 'auto-abcdef12',
  is_new: true,
};

function postProducts(env, body, { key = 'test-api-key', secret = 'test-api-secret', idempotencyKey = 'draft-0000000001' } = {}) {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  return worker.fetch(
    new Request('https://omrantoys.store/api/products', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'x-api-signature': signature,
        'idempotency-key': idempotencyKey,
      },
      body: raw,
    }),
    env,
  );
}

test('GET /api/health → 200 ok', async () => {
  const env = makeEnv();
  const res = await worker.fetch(new Request('https://omrantoys.store/api/health'), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('POST /api/products: valid → 201 with id + real product link', async () => {
  const env = makeEnv();
  const res = await postProducts(env, BODY);
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.id.length >= 32);
  assert.equal(data.url, `https://omrantoys.store/#product=${data.id}`);
  assert.equal(env.DB._products.length, 1);
});

test('POST /api/products: wrong API key → 401', async () => {
  const env = makeEnv();
  const res = await postProducts(env, BODY, { key: 'wrong' });
  assert.equal(res.status, 401);
  assert.equal(env.DB._products.length, 0);
});

test('POST /api/products: wrong HMAC secret → 401', async () => {
  const env = makeEnv();
  const res = await postProducts(env, BODY, { secret: 'wrong-secret' });
  assert.equal(res.status, 401);
  assert.equal(env.DB._products.length, 0);
});

test('POST /api/products: missing idempotency-key → 400', async () => {
  const env = makeEnv();
  const raw = JSON.stringify(BODY);
  const signature = createHmac('sha256', 'test-api-secret').update(raw, 'utf8').digest('hex');
  const res = await worker.fetch(
    new Request('https://omrantoys.store/api/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-api-key', 'x-api-signature': signature },
      body: raw,
    }),
    env,
  );
  assert.equal(res.status, 400);
});

test('POST /api/products: idempotent replay → 200 same id, ONE product (spec §23-24)', async () => {
  const env = makeEnv();
  const first = await postProducts(env, BODY);
  assert.equal(first.status, 201);
  const replay = await postProducts(env, BODY); // same idempotency key
  assert.equal(replay.status, 200);
  const a = await first.json();
  const b = await replay.json();
  assert.equal(a.id, b.id);
  assert.equal(env.DB._products.length, 1);
});

test('POST /api/products: validation errors → 400', async () => {
  const env = makeEnv();
  for (const bad of [
    { ...BODY, retail_price: 0 },
    { ...BODY, retail_price: -5 },
    { ...BODY, stock_quantity: -1 },
    { ...BODY, stock_quantity: 2.5 },
    { ...BODY, images: [] },
    { ...BODY, name_ar: 'ab' },
    { ...BODY, age_group: '99-100' },
  ]) {
    const res = await postProducts(env, bad, { idempotencyKey: `draft-${bad.age_group ?? 'x'}-${bad.retail_price}-${Math.random()}` });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
  assert.equal(env.DB._products.length, 0);
});

test('GET /api/products → frontend shape catalog', async () => {
  const env = makeEnv();
  await postProducts(env, BODY);
  const res = await worker.fetch(new Request('https://omrantoys.store/api/products'), env);
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, BODY.name_ar);
  assert.equal(list[0].price, 350);
  assert.equal(list[0].stock, 8);
  assert.equal(list[0].category, 'rc-electronic');
  assert.deepEqual(list[0].features, ['تحكم عن بعد']);
  assert.deepEqual(list[0].tags, ['سيارة']);
  assert.deepEqual(list[0].images, BODY.images);
  assert.equal(list[0].ageGroup, '6-8');
  assert.ok(list[0].url.includes('#product='));
});

test('GET /api/products/:id → 200 / 404', async () => {
  const env = makeEnv();
  const created = await (await postProducts(env, BODY)).json();
  const found = await worker.fetch(new Request(`https://omrantoys.store/api/products/${created.id}`), env);
  assert.equal(found.status, 200);
  const missing = await worker.fetch(new Request('https://omrantoys.store/api/products/nope'), env);
  assert.equal(missing.status, 404);
});

test('non-API paths fall through to SPA assets', async () => {
  const env = makeEnv();
  const res = await worker.fetch(new Request('https://omrantoys.store/some-spa-route'), env);
  const text = await res.text();
  assert.ok(text.includes('spa'));
});
