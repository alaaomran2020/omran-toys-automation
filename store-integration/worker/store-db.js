/**
 * Omran Toys Store — Worker API: D1 data access.
 *
 * Install as: src/worker/store-db.js
 *
 * The SQL matches the existing D1 schema (cloudflare/d1-schema.sql) plus
 * the `idempotency_key` column added by migrations/001_add_idempotency_key.sql.
 */

/**
 * Insert a product. INSERT OR IGNORE on the unique (id / idempotency_key)
 * constraints makes concurrent duplicate attempts safe.
 * @param {import('cloudflare:d1').D1Database} db
 * @param {object} p
 */
export async function insertProduct(db, p) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO products (
         id, sku, name_ar, name_en, slug, description, category_id,
         retail_price, stock_quantity, age_group, brand,
         images, tags, features, toy_type,
         idempotency_key, import_source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'telegram-automation')`,
    )
    .bind(
      p.id,
      p.sku,
      p.nameAr,
      p.nameEn,
      p.slug,
      p.description,
      p.categoryId,
      p.price,
      p.stock,
      p.ageGroup,
      p.brand,
      p.images,
      p.tags,
      p.features,
      p.toyType,
      p.idempotencyKey,
    )
    .run();
}

export async function findProductByIdempotencyKey(db, idempotencyKey) {
  return db.prepare('SELECT * FROM products WHERE idempotency_key = ?').bind(idempotencyKey).first();
}

export async function findProductById(db, id) {
  return db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
}

export async function listActiveProducts(db, limit) {
  const result = await db
    .prepare(
      `SELECT * FROM products
       WHERE is_active = 1 AND is_visible = 1
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  return result.results ?? [];
}

/** Map a D1 products row to the frontend product shape used by the SPA. */
export function rowToFrontend(row, url) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name_ar,
    nameEn: row.name_en ?? null,
    category: row.category_id ?? null,
    price: row.retail_price,
    originalPrice: row.original_price ?? null,
    discountPercent: row.discount_percent ?? 0,
    rating: row.rating ?? 0,
    reviewsCount: row.reviews_count ?? 0,
    stock: row.stock_quantity ?? 0,
    ageGroup: row.age_group ?? null,
    brand: row.brand ?? null,
    isNew: Number(row.is_new) === 1,
    isBestSeller: Number(row.is_best_seller) === 1,
    isFeatured: Number(row.is_featured) === 1,
    sku: row.sku,
    description: row.description ?? null,
    features: safeJsonArray(row.features),
    tags: safeJsonArray(row.tags),
    images: safeJsonArray(row.images),
    safetyNotice: row.safety_notice ?? null,
    dimensions: row.dimensions_cm ?? null,
    batteryRequired: row.battery_required ?? null,
    url,
  };
}

function safeJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
