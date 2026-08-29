import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseField, parsePriceStock } from '../../src/core/priceParser.js';

test('price parser: supports the spec formats', () => {
  assert.deepEqual(parsePriceStock('350 - 8'), { ok: true, value: { price: 350, stock: 8 } });
  assert.deepEqual(parsePriceStock('350-8'), { ok: true, value: { price: 350, stock: 8 } });
  assert.deepEqual(parsePriceStock('350 8'), { ok: true, value: { price: 350, stock: 8 } });
  assert.deepEqual(parsePriceStock('السعر 350 الكمية 8'), { ok: true, value: { price: 350, stock: 8 } });
});

test('price parser: tolerates extra whitespace and Arabic digits', () => {
  assert.deepEqual(parsePriceStock('  350   -   8  '), { ok: true, value: { price: 350, stock: 8 } });
  assert.deepEqual(parsePriceStock('٣٥٠ - ٨'), { ok: true, value: { price: 350, stock: 8 } });
});

test('price parser: supports decimal prices and zero stock', () => {
  assert.deepEqual(parsePriceStock('199.5 - 0'), { ok: true, value: { price: 199.5, stock: 0 } });
});

test('price parser: rejects the spec invalid inputs', () => {
  assert.equal(parsePriceStock('abc').ok, false);
  assert.equal(parsePriceStock('-350 - 8').ok, false);
  assert.equal(parsePriceStock('-350 - 8').reason, 'invalid_price');
  assert.equal(parsePriceStock('350 - abc').ok, false);
  assert.equal(parsePriceStock('350').ok, false);
});

test('price parser: rejects negative and zero prices', () => {
  assert.equal(parsePriceStock('0 - 8').ok, false);
  assert.equal(parsePriceStock('0 - 8').reason, 'invalid_price');
  assert.equal(parsePriceStock('-350 - 8').reason, 'invalid_price');
  assert.equal(parsePriceStock('السعر -350 الكمية 8').ok, false);
});

test('price parser: rejects garbage around the numbers', () => {
  assert.equal(parsePriceStock('abc 350 8').ok, false);
  assert.equal(parsePriceStock('350 8 abc').ok, false);
  assert.equal(parsePriceStock('350 8 9').ok, false);
  assert.equal(parsePriceStock('').ok, false);
});

test('price parser: rejects stock with decimals', () => {
  assert.equal(parsePriceStock('350 8.5').ok, false);
  assert.equal(parsePriceStock('350 8.5').reason, 'invalid_stock');
});

test('field parser: price', () => {
  assert.deepEqual(parseField('299', 'price'), { ok: true, value: 299 });
  assert.deepEqual(parseField('299.5', 'price'), { ok: true, value: 299.5 });
  assert.equal(parseField('0', 'price').ok, false);
  assert.equal(parseField('-5', 'price').ok, false);
  assert.equal(parseField('abc', 'price').ok, false);
});

test('field parser: stock', () => {
  assert.deepEqual(parseField('0', 'stock'), { ok: true, value: 0 });
  assert.deepEqual(parseField('12', 'stock'), { ok: true, value: 12 });
  assert.equal(parseField('-1', 'stock').ok, false);
  assert.equal(parseField('1.5', 'stock').ok, false);
});

test('field parser: name / description bounds', () => {
  assert.equal(parseField('ab', 'name').ok, false);
  assert.deepEqual(parseField('لعبة جديدة', 'name'), { ok: true, value: 'لعبة جديدة' });
  assert.equal(parseField('abc', 'description').ok, false);
  assert.equal(parseField('وصف المنتج الكامل هنا', 'description').ok, true);
});
