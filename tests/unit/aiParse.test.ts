import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAiAnalysis, validateAnalysis } from '../../src/ai/parse.js';
import { AiParseError } from '../../src/ai/provider.js';

const VALID = {
  name: 'سيارة دريفت RC',
  shortDescription: 'سيارة دريفت سريعة',
  description: 'سيارة دريفت قوية. تشمل بطارية.',
  category: 'تحكم عن بعد',
  brand: null,
  color: 'أحمر',
  ageRange: '6-8',
  features: ['تحكم عن بعد'],
  keywords: ['سيارة', 'درفت'],
};

test('parses a valid JSON response', () => {
  const out = parseAiAnalysis(JSON.stringify(VALID));
  assert.equal(out.name, 'سيارة دريفت RC');
  assert.equal(out.category, 'تحكم عن بعد');
  assert.equal(out.brand, null);
  assert.deepEqual(out.features, ['تحكم عن بعد']);
});

test('tolerates code fences and surrounding prose', () => {
  const raw = 'إليك النتيجة:\n```json\n' + JSON.stringify(VALID) + '\n```\nتم.';
  const out = parseAiAnalysis(raw);
  assert.equal(out.name, 'سيارة دريفت RC');
});

test('invalid JSON throws AiParseError (spec §37: no crash, nothing published)', () => {
  assert.throws(() => parseAiAnalysis('هذا ليس json { broken'), AiParseError);
  assert.throws(() => parseAiAnalysis(''), AiParseError);
  assert.throws(() => parseAiAnalysis('no braces here at all'), AiParseError);
  assert.throws(() => parseAiAnalysis('{ "name": "broken," }'), AiParseError);
});

test('wrong field types throw', () => {
  const bad = { ...VALID, name: 123 };
  assert.throws(() => validateAnalysis(bad), AiParseError);
  const bad2 = { ...VALID, features: 'not-an-array' };
  assert.throws(() => validateAnalysis(bad2), AiParseError);
});

test('missing required fields throw', () => {
  const { name, ...rest } = VALID;
  assert.throws(() => validateAnalysis(rest), AiParseError);
  const { description, ...rest2 } = VALID;
  assert.throws(() => validateAnalysis(rest2), AiParseError);
});

test('non-object JSON throws', () => {
  assert.throws(() => validateAnalysis(['array']), AiParseError);
  assert.throws(() => validateAnalysis('string'), AiParseError);
  assert.throws(() => validateAnalysis(null), AiParseError);
});

test('ageRange is normalized to the store allowed set', () => {
  const base = () => ({ ...VALID });
  assert.equal(parseAiAnalysis(JSON.stringify({ ...base(), ageRange: '3-5' })).ageRange, '3-5');
  assert.equal(parseAiAnalysis(JSON.stringify({ ...base(), ageRange: '3-5 سنوات' })).ageRange, '3-5');
  assert.equal(parseAiAnalysis(JSON.stringify({ ...base(), ageRange: '12+' })).ageRange, '12+');
  assert.equal(parseAiAnalysis(JSON.stringify({ ...base(), ageRange: 'من 9 إلى 12' })).ageRange, null);
  assert.equal(parseAiAnalysis(JSON.stringify({ ...base(), ageRange: '100-200' })).ageRange, null);
  assert.equal(parseAiAnalysis(JSON.stringify({ ...base(), ageRange: null })).ageRange, null);
});

test('arrays are truncated to the max items', () => {
  const out = parseAiAnalysis(
    JSON.stringify({
      ...VALID,
      features: Array.from({ length: 20 }, (_, i) => `ميزة ${i}`),
    }),
  );
  assert.equal(out.features.length, 8);
});

test('non-string items inside arrays throw (strict validation)', () => {
  assert.throws(() => parseAiAnalysis(JSON.stringify({ ...VALID, keywords: ['a', 5, 'b'] })), AiParseError);
});
