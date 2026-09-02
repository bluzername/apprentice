import { tooManyRequests } from "./errors.js";
import { RATE_LIMIT_PER_INSTALLATION, RATE_LIMIT_PER_IP, RATE_LIMIT_WINDOW_MS } from "./meta.js";

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly count: number;
  readonly retryAfterSeconds: number;
}

/**
 * Fixed-window counter stored in D1. One UPSERT per bucket keeps the increment atomic:
 * a new window resets the count, the same window increments it.
 */
export const consumeBucket = async (
  db: D1Database,
  bucket: string,
  limit: number,
  now: number,
  windowMs = RATE_LIMIT_WINDOW_MS
): Promise<RateLimitResult> => {
  const windowStart = now - (now % windowMs);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(bucket) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count`
    )
    .bind(bucket, windowStart)
    .first<{ count: number }>();
  if (row === null) throw new Error("rate_limits upsert returned no row");
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
  return { allowed: row.count <= limit, count: row.count, retryAfterSeconds };
};

export const clientIp = (request: Request): string =>
  request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

/** Enforces the per-IP and per-installation limits; throws 429 when either is exceeded. */
export const enforceIngestLimits = async (
  db: D1Database,
  request: Request,
  installationId: string,
  now: number
): Promise<void> => {
  const ip = await consumeBucket(db, `ip:${clientIp(request)}`, RATE_LIMIT_PER_IP, now);
  if (!ip.allowed) throw tooManyRequests(ip.retryAfterSeconds);
  const installation = await consumeBucket(db, `inst:${installationId}`, RATE_LIMIT_PER_INSTALLATION, now);
  if (!installation.allowed) throw tooManyRequests(installation.retryAfterSeconds);
};
