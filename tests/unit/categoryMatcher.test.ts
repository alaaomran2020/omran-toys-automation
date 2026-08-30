import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCategory, normalizeArabic, getCategoryDisplayName } from '../../src/core/categoryMatcher.js';

test('normalization unifies Arabic variants', () => {
  assert.equal(normalizeArabic('ألعاب'), normalizeArabic('العاب')); // alef variants
  assert.equal(normalizeArabic('سياره'), normalizeArabic('سيارة')); // ta-marbuta vs heh
  assert.equal(normalizeArabic('بئر'), normalizeArabic('بير')); // hamza-on-ya unifies
  assert.equal(normalizeArabic('  تحكم   عن   بعد '), 'تحكم عن بعد'); // whitespace
  assert.equal(normalizeArabic('STEM'), 'stem'); // case
});

test('exact match on category names', () => {
  assert.equal(matchCategory('تحكم عن بعد'), 'rc-electronic');
  assert.equal(matchCategory('مكعبات وبناء'), 'building');
  assert.equal(matchCategory('تعليمية وذكاء STEM'), 'educational');
});

test('alias match: remote control synonyms map to the same category', () => {
  assert.equal(matchCategory('ألعاب ريموت'), 'rc-electronic');
  assert.equal(matchCategory('سيارات ريموت'), 'rc-electronic');
  assert.equal(matchCategory('سيارات تحكم عن بعد'), 'rc-electronic');
  assert.equal(matchCategory('درون'), 'rc-electronic');
  assert.equal(matchCategory('ليجو'), 'building');
});

test('substring containment picks the best alias', () => {
  assert.equal(matchCategory('ألعاب ريموت كهربائية'), 'rc-electronic');
  assert.equal(matchCategory('طقم مكعبات بناء'), 'building');
});

test('no match → null (no auto-creation in MVP)', () => {
  assert.equal(matchCategory('مستهلكات'), null);
  assert.equal(matchCategory(''), null);
  assert.equal(matchCategory('???'), null);
});

test('display name lookup', () => {
  assert.equal(getCategoryDisplayName('rc-electronic'), 'تحكم عن بعد وروبوتات');
  assert.equal(getCategoryDisplayName(null), '—');
});
