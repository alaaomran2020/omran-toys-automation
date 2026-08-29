/**
 * Price / Stock parser — pure code, NO AI involved (cost policy).
 *
 * Supported inputs:
 *   350 - 8
 *   350-8
 *   350 8
 *   السعر 350 الكمية 8
 *
 * Rejected:
 *   abc            → invalid_format
 *   -350 - 8       → invalid_price
 *   350 - abc      → invalid_format
 *   350            → invalid_format (missing stock)
 *
 * Validation: price > 0, stock >= 0 (integer).
 */

export interface PriceStock {
  price: number;
  stock: number;
}

export type ParseOutcome =
  | { ok: true; value: PriceStock }
  | { ok: false; reason: 'invalid_format' | 'invalid_price' | 'invalid_stock' };

const MAX_PRICE = 10_000_000;
const MAX_STOCK = 1_000_000;

const AR_PRICE_WORD = 'السعر';
const AR_STOCK_WORD = 'الكمية';

/** Convert Arabic-Indic and Extended-Indic digits to ASCII digits. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function parsePriceStock(rawInput: string): ParseOutcome {
  const normalized = normalizeDigits(rawInput ?? '').trim();
  if (normalized.length === 0) return { ok: false, reason: 'invalid_format' };

  // A leading dash means a negative price → reject (spec: "-350 - 8" is invalid).
  if (/^[-–—]/.test(normalized)) return { ok: false, reason: 'invalid_price' };

  // Treat remaining dash variants as separators.
  const input = normalized.replace(/[-–—]/g, ' ');

  // Labeled form: السعر 350 الكمية 8 (optionally with punctuation)
  const labeled = input.match(
    new RegExp(`${AR_PRICE_WORD}\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)\\s*${AR_STOCK_WORD}\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)`),
  );
  if (labeled) {
    if (new RegExp(`${AR_PRICE_WORD}\\s*[:=]?\\s*[-–—]\\s*\\d`).test(normalized)) {
      return { ok: false, reason: 'invalid_price' };
    }
    return finalize(Number(labeled[1]?.replace(',', '.')), Number(labeled[2]?.replace(',', '.')));
  }

  const tokens = [...input.matchAll(/\d+(?:[.,]\d+)?/g)];
  if (tokens.length !== 2) return { ok: false, reason: 'invalid_format' };
  const first = tokens[0]!;
  const second = tokens[1]!;

  // Anything besides the two numbers + known words/separators → reject.
  const wordsPattern = new RegExp(`${AR_PRICE_WORD}|${AR_STOCK_WORD}|كمية|كميه|جنيه|ج\\.?م`, 'g');
  const stripped = input
    .replace(first[0], ' ')
    .replace(second[0], ' ')
    .replace(wordsPattern, ' ')
    .replace(/[:=,،؛.]/g, ' ');
  if (stripped.trim().length > 0) return { ok: false, reason: 'invalid_format' };

  return finalize(Number(first[0].replace(',', '.')), Number(second[0].replace(',', '.')));
}

function finalize(priceRaw: number, stockRaw: number): ParseOutcome {
  const price = Math.round(priceRaw * 100) / 100;
  const stock = stockRaw;
  if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) return { ok: false, reason: 'invalid_price' };
  if (!Number.isInteger(stock) || stock < 0 || stock > MAX_STOCK) return { ok: false, reason: 'invalid_stock' };
  return { ok: true, value: { price, stock } };
}

/**
 * Standalone numeric/text field parser used by the EDIT flow (code only, no AI).
 */
export type FieldParse = { ok: true; value: string | number } | { ok: false; hint: string };

export function parseField(rawInput: string, kind: 'price' | 'stock' | 'name' | 'description'): FieldParse {
  const input = normalizeDigits(rawInput ?? '').trim();
  switch (kind) {
    case 'price': {
      if (!/^\d{1,8}(\.\d{1,2})?$/.test(input)) {
        return { ok: false, hint: 'أرسل رقماً صحيحاً أكبر من صفر، مثال: 299' };
      }
      const price = Number(input);
      if (price <= 0) return { ok: false, hint: 'السعر يجب أن يكون أكبر من صفر.' };
      return { ok: true, value: price };
    }
    case 'stock': {
      if (!/^\d{1,6}$/.test(input)) return { ok: false, hint: 'أرسل رقماً صحيحاً (صفر أو أكبر)، مثال: 8' };
      return { ok: true, value: Number(input) };
    }
    case 'name': {
      const name = input;
      if (name.length < 3 || name.length > 150) {
        return { ok: false, hint: 'الاسم يجب أن يكون بين 3 و 150 حرفاً.' };
      }
      return { ok: true, value: name };
    }
    case 'description': {
      const description = input;
      if (description.length < 5 || description.length > 1500) {
        return { ok: false, hint: 'الوصف يجب أن يكون بين 5 و 1500 حرف.' };
      }
      return { ok: true, value: description };
    }
  }
}
