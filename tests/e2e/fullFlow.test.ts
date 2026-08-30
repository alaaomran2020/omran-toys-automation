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

/**
 * PRODUCTION ACCEPTANCE TEST (spec §43)
 *
 * /new → "📦 أرسل صورة المنتج." → photo → "تم استلام الصورة ✅ … 350 - 8" →
 * "350 - 8" → validate → ONE AI call → draft → preview → ✅ publish →
 * store API → product created → draft PUBLISHED → "✅ تم نشر المنتج بنجاح"
 * → real product link → product visible in store catalog.
 */
test('E2E: full product creation flow from Telegram to the store', async () => {
  const world = await buildTestWorld();
  const user = 111;
  const chat = chatIdFor(user);

  // STEP 1-2: employee sends /new → bot asks for the image
  await sendUpdate(world.app, textUpdate(1, user, '/new'));
  assert.equal(world.telegram.lastMessage()!.text, '📦 أرسل صورة المنتج.');

  // STEP 3: employee sends a photo
  await sendUpdate(world.app, photoUpdate(2, user, 'photo-file-1'));

  // STEP 4: bot confirms and asks for price/stock
  const pricePrompt = world.telegram.lastMessage()!;
  assert.ok(pricePrompt.text.includes('تم استلام الصورة ✅'));
  assert.ok(pricePrompt.text.includes('350 - 8'));

  // STEP 5: employee sends "350 - 8"
  await sendUpdate(world.app, textUpdate(3, user, '350 - 8'));

  // STEP 6: backend validated (no invalid-input error message was sent)
  const errorMessages = world.telegram.messages.filter((m) => m.text.includes('لم أفهم السعر'));
  assert.equal(errorMessages.length, 0);

  // STEP 7: exactly ONE AI call (cost policy)
  assert.equal(world.analyzer.calls, 1);
  const aiInput = world.analyzer.inputs[0]!;
  assert.equal(aiInput.price, 350);
  assert.equal(aiInput.stock, 8);
  assert.equal(aiInput.mimeType, 'image/jpeg');
  assert.ok(aiInput.imageBase64.length > 0);

  // STEP 8: draft created
  const draftRow = world.db.prepare('SELECT * FROM product_drafts LIMIT 1').get() as
    | Record<string, unknown>
    | undefined;
  assert.ok(draftRow, 'draft row exists');

  // STEP 9: Telegram preview with buttons
  const preview = world.telegram.lastMessage()!;
  assert.ok(preview.text.includes('🛍️ منتج جديد جاهز'));
  assert.ok(preview.text.includes('📦 الاسم:'));
  assert.ok(preview.text.includes('350 جنيه'));
  assert.ok(preview.text.includes('📊 المخزون:'));
  assert.ok(preview.text.includes('8'));
  assert.ok(preview.text.includes('🏷️ التصنيف:'));
  assert.ok(preview.text.includes(' الوصف:'));
  const markup = preview.options?.replyMarkup as { inline_keyboard: Array<Array<{ text: string }>> };
  const buttonTexts = markup.inline_keyboard.flat().map((b) => b.text);
  assert.ok(buttonTexts.includes('✅ نشر المنتج'));
  assert.ok(buttonTexts.includes('✏️ تعديل'));
  assert.ok(buttonTexts.includes('🔄 إعادة تحليل'));
  assert.ok(buttonTexts.includes('❌ إلغاء'));

  const draftId = extractDraftId(preview);
  assert.equal(getConversationState(world.db, chat).state, 'PENDING_APPROVAL');

  // STEP 10: employee presses ✅ publish
  await sendUpdate(world.app, callbackUpdate(4, user, `publish:${draftId}`));

  // STEP 11-12: store API received the product and created it
  assert.equal(world.store.createCalls, 1);
  const product = world.store.products[0]!;
  assert.equal(product.body.retail_price, 350);
  assert.equal(product.body.stock_quantity, 8);
  assert.equal(product.body.category_id, 'rc-electronic'); // matched from "تحكم عن بعد"
  assert.equal(product.body.age_group, '6-8');
  assert.equal(product.body.sku, `OMR-AUTO-${draftId.slice(0, 8)}`);
  assert.ok(Array.isArray(product.body.images));
  assert.ok(String((product.body.images as string[])[0]).startsWith('http://automation.test/api/media/'));

  // STEP 13: draft PUBLISHED with product id
  const draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.status, 'PUBLISHED');
  assert.equal(draft.productId, product.id);
  assert.equal(draft.productUrl, product.url);
  assert.equal(getConversationState(world.db, chat).state, 'PUBLISHED');

  // STEP 14-15: success message with the REAL product link
  const success = world.telegram.lastMessage()!;
  assert.ok(success.text.includes('✅ تم نشر المنتج بنجاح'));
  assert.ok(success.text.includes(product.url!));

  // STEP 16: product is visible in the store catalog (GET /api/products)
  const catalogRes = await fetch(`${world.store.url}/api/products`);
  const catalog = (await catalogRes.json()) as Array<Record<string, unknown>>;
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0]!.id, product.id);
  assert.equal(catalog[0]!.price, 350);
  assert.equal(catalog[0]!.stock, 8);
  assert.equal(catalog[0]!.category, 'rc-electronic');

  // Audit log contains the full event trail
  const actions = (
    world.db.prepare('SELECT action FROM automation_logs ORDER BY id').all() as Array<{ action: string }>
  ).map((r) => r.action);
  for (const expected of [
    'PRODUCT_RECEIVED',
    'PRICE_STOCK_RECEIVED',
    'AI_ANALYSIS_STARTED',
    'AI_ANALYSIS_COMPLETED',
    'DRAFT_CREATED',
    'PUBLISH_STARTED',
    'PRODUCT_PUBLISHED',
  ]) {
    assert.ok(actions.includes(expected), `missing log action: ${expected}`);
  }

  await world.close();
});

test('E2E: re-analyze costs exactly one extra AI call and updates the draft', async () => {
  const world = await buildTestWorld();
  const user = 111;

  await sendUpdate(world.app, textUpdate(1, user, '/new'));
  await sendUpdate(world.app, photoUpdate(2, user, 'photo-file-1'));
  await sendUpdate(world.app, textUpdate(3, user, '350 - 8'));
  const draftId = extractDraftId(world.telegram.lastMessage()!);
  assert.equal(world.analyzer.calls, 1);

  // Employee presses 🔄 re-analyze (explicit extra AI call)
  await sendUpdate(world.app, callbackUpdate(4, user, `reanalyze:${draftId}`));
  assert.equal(world.analyzer.calls, 2, 're-analyze is the only permitted extra AI call');

  const draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.status, 'PENDING_APPROVAL');
  assert.equal(draft.aiCallCount, 2);
  // Price/stock are preserved from the original flow
  assert.equal(draft.price, 350);
  assert.equal(draft.stock, 8);

  // A new preview was sent
  assert.ok(world.telegram.lastMessage()!.text.includes('🛍️ منتج جديد جاهز'));

  await world.close();
});
