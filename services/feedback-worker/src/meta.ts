export const SERVICE_NAME = "apprentice-feedback";
export const SERVICE_VERSION = "0.1.0-alpha.1";

export const DEFAULT_MAX_BODY_BYTES = 262144;

export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const RATE_LIMIT_PER_INSTALLATION = 60;
export const RATE_LIMIT_PER_IP = 600;

/** D1 accepts at most 100 bound parameters per statement; keep multi-row inserts under that. */
export const MAX_BOUND_PARAMS = 100;

export const SUMMARY_COMMENT_LIMIT = 50;
export const RETENTION_DAYS = [1, 3, 7] as const;
export const DAY_MS = 24 * 60 * 60 * 1000;
