import type { Db } from '../database.js';

export type DraftStatus = 'PENDING_APPROVAL' | 'PUBLISHING' | 'PUBLISHED' | 'CANCELLED';

export interface ProductDraft {
  id: string;
  telegramUserId: number;
  chatId: number;
  imageUrl: string | null;
  imagePath: string | null;
  name: string | null;
  shortDescription: string | null;
  description: string | null;
  categoryId: string | null;
  price: number | null;
  stock: number | null;
  brand: string | null;
  color: string | null;
  ageRange: string | null;
  features: string[];
  keywords: string[];
  status: DraftStatus;
  productId: string | null;
  productUrl: string | null;
  publishError: string | null;
  aiCallCount: number;
  createdAt: string;
  updatedAt: string;
}

interface DraftRow {
  id: string;
  telegram_user_id: number;
  chat_id: number;
  image_url: string | null;
  image_path: string | null;
  name: string | null;
  short_description: string | null;
  description: string | null;
  category_id: string | null;
  price: number | null;
  stock: number | null;
  brand: string | null;
  color: string | null;
  age_range: string | null;
  features: string;
  keywords: string;
  status: DraftStatus;
  product_id: string | null;
  product_url: string | null;
  publish_error: string | null;
  ai_call_count: number;
  created_at: string;
  updated_at: string;
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    /* corrupted JSON — treat as empty */
  }
  return [];
}

function mapDraft(row: DraftRow): ProductDraft {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    chatId: row.chat_id,
    imageUrl: row.image_url,
    imagePath: row.image_path,
    name: row.name,
    shortDescription: row.short_description,
    description: row.description,
    categoryId: row.category_id,
    price: row.price,
    stock: row.stock,
    brand: row.brand,
    color: row.color,
    ageRange: row.age_range,
    features: parseJsonArray(row.features),
    keywords: parseJsonArray(row.keywords),
    status: row.status,
    productId: row.product_id,
    productUrl: row.product_url,
    publishError: row.publish_error,
    aiCallCount: row.ai_call_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateDraftInput {
  id: string;
  telegramUserId: number;
  chatId: number;
  imageUrl: string;
  imagePath: string;
  name: string;
  shortDescription: string;
  description: string;
  categoryId: string | null;
  price: number;
  stock: number;
  brand: string | null;
  color: string | null;
  ageRange: string | null;
  features: string[];
  keywords: string[];
}

export function createDraft(db: Db, input: CreateDraftInput): ProductDraft {
  db.prepare(
    `INSERT INTO product_drafts (
       id, telegram_user_id, chat_id, image_url, image_path,
       name, short_description, description, category_id,
       price, stock, brand, color, age_range, features, keywords, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL')`,
  ).run(
    input.id,
    input.telegramUserId,
    input.chatId,
    input.imageUrl,
    input.imagePath,
    input.name,
    input.shortDescription,
    input.description,
    input.categoryId,
    input.price,
    input.stock,
    input.brand,
    input.color,
    input.ageRange,
    JSON.stringify(input.features),
    JSON.stringify(input.keywords),
  );
  return findDraftById(db, input.id)!;
}

export function findDraftById(db: Db, id: string): ProductDraft | null {
  const row = db.prepare('SELECT * FROM product_drafts WHERE id = ?').get(id) as DraftRow | undefined;
  return row ? mapDraft(row) : null;
}

export function findPendingDraftsByUser(db: Db, telegramUserId: number): ProductDraft[] {
  const rows = db
    .prepare(
      `SELECT * FROM product_drafts
       WHERE telegram_user_id = ? AND status = 'PENDING_APPROVAL'
       ORDER BY created_at DESC`,
    )
    .all(telegramUserId) as unknown as DraftRow[];
  return rows.map(mapDraft);
}

export interface DraftUpdateFields {
  name?: string;
  shortDescription?: string;
  description?: string;
  categoryId?: string | null;
  price?: number;
  stock?: number;
  brand?: string | null;
  color?: string | null;
  ageRange?: string | null;
  features?: string[];
  keywords?: string[];
}

const UPDATEABLE: Array<[keyof DraftUpdateFields, string]> = [
  ['name', 'name'],
  ['shortDescription', 'short_description'],
  ['description', 'description'],
  ['categoryId', 'category_id'],
  ['price', 'price'],
  ['stock', 'stock'],
  ['brand', 'brand'],
  ['color', 'color'],
  ['ageRange', 'age_range'],
];

export function updateDraftFields(db: Db, id: string, fields: DraftUpdateFields): void {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [key, column] of UPDATEABLE) {
    if (fields[key] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(fields[key] as string | number | null);
    }
  }
  if (fields.features !== undefined) {
    sets.push('features = ?');
    values.push(JSON.stringify(fields.features));
  }
  if (fields.keywords !== undefined) {
    sets.push('keywords = ?');
    values.push(JSON.stringify(fields.keywords));
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE product_drafts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function incrementAiCallCount(db: Db, id: string): void {
  db.prepare(
    "UPDATE product_drafts SET ai_call_count = ai_call_count + 1, updated_at = datetime('now') WHERE id = ?",
  ).run(id);
}

/**
 * Atomic publish claim.
 * Only ONE caller can win the PENDING_APPROVAL → PUBLISHING transition,
 * which makes double clicks, Telegram retries and webhook retries safe.
 */
export function claimPublish(db: Db, id: string): boolean {
  const result = db
    .prepare(
      "UPDATE product_drafts SET status = 'PUBLISHING', updated_at = datetime('now') WHERE id = ? AND status = 'PENDING_APPROVAL'",
    )
    .run(id);
  return Number(result.changes) > 0;
}

export function markPublished(db: Db, id: string, productId: string, productUrl: string | null): void {
  db.prepare(
    `UPDATE product_drafts
     SET status = 'PUBLISHED', product_id = ?, product_url = ?, publish_error = NULL, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(productId, productUrl, id);
}

export function revertPublish(db: Db, id: string, error: string): void {
  db.prepare(
    "UPDATE product_drafts SET status = 'PENDING_APPROVAL', publish_error = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(error, id);
}

export function cancelDraft(db: Db, id: string): boolean {
  const result = db
    .prepare(
      "UPDATE product_drafts SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ? AND status = 'PENDING_APPROVAL'",
    )
    .run(id);
  return Number(result.changes) > 0;
}
