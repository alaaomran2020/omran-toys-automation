#!/usr/bin/env bash
# ============================================================
# SQL smoke test: verifies the Worker API SQL against a REAL
# local D1 (SQLite) engine using the store's own schema.
#
# Usage (from the store repo root, after installing this
# store-integration folder):
#   npm run db:d1:schema          # applies cloudflare/d1-schema.sql locally
#   ./store-integration/scripts/sql-smoke.sh
#
# Requires: wrangler in devDependencies (already in the store repo).
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/../.."   # store repo root

if [ ! -f cloudflare/d1-schema.sql ]; then
  echo "ERROR: run this from the store repo root (omrantoys-store)" >&2
  exit 1
fi

echo "→ applying local schema (cloudflare/d1-schema.sql)..."
npx wrangler d1 execute DB --local --file=cloudflare/d1-schema.sql > /dev/null

echo "→ applying migration 001 (idempotency key)..."
npx wrangler d1 execute DB --local --file=store-integration/migrations/001_add_idempotency_key.sql > /dev/null

echo "→ running API SQL smoke (insert + duplicate + selects)..."
SMOKE=$(mktemp /tmp/omran-d1-smoke-XXXX.sql)
cat > "$SMOKE" <<'SQL'
INSERT OR IGNORE INTO products (
   id, sku, name_ar, name_en, slug, description, category_id,
   retail_price, stock_quantity, age_group, brand,
   images, tags, features, toy_type,
   idempotency_key, import_source
 ) VALUES ('smoke-1', 'OMR-AUTO-smoke001', 'منتج تجريبي', NULL, 'product-smoke001', 'وصف تجريبي', 'rc-electronic', 350, 8, '6-8', NULL, '["https://example.com/img.jpg"]', '["تجريبي"]', '["تجربة"]', 'rc', 'smoke-draft-1', 'telegram-automation');
INSERT OR IGNORE INTO products (
   id, sku, name_ar, name_en, slug, description, category_id,
   retail_price, stock_quantity, age_group, brand,
   images, tags, features, toy_type,
   idempotency_key, import_source
 ) VALUES ('smoke-2', 'OMR-AUTO-smoke001', 'منتج تجريبي', NULL, 'product-smoke001', 'وصف تجريبي', 'rc-electronic', 350, 8, '6-8', NULL, '["https://example.com/img.jpg"]', '["تجريبي"]', '["تجربة"]', 'rc', 'smoke-draft-1', 'telegram-automation');
SELECT id FROM products WHERE idempotency_key = 'smoke-draft-1';
SELECT COUNT(*) AS c FROM products WHERE idempotency_key = 'smoke-draft-1';
SQL

OUT=$(npx wrangler d1 execute DB --local --file="$SMOKE")
rm -f "$SMOKE"

COUNT=$(echo "$OUT" | sed -n '/^\[/,$p' | python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data:
    results = r.get('results')
    if results and any('c' in row for row in results):
        print(results[0]['c'])
")
if [ "$COUNT" = "1" ]; then
  echo "✅ SQL smoke passed: insert works, duplicate idempotency key ignored (1 row)."
else
  echo "❌ SQL smoke FAILED: expected 1 row, got: ${COUNT:-none}" >&2
  exit 1
fi
