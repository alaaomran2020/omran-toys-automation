import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoreProductService, StoreApiError } from '../../src/store/client.js';
import { FakeStoreServer } from '../helpers/fakeStoreServer.js';

const BASE_INPUT = {
  nameAr: 'سيارة دريفت RC رباعية الدفع',
  description: 'سيارة دريفت سريعة',
  categoryId: 'rc-electronic',
  price: 350,
  stock: 8,
  brand: null,
  ageGroup: '6-8',
  images: ['http://automation.test/api/media/x.jpg'],
  features: ['تحكم عن بعد'],
  tags: ['سيارة'],
  sku: 'OMR-AUTO-abcdef12',
  slug: 'auto-abcdef12',
};

async function withStore(fn: (store: FakeStoreServer, url: string) => Promise<void>) {
  const store = new FakeStoreServer({
    apiKey: 'store-key',
    apiSecret: 'store-secret',
    storeBaseUrl: 'https://omrantoys.store',
  });
  await store.start();
  try {
    await fn(store, store.url);
  } finally {
    await store.stop();
  }
}

test('createProduct: valid request → 201 with id + url', async () => {
  await withStore(async (store, url) => {
    const client = new StoreProductService({
      apiBaseUrl: url,
      apiKey: 'store-key',
      apiSecret: 'store-secret',
      timeoutMs: 5000,
    });
    const created = await client.createProduct(BASE_INPUT, 'draft-id-0001');
    assert.ok(created.id.length > 0);
    assert.ok(created.url!.includes(`#product=${created.id}`));
    assert.equal(store.createCalls, 1);
    assert.equal(store.products[0]!.body.retail_price, 350);
    assert.equal(store.products[0]!.body.stock_quantity, 8);
    assert.equal(store.products[0]!.body.name_ar, BASE_INPUT.nameAr);
  });
});

test('createProduct: wrong API key → 401 StoreApiError', async () => {
  await withStore(async (_store, url) => {
    const client = new StoreProductService({
      apiBaseUrl: url,
      apiKey: 'wrong',
      apiSecret: 'store-secret',
      timeoutMs: 5000,
    });
    await assert.rejects(
      () => client.createProduct(BASE_INPUT, 'draft-id-0002'),
      (err: unknown) => {
        assert.ok(err instanceof StoreApiError);
        assert.equal(err.status, 401);
        return true;
      },
    );
  });
});

test('createProduct: wrong HMAC secret → 401 StoreApiError', async () => {
  await withStore(async (_store, url) => {
    const client = new StoreProductService({
      apiBaseUrl: url,
      apiKey: 'store-key',
      apiSecret: 'wrong-secret',
      timeoutMs: 5000,
    });
    await assert.rejects(
      () => client.createProduct(BASE_INPUT, 'draft-id-0003'),
      (err: unknown) => {
        assert.ok(err instanceof StoreApiError);
        assert.equal(err.status, 401);
        return true;
      },
    );
  });
});

test('createProduct: idempotent replay returns the same product (spec §24)', async () => {
  await withStore(async (store, url) => {
    const client = new StoreProductService({
      apiBaseUrl: url,
      apiKey: 'store-key',
      apiSecret: 'store-secret',
      timeoutMs: 5000,
    });
    const first = await client.createProduct(BASE_INPUT, 'draft-id-0004');
    const second = await client.createProduct(BASE_INPUT, 'draft-id-0004');
    assert.equal(first.id, second.id);
    assert.equal(store.createCalls, 1, 'exactly ONE product created despite two calls');
    assert.equal(store.products.length, 1);
  });
});

test('createProduct: different drafts → different products', async () => {
  await withStore(async (_store, url) => {
    const client = new StoreProductService({
      apiBaseUrl: url,
      apiKey: 'store-key',
      apiSecret: 'store-secret',
      timeoutMs: 5000,
    });
    const a = await client.createProduct(BASE_INPUT, 'draft-id-0005');
    const b = await client.createProduct(BASE_INPUT, 'draft-id-0006');
    assert.notEqual(a.id, b.id);
  });
});

test('getProduct: found / not found', async () => {
  await withStore(async (store, url) => {
    const client = new StoreProductService({
      apiBaseUrl: url,
      apiKey: 'store-key',
      apiSecret: 'store-secret',
      timeoutMs: 5000,
    });
    const created = await client.createProduct(BASE_INPUT, 'draft-id-0007');
    const found = await client.getProduct(created.id);
    assert.ok(found);
    assert.equal(found!.name, BASE_INPUT.nameAr);
    assert.equal(await client.getProduct('does-not-exist'), null);
    void store;
  });
});

test('createProduct: validation error from store surfaces as 400', async () => {
  await withStore(async (_store, url) => {
    const client = new StoreProductService({
      apiBaseUrl: url,
      apiKey: 'store-key',
      apiSecret: 'store-secret',
      timeoutMs: 5000,
    });
    await assert.rejects(
      () => client.createProduct({ ...BASE_INPUT, price: 0 }, 'draft-id-0008'),
      (err: unknown) => {
        assert.ok(err instanceof StoreApiError);
        assert.equal(err.status, 400);
        return true;
      },
    );
  });
});
