-- Migration for independent staging database only (NEVER apply to store database)
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, source_event_id TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '', telegram_file_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', price REAL, quantity INTEGER,
  status TEXT NOT NULL DEFAULT 'RECEIVED', qa_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
  image_verified INTEGER NOT NULL DEFAULT 0, review_reason TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT, workflow_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_log (
  event_key TEXT PRIMARY KEY, draft_id TEXT NOT NULL, action TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS catalog_preview (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
  price REAL NOT NULL, quantity INTEGER NOT NULL, image_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'STAGED_ONLY',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
