-- ============================================================
-- Migration 001: idempotency key on products
--
-- Apply to the REMOTE D1 database:
--   npx wrangler d1 execute DB --remote --file=migrations/001_add_idempotency_key.sql
--
-- (Also add the column to cloudflare/d1-schema.sql so fresh local
--  databases include it — see the README.)
-- ============================================================

ALTER TABLE products ADD COLUMN idempotency_key TEXT;

-- Unique index: one product per automation draft id (replays are safe).
-- NULLs are allowed and not compared (SQLite treats NULLs as distinct).
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_idempotency ON products(idempotency_key);
