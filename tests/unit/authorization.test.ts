import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorized, secureCompare } from '../../src/telegram/guards.js';
import { buildTestWorld, sendUpdate, textUpdate, callbackUpdate } from '../helpers/testEnv.js';

test('isAuthorized: whitelist only', () => {
  assert.ok(isAuthorized([111, 222], 111));
  assert.ok(isAuthorized([111, 222], 222));
  assert.ok(!isAuthorized([111, 222], 999));
  assert.ok(!isAuthorized([111, 222], null));
  assert.ok(!isAuthorized([111, 222], undefined));
  assert.ok(!isAuthorized([], 111));
});

test('secureCompare is constant-time style comparison', () => {
  assert.ok(secureCompare('abc', 'abc'));
  assert.ok(!secureCompare('abc', 'abd'));
  assert.ok(!secureCompare('abc', 'abcd'));
});

test('webhook: wrong secret → 403, no processing (spec §38)', async () => {
  const world = await buildTestWorld();
  const res = await sendUpdate(world.app, textUpdate(1, 111, '/new'), 'wrong-secret');
  assert.equal(res.statusCode, 403);
  assert.equal(world.telegram.messages.length, 0);
  await world.close();
});

test('webhook: missing secret → 403', async () => {
  const world = await buildTestWorld();
  const res = await world.app.inject({
    method: 'POST',
    url: '/api/telegram/webhook',
    payload: { update_id: 1, message: { text: '/new', chat: { id: 1, type: 'private' }, from: { id: 111 } } },
  });
  assert.equal(res.statusCode, 403);
  await world.close();
});

test('webhook: invalid payload shape → 400', async () => {
  const world = await buildTestWorld();
  const res = await sendUpdate(world.app, { garbage: true });
  assert.equal(res.statusCode, 400);
  await world.close();
});

test('unauthorized user: Access Denied, no AI / no store / no sensitive DB writes (spec §38)', async () => {
  const world = await buildTestWorld();
  const res = await sendUpdate(world.app, textUpdate(1, 999, '/new'));
  assert.equal(res.statusCode, 200);

  // Access denied message sent
  const last = world.telegram.messages.at(-1);
  assert.ok(last);
  assert.ok(last!.text.includes('Access Denied'));

  // AI never called, store never called
  assert.equal(world.analyzer.calls, 0);
  assert.equal(world.store.createCalls, 0);

  // Unauthorized user is NOT added to telegram_users (no sensitive DB operations)
  const row = world.db.prepare('SELECT * FROM telegram_users WHERE telegram_user_id = ?').get(999);
  assert.equal(row, undefined);

  // Callback queries from unauthorized users are rejected too
  await sendUpdate(world.app, callbackUpdate(2, 999, 'publish:some-draft-id'));
  const answer = world.telegram.answers.at(-1);
  assert.ok(answer);
  assert.ok((answer!.text ?? '').includes('Access Denied'));
  assert.equal(world.store.createCalls, 0);

  await world.close();
});
