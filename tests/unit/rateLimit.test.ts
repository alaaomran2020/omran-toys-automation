import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlidingWindowRateLimiter } from '../../src/core/rateLimit.js';

test('allows up to the limit within the window', () => {
  const now = 1000;
  const limiter = new SlidingWindowRateLimiter(() => now);
  assert.ok(limiter.allow('k', 3, 1000));
  assert.ok(limiter.allow('k', 3, 1000));
  assert.ok(limiter.allow('k', 3, 1000));
  assert.ok(!limiter.allow('k', 3, 1000));
});

test('window slides: old hits expire', () => {
  let now = 1000;
  const limiter = new SlidingWindowRateLimiter(() => now);
  assert.ok(limiter.allow('k', 1, 1000));
  assert.ok(!limiter.allow('k', 1, 1000));
  now = 2001; // 1001ms later → previous hit expired
  assert.ok(limiter.allow('k', 1, 1000));
});

test('keys are independent (per chat)', () => {
  const limiter = new SlidingWindowRateLimiter();
  assert.ok(limiter.allow('chat-1', 1, 60_000));
  assert.ok(!limiter.allow('chat-1', 1, 60_000));
  assert.ok(limiter.allow('chat-2', 1, 60_000));
});
