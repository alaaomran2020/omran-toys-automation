import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, CHAT_STATES } from '../../src/db/repositories/states.js';

test('all spec states exist', () => {
  const expected = [
    'IDLE',
    'WAITING_FOR_IMAGE',
    'WAITING_FOR_PRICE_STOCK',
    'ANALYZING',
    'PENDING_APPROVAL',
    'EDITING',
    'PUBLISHING',
    'PUBLISHED',
    'CANCELLED',
    'ERROR',
  ];
  for (const s of expected) assert.ok(CHAT_STATES.includes(s as (typeof CHAT_STATES)[number]), `missing state ${s}`);
});

test('happy path transitions are allowed', () => {
  assert.ok(canTransition('IDLE', 'WAITING_FOR_IMAGE'));
  assert.ok(canTransition('WAITING_FOR_IMAGE', 'WAITING_FOR_PRICE_STOCK'));
  assert.ok(canTransition('WAITING_FOR_PRICE_STOCK', 'ANALYZING'));
  assert.ok(canTransition('ANALYZING', 'PENDING_APPROVAL'));
  assert.ok(canTransition('PENDING_APPROVAL', 'PUBLISHING'));
  assert.ok(canTransition('PUBLISHING', 'PUBLISHED'));
});

test('approval-flow transitions are allowed', () => {
  assert.ok(canTransition('PENDING_APPROVAL', 'EDITING'));
  assert.ok(canTransition('EDITING', 'PENDING_APPROVAL'));
  assert.ok(canTransition('PENDING_APPROVAL', 'CANCELLED'));
  assert.ok(canTransition('PENDING_APPROVAL', 'ANALYZING')); // re-analyze
  assert.ok(canTransition('PUBLISHING', 'PENDING_APPROVAL')); // publish failed → keep draft
});

test('error recovery is allowed', () => {
  assert.ok(canTransition('ANALYZING', 'ERROR'));
  assert.ok(canTransition('ERROR', 'WAITING_FOR_PRICE_STOCK'));
});

test('terminal states have no outgoing transitions (except restart)', () => {
  assert.ok(!canTransition('PUBLISHED', 'PUBLISHING'));
  assert.ok(!canTransition('PUBLISHED', 'EDITING'));
  assert.ok(!canTransition('CANCELLED', 'PUBLISHING'));
});

test('illegal transitions are rejected', () => {
  assert.ok(!canTransition('IDLE', 'PUBLISHING'));
  assert.ok(!canTransition('IDLE', 'PENDING_APPROVAL'));
  assert.ok(!canTransition('IDLE', 'EDITING'));
  assert.ok(!canTransition('PUBLISHED', 'PENDING_APPROVAL'));
  assert.ok(!canTransition('CANCELLED', 'PENDING_APPROVAL'));
});

test('restart to IDLE is always allowed', () => {
  for (const s of CHAT_STATES) assert.ok(canTransition(s, 'IDLE'));
});
