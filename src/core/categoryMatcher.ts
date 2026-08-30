/**
 * Category matching — pure code, NO AI involved.
 *
 * The AI only suggests a category NAME; the backend resolves it to the
 * store's category ID via:  normalize → exact match → alias match → null.
 *
 * Category IDs mirror omrantoys-store `src/data/categories.js`.
 * If no match is found, categoryId stays null (no auto-creation in MVP).
 */

export interface CategoryDef {
  id: string;
  nameAr: string;
  nameEn: string;
}

export const STORE_CATEGORIES: CategoryDef[] = [
  { id: 'educational', nameAr: 'تعليمية وذكاء STEM', nameEn: 'Educational & STEM' },
  { id: 'building', nameAr: 'مكعبات وبناء', nameEn: 'Building & Blocks' },
  { id: 'rc-electronic', nameAr: 'تحكم عن بعد وروبوتات', nameEn: 'RC & Robotics' },
  { id: 'dolls-figures', nameAr: 'دمى وشخصيات أبطال', nameEn: 'Dolls & Action Figures' },
  { id: 'board-games', nameAr: 'ألعاب عائلية ولوحية', nameEn: 'Board Games & Puzzles' },
  { id: 'outdoor', nameAr: 'حركية وخارجية', nameEn: 'Outdoor & Ride-ons' },
  { id: 'infant', nameAr: 'الرضع والطفولة المبكرة', nameEn: 'Infant & Toddler' },
  { id: 'arts-crafts', nameAr: 'فنون وإبداع وصلصال', nameEn: 'Arts & Crafts' },
];

const RAW_ALIASES: Array<{ id: string; aliases: string[] }> = [
  {
    id: 'rc-electronic',
    aliases: [
      'rc-electronic',
      'rc',
      'تحكم عن بعد',
      'سيارات ريموت',
      'العاب ريموت',
      'سيارات تحكم عن بعد',
      'العاب تحكم عن بعد',
      'ريموت',
      'درون',
      'طائرات درون',
      'روبوت',
      'روبوتات',
      'سيارات لاسلكية',
      'سيارة',
      'طائرة',
      'تحكم',
    ],
  },
  {
    id: 'building',
    aliases: ['building', 'مكعبات', 'بناء', 'لعب بناء', 'ليجو', 'لغو', 'مكعبات بناء', 'تراكات'],
  },
  {
    id: 'educational',
    aliases: [
      'educational',
      'stem',
      'تعليمية',
      'العاب تعليمية',
      'ذكاء',
      'العاب ذكاء',
      'تجارب علمية',
      'مجهر',
      'معمل',
      'تعليم',
    ],
  },
  {
    id: 'dolls-figures',
    aliases: ['dolls-figures', 'دمى', 'دمية', 'شخصيات', 'ابطال', 'شخصيات ابطال', 'باربي', 'فيلت'],
  },
  {
    id: 'board-games',
    aliases: ['board-games', 'لوحية', 'العاب لوحية', 'العاب عائلية', 'بورد', 'بوردجيمز', 'الغاز'],
  },
  {
    id: 'outdoor',
    aliases: ['outdoor', 'خارجية', 'حركية', 'سكوتر', 'دراجه', 'دراجات', 'ركوب', 'تزلج', 'دراجة'],
  },
  {
    id: 'infant',
    aliases: ['infant', 'رضع', 'رضاعة', 'طفوله مبكره', 'مولود', 'مواليد', 'رضيع'],
  },
  {
    id: 'arts-crafts',
    aliases: ['arts-crafts', 'فنون', 'ابداع', 'صلصال', 'رسم', 'فنيه', 'اصباغ', 'لوح'],
  },
];

/**
 * Arabic normalization for robust matching:
 * strip diacritics, unify alef/ya/tatweel/ta-marbuta, remove LRM/RLM,
 * collapse whitespace, lowercase.
 */
export function normalizeArabic(input: string): string {
  return (input ?? '')
    .toLowerCase()
    .replace(/[\u064b-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u200e\u200f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ResolvedAlias {
  id: string;
  aliases: string[];
}

const ALIASES: ResolvedAlias[] = RAW_ALIASES.map((entry) => ({
  id: entry.id,
  aliases: entry.aliases.map(normalizeArabic).filter((a) => a.length > 0),
}));

/**
 * Resolve a category name (AI suggestion or employee input) to a store
 * category id. Returns null when nothing matches (draft keeps categoryId = null).
 */
export function matchCategory(input: string): string | null {
  const query = normalizeArabic(input);
  if (!query) return null;

  // 1) Exact match on category id or alias
  for (const entry of ALIASES) {
    if (entry.id === query || entry.aliases.includes(query)) return entry.id;
  }

  // 2) Alias containment — longest overlap wins (handles "ألعاب ريموت كهربائية")
  let bestId: string | null = null;
  let bestScore = 0;
  for (const entry of ALIASES) {
    for (const alias of entry.aliases) {
      let score = 0;
      if (query.includes(alias)) score = alias.length;
      else if (alias.includes(query) && query.length >= 3) score = query.length;
      if (score > bestScore) {
        bestScore = score;
        bestId = entry.id;
      }
    }
  }
  return bestId;
}

export function getCategoryById(id: string | null): CategoryDef | null {
  if (!id) return null;
  return STORE_CATEGORIES.find((c) => c.id === id) ?? null;
}

export function getCategoryDisplayName(id: string | null): string {
  const category = getCategoryById(id);
  return category ? category.nameAr : '—';
}
