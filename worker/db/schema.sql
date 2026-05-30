CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  password TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 0,
  storage_id TEXT NOT NULL DEFAULT 'default'
);

CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires_at);

CREATE TABLE IF NOT EXISTS share_sessions (
  token TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
