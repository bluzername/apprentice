export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "init",
    sql: `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, ended_at INTEGER);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  app_bundle_id TEXT,
  domain TEXT,
  privacy TEXT NOT NULL,
  json TEXT NOT NULL,
  sensitive_enc BLOB
);
CREATE INDEX idx_events_ts ON events (ts);
CREATE INDEX idx_events_session ON events (session_id, seq);
CREATE INDEX idx_events_type ON events (type);

CREATE TABLE screenshots (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  event_id TEXT,
  phash TEXT NOT NULL,
  analyzed INTEGER NOT NULL DEFAULT 0,
  byte_length INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX idx_screenshots_ts ON screenshots (ts);

CREATE TABLE ocr (
  id TEXT PRIMARY KEY,
  screenshot_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  json_enc BLOB NOT NULL
);
CREATE INDEX idx_ocr_ts ON ocr (ts);
CREATE INDEX idx_ocr_screenshot ON ocr (screenshot_id);

CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX idx_episodes_start ON episodes (start_ts);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  pattern_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE skills (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX idx_runs_started ON runs (started_at);

CREATE TABLE run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX idx_run_steps_run ON run_steps (run_id, idx);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  context_type TEXT NOT NULL,
  context_id TEXT NOT NULL,
  upload_status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE product_events (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  name TEXT NOT NULL,
  exported INTEGER NOT NULL DEFAULT 0,
  json TEXT NOT NULL
);
CREATE INDEX idx_product_events_ts ON product_events (ts);

CREATE TABLE pairing (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token_hash TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  browser TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  events_received INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE upload_queue (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
`
  }
];
