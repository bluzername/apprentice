/** Timing and sizing constants shared by the background worker, popup, and content script. */
export const QUEUE_FLUSH_INTERVAL_MS = 2000;
export const QUEUE_MAX_BATCH = 50;
export const QUEUE_MAX_PENDING = 1000;
export const QUEUE_BASE_BACKOFF_MS = 2000;
export const QUEUE_MAX_BACKOFF_MS = 60000;

export const ALLOWLIST_SYNC_ALARM = "apprentice-allowlist-sync";
export const ALLOWLIST_SYNC_PERIOD_MINUTES = 0.5;

export const DOM_QUERY_POLL_INTERVAL_MS = 3000;
export const DISCOVERY_TIMEOUT_MS = 800;

export const CONTENT_SCRIPT_ID_PREFIX = "apprentice-domain-";
export const CONTENT_SCRIPT_FILE = "content.js";

export const MAX_TITLE_LENGTH = 160;
export const MAX_TEXT_LENGTH = 80;
export const MAX_LABEL_LENGTH = 80;
export const MAX_PATH_LENGTH = 512;
export const FINGERPRINT_MAX_DEPTH = 6;
