-- Apprentice feedback worker: initial schema.
-- All columns hold allowlisted, non-sensitive values only (see packages/schemas feedback.ts).

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('feedback', 'telemetry')),
  installation_id TEXT NOT NULL,
  participant_code TEXT NULL,
  app_version TEXT NOT NULL,
  macos_major INTEGER NULL,
  chip_family TEXT NULL,
  memory_bucket TEXT NULL,
  provider TEXT NULL,
  model TEXT NULL,
  model_version TEXT NULL,
  received_at INTEGER NOT NULL,
  payload_bytes INTEGER NOT NULL,
  payload_hash TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_submissions_installation_id ON submissions (installation_id);
CREATE INDEX IF NOT EXISTS idx_submissions_received_at ON submissions (received_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ts INTEGER NOT NULL,
  risk_class TEXT NULL,
  provider TEXT NULL,
  counts_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_name ON events (name);
CREATE INDEX IF NOT EXISTS idx_events_submission_id ON events (submission_id);

CREATE TABLE IF NOT EXISTS feedback_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  context_type TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  comment TEXT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_items_context_type ON feedback_items (context_type);
CREATE INDEX IF NOT EXISTS idx_feedback_items_submission_id ON feedback_items (submission_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
