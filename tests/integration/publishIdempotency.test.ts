import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTestWorld,
  sendUpdate,
  textUpdate,
  photoUpdate,
  callbackUpdate,
  extractDraftId,
  chatIdFor,
} from '../helpers/testEnv.js';
import { findDraftById } from '../../src/db/repositories/drafts.js';
import { getConversationState } from '../../src/db/repositories/states.js';

async function createPendingDraft(
  world: Awaited<ReturnType<typeof buildTestWorld>>,
  user: number,
  startUpdate: number,
) {
  await sendUpdate(world.app, textUpdate(startUpdate, user, '/new'));
  await sendUpdate(world.app, photoUpdate(startUpdate + 1, user, 'file-abc'));
  await sendUpdate(world.app, textUpdate(startUpdate + 2, user, '350 - 8'));
  return extractDraftId(world.telegram.lastMessage()!);
}

test('double-click publish: exactly one product created (spec §39)', async () => {
  const world = await buildTestWorld({ storeDelayMs: 120 });
  const user = 111;
  const draftId = await createPendingDraft(world, user, 1);

  // Click publish twice quickly (two CONCURRENT callback updates — a real double click)
  const first = sendUpdate(world.app, callbackUpdate(10, user, `publish:${draftId}`));
  const second = sendUpdate(world.app, callbackUpdate(11, user, `publish:${draftId}`));
  const results = await Promise.all([first, second]);
  for (const res of results) assert.equal(res.statusCode, 200);

  // Second click answered "in progress", no error
  const answers = world.telegram.answers.map((a) => a.text ?? '');
  assert.ok(answers.some((t) => t.includes('جاري النشر')));

  // Wait for the in-flight publish to settle
  await new Promise((r) => setTimeout(r, 300));

  // Exactly ONE product in the store
  assert.equal(world.store.products.length, 1);
  assert.equal(world.store.createCalls, 1);

  // Draft PUBLISHED with the product id
  const draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.status, 'PUBLISHED');
  assert.equal(draft.productId, world.store.products[0]!.id);
  assert.equal(getConversationState(world.db, chatIdFor(user)).state, 'PUBLISHED');

  // Success message contains the product link
  const last = world.telegram.lastMessage()!;
  assert.ok(last.text.includes('✅ تم نشر المنتج بنجاح'));
  assert.ok(last.text.includes(world.store.products[0]!.url));

  // A third click after success → "already published", still one product
  await sendUpdate(world.app, callbackUpdate(12, user, `publish:${draftId}`));
  assert.ok((world.telegram.answers.at(-1)!.text ?? '').includes('منشور بالفعل'));
  assert.equal(world.store.products.length, 1);

  await world.close();
});

test('publish failure: draft stays PENDING_APPROVAL, can retry safely', async () => {
  const world = await buildTestWorld();
  const user = 111;
  const draftId = await createPendingDraft(world, user, 1);

  // Make the store fail for the first attempt only
  world.store.products.length = 0;
  const originalHandle = world.store as unknown as { handle?: unknown };
  void originalHandle;
  (world.store as unknown as { failNext: boolean }).failNext = true;

  await sendUpdate(world.app, callbackUpdate(10, user, `publish:${draftId}`));
  let draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.status, 'PENDING_APPROVAL', 'draft reverted after failure');
  assert.ok(draft.publishError);
  assert.ok(world.telegram.lastMessage()!.text.includes('⚠️ تعذر نشر المنتج'));
  assert.ok(world.telegram.lastMessage()!.text.includes('تم الاحتفاظ بالمسودة'));

  // Retry succeeds → one product, PUBLISHED
  (world.store as unknown as { failNext: boolean }).failNext = false;
  await sendUpdate(world.app, callbackUpdate(11, user, `publish:${draftId}`));
  draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.status, 'PUBLISHED');
  assert.equal(world.store.products.length, 1);

  await world.close();
});

test('publish validation: missing fields block publishing', async () => {
  const world = await buildTestWorld();
  const user = 111;
  const draftId = await createPendingDraft(world, user, 1);

  // Clear the image URL to simulate a corrupted draft
  world.db.prepare('UPDATE product_drafts SET image_url = NULL WHERE id = ?').run(draftId);

  await sendUpdate(world.app, callbackUpdate(10, user, `publish:${draftId}`));
  const last = world.telegram.lastMessage()!;
  assert.ok(last.text.includes('لا يمكن النشر'));
  assert.ok(last.text.includes('الصورة'));
  assert.equal(world.store.createCalls, 0);

  const draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.status, 'PENDING_APPROVAL', 'still editable after failed validation');

  await world.close();
});

test('timeout after store creation: retry with same idempotency key does not duplicate', async () => {
  // Simulates: the store created the product but the automation timed out
  // waiting for the response. The retry must return the SAME product.
  const world = await buildTestWorld();
  const user = 111;
  const draftId = await createPendingDraft(world, user, 1);

  // Force the first attempt to "time out" (client-side) while the store
  // still creates the product.
  const client = world.storeClient;
  const originalCreate = client.createProduct.bind(client);
  let first = true;
  // @ts-expect-error monkey-patch for the test
  client.createProduct = async (input: unknown, key: string) => {
    if (first) {
      first = false;
      await originalCreate(input, key); // store creates the product...
      throw new Error('store API timeout'); // ...but the client "times out"
    }
    return originalCreate(input, key);
  };

  await sendUpdate(world.app, callbackUpdate(10, user, `publish:${draftId}`));
  // First attempt reported as failed → draft back to PENDING_APPROVAL
  let draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.status, 'PENDING_APPROVAL');

  // Retry (new user click) → same idempotency key → same product, no duplicate
  await sendUpdate(world.app, callbackUpdate(11, user, `publish:${draftId}`));
  draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.status, 'PUBLISHED');
  assert.equal(world.store.products.length, 1, 'no duplicate product after timeout+retry');
  assert.equal(draft.productId, world.store.products[0]!.id);

  await world.close();
});
