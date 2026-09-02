import { createHash } from "node:crypto";
import type { Database } from "../database.js";

export interface PairingRecord {
  readonly tokenHash: string;
  readonly extensionId: string;
  readonly browser: string;
  readonly createdAt: number;
  readonly lastSeen: number | null;
  readonly eventsReceived: number;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class PairingRepository {
  constructor(private readonly db: Database) {}

  get(): PairingRecord | null {
    const row = this.db.get<{ token_hash: string; extension_id: string; browser: string; created_at: number; last_seen: number | null; events_received: number }>("SELECT * FROM pairing WHERE id = 1");
    if (!row) return null;
    return { tokenHash: row.token_hash, extensionId: row.extension_id, browser: row.browser, createdAt: row.created_at, lastSeen: row.last_seen, eventsReceived: row.events_received };
  }

  set(record: Omit<PairingRecord, "lastSeen" | "eventsReceived">): void {
    this.db.run("INSERT INTO pairing (id, token_hash, extension_id, browser, created_at, last_seen, events_received) VALUES (1, ?, ?, ?, ?, NULL, 0) ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, extension_id = excluded.extension_id, browser = excluded.browser, created_at = excluded.created_at, last_seen = NULL, events_received = 0", record.tokenHash, record.extensionId, record.browser, record.createdAt);
  }

  touch(eventsAdded: number, now: number): void {
    this.db.run("UPDATE pairing SET last_seen = ?, events_received = events_received + ? WHERE id = 1", now, eventsAdded);
  }

  clear(): void {
    this.db.run("DELETE FROM pairing WHERE id = 1");
  }
}

export interface UploadQueueItem {
  readonly id: string;
  readonly createdAt: number;
  readonly json: string;
  readonly attempts: number;
  readonly lastError: string | null;
}

export class UploadQueueRepository {
  constructor(private readonly db: Database) {}

  enqueue(id: string, payloadJson: string, now: number): void {
    this.db.run("INSERT OR REPLACE INTO upload_queue (id, created_at, json, attempts, last_error) VALUES (?, ?, ?, 0, NULL)", id, now, payloadJson);
  }

  list(): UploadQueueItem[] {
    return this.db.all<{ id: string; created_at: number; json: string; attempts: number; last_error: string | null }>("SELECT * FROM upload_queue ORDER BY created_at ASC").map((r) => ({ id: r.id, createdAt: r.created_at, json: r.json, attempts: r.attempts, lastError: r.last_error }));
  }

  markAttempt(id: string, error: string | null): void {
    this.db.run("UPDATE upload_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?", error, id);
  }

  remove(id: string): void {
    this.db.run("DELETE FROM upload_queue WHERE id = ?", id);
  }

  count(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM upload_queue")?.c ?? 0;
  }

  deleteAll(): number {
    return this.db.run("DELETE FROM upload_queue").changes;
  }
}
