/** Bindings and variables available to the worker. Secrets are set with `wrangler secret put`. */
export interface WorkerBindings {
  DB: D1Database;
  /** Maximum request body in bytes (string because it is a wrangler var). */
  MAX_BODY_BYTES?: string;
  /** Required for admin endpoints. When unset, admin endpoints always answer 401. */
  ADMIN_TOKEN?: string;
  /** Optional shared bearer for ingestion. When unset, ingestion is open but rate-limited. */
  INGEST_TOKEN?: string;
}

export type Env = WorkerBindings;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends WorkerBindings {}
  }
}
