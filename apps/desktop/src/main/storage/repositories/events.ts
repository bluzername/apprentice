import { ActivityEventSchema, type ActivityEvent } from "@apprentice/schemas";
import type { Database, SqlParam } from "../database.js";
import type { PayloadCipher } from "../cipher.js";

interface EventRow {
  id: string;
  ts: number;
  json: string;
  sensitive_enc: Uint8Array | null;
}

/** Fields of the payload that are stored encrypted rather than in the indexable JSON. */
const SENSITIVE_PAYLOAD_KEYS = ["title", "windowTitle", "pageTitle"] as const;

export interface EventQuery {
  fromTs?: number;
  toTs?: number;
  app?: string;
  domain?: string;
  types?: readonly string[];
  limit?: number;
  sessionId?: string;
}

function splitSensitive(event: ActivityEvent): { indexable: ActivityEvent; sensitive: Record<string, unknown> | null } {
  if (!event.payload) return { indexable: event, sensitive: null };
  const sensitive: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.payload)) {
    if ((SENSITIVE_PAYLOAD_KEYS as readonly string[]).includes(key)) sensitive[key] = value;
    else rest[key] = value;
  }
  const hasSensitive = Object.keys(sensitive).length > 0;
  return {
    indexable: { ...event, payload: rest as ActivityEvent["payload"] },
    sensitive: hasSensitive ? sensitive : null
  };
}

export class EventsRepository {
  constructor(private readonly db: Database, private readonly cipher: PayloadCipher) {}

  insertMany(events: readonly ActivityEvent[]): number {
    if (events.length === 0) return 0;
    return this.db.transaction(() => {
      let count = 0;
      for (const raw of events) {
        const event = ActivityEventSchema.parse(raw);
        const { indexable, sensitive } = splitSensitive(event);
        const enc = sensitive ? this.cipher.encryptJson(sensitive) : null;
        this.db.run(
          "INSERT OR REPLACE INTO events (id, ts, seq, session_id, type, source, app_bundle_id, domain, privacy, json, sensitive_enc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          event.id, event.ts, event.seq, event.sessionId, event.type, event.source,
          event.app?.bundleId ?? null, event.domain ?? null, event.privacy, JSON.stringify(indexable), enc
        );
        count += 1;
      }
      return count;
    });
  }

  private rowToEvent(row: EventRow, revealSensitive: boolean): ActivityEvent {
    const event = ActivityEventSchema.parse(JSON.parse(row.json));
    if (!revealSensitive || !row.sensitive_enc) return event;
    const sensitive = this.cipher.decryptJson<Record<string, unknown>>(Buffer.from(row.sensitive_enc));
    return { ...event, payload: { ...(event.payload ?? {}), ...sensitive } as ActivityEvent["payload"] };
  }

  query(q: EventQuery, options: { revealSensitive?: boolean } = {}): ActivityEvent[] {
    const clauses: string[] = [];
    const params: SqlParam[] = [];
    if (q.fromTs !== undefined) { clauses.push("ts >= ?"); params.push(q.fromTs); }
    if (q.toTs !== undefined) { clauses.push("ts <= ?"); params.push(q.toTs); }
    if (q.app) { clauses.push("app_bundle_id = ?"); params.push(q.app); }
    if (q.domain) { clauses.push("domain = ?"); params.push(q.domain); }
    if (q.sessionId) { clauses.push("session_id = ?"); params.push(q.sessionId); }
    if (q.types && q.types.length > 0) {
      clauses.push(`type IN (${q.types.map(() => "?").join(",")})`);
      params.push(...q.types);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(q.limit ?? 500, 1), 20000);
    const rows = this.db.all<EventRow>(`SELECT id, ts, json, sensitive_enc FROM events ${where} ORDER BY ts ASC, seq ASC LIMIT ?`, ...params, limit);
    return rows.map((r) => this.rowToEvent(r, options.revealSensitive ?? false));
  }

  byIds(ids: readonly string[], options: { revealSensitive?: boolean } = {}): ActivityEvent[] {
    if (ids.length === 0) return [];
    const out: ActivityEvent[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = this.db.all<EventRow>(`SELECT id, ts, json, sensitive_enc FROM events WHERE id IN (${chunk.map(() => "?").join(",")}) ORDER BY ts ASC, seq ASC`, ...chunk);
      out.push(...rows.map((r) => this.rowToEvent(r, options.revealSensitive ?? false)));
    }
    return out;
  }

  count(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM events")?.c ?? 0;
  }

  /** Active hours: count of distinct 5-minute buckets with allowed events. */
  observedHours(): number {
    const row = this.db.get<{ c: number }>("SELECT COUNT(DISTINCT ts / 300000) AS c FROM events WHERE privacy = 'allowed'");
    return ((row?.c ?? 0) * 5) / 60;
  }

  deleteByIds(ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    let deleted = 0;
    this.db.transaction(() => {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        deleted += this.db.run(`DELETE FROM events WHERE id IN (${chunk.map(() => "?").join(",")})`, ...chunk).changes;
      }
    });
    return deleted;
  }

  deleteRange(fromTs: number, toTs: number): number {
    return this.db.run("DELETE FROM events WHERE ts >= ? AND ts <= ?", fromTs, toTs).changes;
  }

  deleteOlderThan(ts: number, protectIds: ReadonlySet<string>): number {
    const rows = this.db.all<{ id: string }>("SELECT id FROM events WHERE ts < ?", ts);
    const ids = rows.map((r) => r.id).filter((id) => !protectIds.has(id));
    return this.deleteByIds(ids);
  }

  deleteAll(): number {
    return this.db.run("DELETE FROM events").changes;
  }

  latestSeq(sessionId: string): number {
    return this.db.get<{ s: number | null }>("SELECT MAX(seq) AS s FROM events WHERE session_id = ?", sessionId)?.s ?? -1;
  }

  inventory(): { id: string; ts: number; type: string }[] {
    return this.db.all<{ id: string; ts: number; type: string }>("SELECT id, ts, type FROM events");
  }
}
