PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS content_versions (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL UNIQUE CHECK (revision >= 0),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  action TEXT NOT NULL CHECK (action IN ('draft', 'publish', 'rollback')),
  source_version_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (source_version_id) REFERENCES content_versions(id)
);

CREATE TABLE IF NOT EXISTS content_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  draft_version_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL CHECK (draft_revision >= 0),
  published_version_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  FOREIGN KEY (draft_version_id) REFERENCES content_versions(id),
  FOREIGN KEY (published_version_id) REFERENCES content_versions(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  resource TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_versions_revision
  ON content_versions(revision DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log(created_at DESC);
