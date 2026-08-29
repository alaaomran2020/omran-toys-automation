/**
 * Minimal in-memory stand-in for a Cloudflare D1 binding.
 * It implements the exact SQL surface used by store-db.js (pattern-based),
 * keeping the real SQL text as the single source of truth.
 *
 * SQL-level correctness against a REAL SQLite engine is additionally
 * verified via `wrangler d1 execute --local` (see scripts/sql-smoke.sh).
 */

export function createFakeD1() {
  const products = [];

  function makeStatement(sql) {
    return {
      bind: (...binds) => ({
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO products')) {
            // Bind order (see store-db.js insertProduct):
            // id, sku, name_ar, name_en, slug, description, category_id,
            // retail_price, stock_quantity, age_group, brand,
            // images, tags, features, toy_type, idempotency_key
            const [
              id, sku, nameAr, nameEn, slug, description, categoryId,
              retailPrice, stockQuantity, ageGroup, brand,
              images, tags, features, toyType, idempotencyKey,
            ] = binds;
            if (products.some((p) => p.id === id || (p.idempotency_key && p.idempotency_key === idempotencyKey))) {
              return { changes: 0 };
            }
            products.push({
              id, sku, name_ar: nameAr, name_en: nameEn, slug, description, category_id: categoryId,
              retail_price: retailPrice, stock_quantity: stockQuantity, age_group: ageGroup, brand,
              images, tags, features, toy_type: toyType,
              idempotency_key: idempotencyKey,
              original_price: null, discount_percent: 0,
              rating: 0, reviews_count: 0,
              is_new: 1, is_best_seller: 0, is_featured: 0,
              is_active: 1, is_visible: 1,
              safety_notice: null, dimensions_cm: null, battery_required: null,
              import_source: 'telegram-automation',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        async first() {
          if (sql.includes('WHERE idempotency_key = ?')) return products.find((p) => p.idempotency_key === binds[0]) ?? null;
          if (sql.includes('WHERE id = ?')) return products.find((p) => p.id === binds[0]) ?? null;
          return null;
        },
        async all() {
          if (sql.includes('is_active = 1 AND is_visible = 1')) {
            const limit = Number(binds[0]) || 100;
            return { results: products.filter((p) => p.is_active === 1 && p.is_visible === 1).slice(0, limit) };
          }
          return { results: [] };
        },
    }),
  };
}

  return {
    prepare: (sql) => makeStatement(sql),
    _products: products,
  };
}
