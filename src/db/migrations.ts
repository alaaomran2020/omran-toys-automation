export interface Migration {
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    name: '001_init',
    sql: `
-- ============================================================
-- Telegram users (whitelist cache of allowed employees)
-- ============================================================
CREATE TABLE IF NOT EXISTS telegram_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL UNIQUE,
  username TEXT,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Persistent conversation state (state machine per chat)
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_states (
  chat_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'IDLE' CHECK (state IN (
    'IDLE', 'WAITING_FOR_IMAGE', 'WAITING_FOR_PRICE_STOCK', 'ANALYZING',
    'PENDING_APPROVAL', 'EDITING', 'PUBLISHING', 'PUBLISHED', 'CANCELLED', 'ERROR'
  )),
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Product drafts (the automation's own data — NOT a copy of the
-- store database. The store remains the system of record.)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_drafts (
  id TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  image_url TEXT,
  image_path TEXT,
  name TEXT,
  short_description TEXT,
  description TEXT,
  category_id TEXT,
  price INTEGER,
  stock INTEGER,
  brand TEXT,
  color TEXT,
  age_range TEXT,
  features TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN (
    'PENDING_APPROVAL', 'PUBLISHING', 'PUBLISHED', 'CANCELLED'
  )),
  product_id TEXT,
  product_url TEXT,
  publish_error TEXT,
  ai_call_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drafts_user_status ON product_drafts(telegram_user_id, status);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON product_drafts(status);

-- ============================================================
-- Automation event log (no secrets/tokens are ever logged)
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER,
  chat_id INTEGER,
  action TEXT NOT NULL,
  draft_id TEXT,
  product_id TEXT,
  status TEXT,
  error TEXT,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_action_time ON automation_logs(action, created_at);

-- ============================================================
-- Webhook update deduplication (Telegram retry protection)
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_updates (
  update_id INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`,
  },
];
