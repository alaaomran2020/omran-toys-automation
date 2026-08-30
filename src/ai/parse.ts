import { AiParseError } from './provider.js';
import type { AiAnalysis } from './provider.js';

/**
 * Defensive parsing of the AI response.
 *
 * Requirements (spec §37):
 *  - invalid JSON  → AiParseError (no crash, nothing published)
 *  - code fences, surrounding prose → tolerated
 *  - wrong field types / missing fields → AiParseError
 *  - ageRange is normalized into the store's allowed set (otherwise null)
 */

const ALLOWED_AGE_RANGES: readonly string[] = ['0-2', '3-5', '6-8', '9-12', '12+'];

export function parseAiAnalysis(raw: string): AiAnalysis {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new AiParseError('AI response is empty');
  }
  let text = raw.trim();

  // Tolerate ```json fences
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new AiParseError('AI response does not contain a JSON object');
  }

  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AiParseError('AI response is not valid JSON');
  }
  return validateAnalysis(json);
}

function requireString(obj: Record<string, unknown>, key: string, max: number): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AiParseError(`missing or invalid field: ${key}`);
  }
  const s = value.trim();
  if (s.length > max) throw new AiParseError(`field too long: ${key}`);
  return s;
}

function optionalString(obj: Record<string, unknown>, key: string, max: number): string | null {
  const value = obj[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AiParseError(`invalid field: ${key}`);
  const s = value.trim();
  if (s.length === 0) return null;
  if (s.length > max) throw new AiParseError(`field too long: ${key}`);
  return s;
}

function stringArray(obj: Record<string, unknown>, key: string, maxItems: number, maxItemLen: number): string[] {
  const value = obj[key];
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new AiParseError(`invalid field: ${key}`);
  const items: string[] = [];
  for (const item of value.slice(0, maxItems)) {
    if (typeof item !== 'string') throw new AiParseError(`invalid item in ${key}`);
    const s = item.trim();
    if (s.length > 0 && s.length <= maxItemLen) items.push(s);
  }
  return items;
}

function parseAgeRange(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  if ((ALLOWED_AGE_RANGES as readonly string[]).includes(s)) return s;
  if (/12\s*\+/.test(s)) return '12+';
  const match = s.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})/);
  if (match) {
    const lo = Number(match[1]);
    const hi = Number(match[2]);
    for (const range of ALLOWED_AGE_RANGES) {
      if (range === '12+') continue;
      const [a, b] = range.split('-').map(Number);
      if (a === lo && b === hi) return range;
    }
  }
  return null;
}

/** Validate a parsed JSON value into the strict AiAnalysis shape. Exported for tests. */
export function validateAnalysis(json: unknown): AiAnalysis {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new AiParseError('AI response is not a JSON object');
  }
  const obj = json as Record<string, unknown>;
  return {
    name: requireString(obj, 'name', 150),
    shortDescription: requireString(obj, 'shortDescription', 300),
    description: requireString(obj, 'description', 1500),
    category: optionalString(obj, 'category', 100),
    brand: optionalString(obj, 'brand', 80),
    color: optionalString(obj, 'color', 40),
    ageRange: parseAgeRange(obj.ageRange),
    features: stringArray(obj, 'features', 8, 120),
    keywords: stringArray(obj, 'keywords', 10, 40),
  };
}
