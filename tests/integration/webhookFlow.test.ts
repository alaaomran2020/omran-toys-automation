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
import { getConversationState } from '../../src/db/repositories/states.js';
import { findDraftById } from '../../src/db/repositories/drafts.js';

test('commands: /start, /help, /new prompts', async () => {
  const world = await buildTestWorld();
  const user = 111;

  await sendUpdate(world.app, textUpdate(1, user, '/start'));
  assert.ok(world.telegram.lastMessage()!.text.includes('بوت إضافة المنتجات'));

  await sendUpdate(world.app, textUpdate(2, user, '/help'));
  assert.ok(world.telegram.lastMessage()!.text.includes('دليل الاستخدام'));

  await sendUpdate(world.app, textUpdate(3, user, '/new'));
  assert.equal(world.telegram.lastMessage()!.text, '📦 أرسل صورة المنتج.');
  assert.equal(getConversationState(world.db, chatIdFor(user)).state, 'WAITING_FOR_IMAGE');

  await world.close();
});

test('photo step: downloads, stores, asks for price/stock', async () => {
  const world = await buildTestWorld();
  const user = 111;

  await sendUpdate(world.app, textUpdate(1, user, '/new'));
  await sendUpdate(world.app, photoUpdate(2, user, 'file-abc'));

  // Image downloaded and stored on disk
  assert.deepEqual(world.telegram.downloadedFiles, ['files/test']);
  const files = world.media.directory;
  assert.ok(files.length > 0);

  // Correct prompt
  const last = world.telegram.lastMessage()!;
  assert.ok(last.text.includes('تم استلام الصورة ✅'));
  assert.ok(last.text.includes('350 - 8'));

  // State + log
  assert.equal(getConversationState(world.db, chatIdFor(user)).state, 'WAITING_FOR_PRICE_STOCK');
  const log = world.db.prepare("SELECT * FROM automation_logs WHERE action = 'PRODUCT_RECEIVED'").get() as
    | { meta: string }
    | undefined;
  assert.ok(log);
  const meta = JSON.parse(log!.meta) as { image: string };
  assert.ok(meta.image.startsWith('http://automation.test/api/media/'));

  await world.close();
});

test('unsupported image type is rejected', async () => {
  const world = await buildTestWorld();
  const user = 111;
  await sendUpdate(world.app, textUpdate(1, user, '/new'));
  await sendUpdate(world.app, photoUpdate(2, user, 'file-x', 'image/gif'));
  assert.ok(world.telegram.lastMessage()!.text.includes('JPG/PNG/WEBP'));
  await world.close();
});

test('invalid price/stock input keeps the flow waiting and explains the format', async () => {
  const world = await buildTestWorld();
  const user = 111;

  await sendUpdate(world.app, textUpdate(1, user, '/new'));
  await sendUpdate(world.app, photoUpdate(2, user, 'file-abc'));

  for (const bad of ['abc', '350', '-350 - 8', '350 - abc', '350 8 9']) {
    await sendUpdate(world.app, textUpdate(3, user, bad));
    assert.ok(world.telegram.lastMessage()!.text.includes('لم أفهم السعر والكمية'), `expected rejection for "${bad}"`);
  }
  // State unchanged, AI never called
  assert.equal(getConversationState(world.db, chatIdFor(user)).state, 'WAITING_FOR_PRICE_STOCK');
  assert.equal(world.analyzer.calls, 0);

  await world.close();
});

test('webhook retry: same update_id is processed exactly once', async () => {
  const world = await buildTestWorld();
  const user = 111;

  const update = textUpdate(1, user, '/new');
  await sendUpdate(world.app, update);
  await sendUpdate(world.app, update); // retry

  const newMessages = world.telegram.messages.filter((m) => m.text === '📦 أرسل صورة المنتج.');
  assert.equal(newMessages.length, 1);

  await world.close();
});

test('AI failure: no crash, no draft, safe retry after resending price (spec §30/§37)', async () => {
  let shouldFail = true;
  const { FakeAnalyzer } = await import('../helpers/testEnv.js');
  const analyzer = new FakeAnalyzer(() => {
    if (shouldFail) throw new Error('AI request failed with status 500');
    return {
      name: 'منتج ناجح',
      shortDescription: 'وصف قصير',
      description: 'وصف طويل',
      category: 'مكعبات',
      brand: null,
      color: null,
      ageRange: null,
      features: [],
      keywords: ['بناء'],
    };
  });
  const world = await buildTestWorld({ analyzer });
  const user = 111;

  await sendUpdate(world.app, textUpdate(1, user, '/new'));
  await sendUpdate(world.app, photoUpdate(2, user, 'file-abc'));
  const res = await sendUpdate(world.app, textUpdate(3, user, '350 - 8'));
  assert.equal(analyzer.calls, 1);

  assert.equal(res.statusCode, 200, 'webhook must not crash');
  assert.ok(world.telegram.lastMessage()!.text.includes('⚠️ حدث خطأ أثناء تحليل المنتج'));

  // No draft created
  const drafts = world.db.prepare('SELECT COUNT(*) AS c FROM product_drafts').get() as { c: number };
  assert.equal(drafts.c, 0);

  // State is ERROR with retry context
  assert.equal(getConversationState(world.db, chatIdFor(user)).state, 'ERROR');

  // Retry: resend price/stock
  shouldFail = false;
  await sendUpdate(world.app, textUpdate(4, user, '350 - 8'));
  const draft = world.db.prepare('SELECT * FROM product_drafts LIMIT 1').get() as { id: string } | undefined;
  assert.ok(draft, 'draft created after retry');
  assert.equal(getConversationState(world.db, chatIdFor(user)).state, 'PENDING_APPROVAL');

  await world.close();
});

test('edit flow: price/stock/name/category updated by code, no AI', async () => {
  const world = await buildTestWorld();
  const user = 111;
  const chat = chatIdFor(user);

  await sendUpdate(world.app, textUpdate(1, user, '/new'));
  await sendUpdate(world.app, photoUpdate(2, user, 'file-abc'));
  await sendUpdate(world.app, textUpdate(3, user, '350 - 8'));
  const preview = world.telegram.lastMessage()!;
  const draftId = extractDraftId(preview);

  // Edit price
  await sendUpdate(world.app, callbackUpdate(4, user, `edit:${draftId}`));
  assert.ok(world.telegram.lastMessage()!.text.includes('اختر الحقل'));
  await sendUpdate(world.app, callbackUpdate(5, user, `field:${draftId}:price`));
  assert.ok(world.telegram.lastMessage()!.text.includes('أرسل السعر الجديد'));
  await sendUpdate(world.app, textUpdate(6, user, '299'));
  let draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.price, 299);

  // Invalid price is rejected, stays in edit
  await sendUpdate(world.app, callbackUpdate(7, user, `field:${draftId}:price`));
  await sendUpdate(world.app, textUpdate(8, user, 'abc'));
  assert.ok(world.telegram.lastMessage()!.text.includes('غير صالحة'));
  draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.price, 299);

  // Edit stock → 5
  await sendUpdate(world.app, callbackUpdate(9, user, `field:${draftId}:stock`));
  await sendUpdate(world.app, textUpdate(10, user, '5'));
  draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.stock, 5);

  // Edit category
  await sendUpdate(world.app, callbackUpdate(11, user, `field:${draftId}:category`));
  await sendUpdate(world.app, textUpdate(12, user, 'سيارات ريموت'));
  draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.categoryId, 'rc-electronic');

  // Edit name
  await sendUpdate(world.app, callbackUpdate(13, user, `field:${draftId}:name`));
  await sendUpdate(world.app, textUpdate(14, user, 'سيارة دريفت برو 2'));
  draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.name, 'سيارة دريفت برو 2');

  // AI was called exactly once total (no AI in edits)
  assert.equal(world.analyzer.calls, 1);

  // Preview was re-sent after each successful edit
  const previews = world.telegram.messages.filter((m) => m.text.includes('🛍️ منتج جديد جاهز'));
  assert.ok(previews.length >= 5);
  assert.equal(getConversationState(world.db, chat).state, 'PENDING_APPROVAL');

  await world.close();
});

test('cancel flow: draft CANCELLED, not publishable', async () => {
  const world = await buildTestWorld();
  const user = 111;

  await sendUpdate(world.app, textUpdate(1, user, '/new'));
  await sendUpdate(world.app, photoUpdate(2, user, 'file-abc'));
  await sendUpdate(world.app, textUpdate(3, user, '350 - 8'));
  const draftId = extractDraftId(world.telegram.lastMessage()!);

  await sendUpdate(world.app, callbackUpdate(4, user, `cancel:${draftId}`));
  const draft = findDraftById(world.db, draftId)!;
  assert.equal(draft.status, 'CANCELLED');
  assert.ok(world.telegram.lastMessage()!.text.includes('تم إلغاء المسودة'));

  // Publishing a cancelled draft is refused
  await sendUpdate(world.app, callbackUpdate(5, user, `publish:${draftId}`));
  assert.ok((world.telegram.answers.at(-1)!.text ?? '').includes('ملغاة'));
  assert.equal(world.store.createCalls, 0);

  await world.close();
});

test('/pending lists pending drafts with preview buttons', async () => {
  const world = await buildTestWorld();
  const user = 111;

  await sendUpdate(world.app, textUpdate(1, user, '/new'));
  await sendUpdate(world.app, textUpdate(2, user, '/pending'));
  assert.ok(world.telegram.lastMessage()!.text.includes('لا توجد مسودات'));

  await sendUpdate(world.app, photoUpdate(3, user, 'file-abc'));
  await sendUpdate(world.app, textUpdate(4, user, '350 - 8'));
  const draftId = extractDraftId(world.telegram.lastMessage()!);

  await sendUpdate(world.app, textUpdate(5, user, '/pending'));
  const msg = world.telegram.lastMessage()!;
  assert.ok(msg.text.includes('مسوداتك قيد الانتظار'));
  assert.ok(msg.text.includes('350'));
  const markup = msg.options?.replyMarkup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
  assert.ok(markup.inline_keyboard.flat().some((b) => b.callback_data === `show:${draftId}`));

  await world.close();
});
