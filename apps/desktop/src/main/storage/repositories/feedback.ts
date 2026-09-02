import { FeedbackSchema, ProductEventSchema, type Feedback, type ProductEvent } from "@apprentice/schemas";
import type { Database } from "../database.js";

export class FeedbackRepository {
  constructor(private readonly db: Database) {}

  save(feedback: Feedback): Feedback {
    const parsed = FeedbackSchema.parse(feedback);
    this.db.run("INSERT OR REPLACE INTO feedback (id, context_type, context_id, upload_status, created_at, json) VALUES (?, ?, ?, ?, ?, ?)", parsed.id, parsed.contextType, parsed.contextId, parsed.uploadStatus, parsed.createdAt, JSON.stringify(parsed));
    return parsed;
  }

  list(): Feedback[] {
    return this.db.all<{ json: string }>("SELECT json FROM feedback ORDER BY created_at DESC").map((r) => FeedbackSchema.parse(JSON.parse(r.json)));
  }

  byStatus(status: Feedback["uploadStatus"]): Feedback[] {
    return this.db.all<{ json: string }>("SELECT json FROM feedback WHERE upload_status = ? ORDER BY created_at ASC", status).map((r) => FeedbackSchema.parse(JSON.parse(r.json)));
  }

  setStatus(ids: readonly string[], status: Feedback["uploadStatus"]): void {
    this.db.transaction(() => {
      for (const id of ids) {
        const row = this.db.get<{ json: string }>("SELECT json FROM feedback WHERE id = ?", id);
        if (!row) continue;
        const updated = { ...FeedbackSchema.parse(JSON.parse(row.json)), uploadStatus: status };
        this.db.run("UPDATE feedback SET upload_status = ?, json = ? WHERE id = ?", status, JSON.stringify(updated), id);
      }
    });
  }

  count(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM feedback")?.c ?? 0;
  }

  hasContext(contextType: string, contextId: string): boolean {
    return (this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM feedback WHERE context_type = ? AND context_id = ?", contextType, contextId)?.c ?? 0) > 0;
  }

  deleteAll(): number {
    return this.db.run("DELETE FROM feedback").changes;
  }

  deleteByContext(contextType: string, contextId: string): number {
    return this.db.run("DELETE FROM feedback WHERE context_type = ? AND context_id = ?", contextType, contextId).changes;
  }
}

export class ProductEventsRepository {
  constructor(private readonly db: Database) {}

  insert(event: ProductEvent): void {
    const parsed = ProductEventSchema.parse(event);
    this.db.run("INSERT OR REPLACE INTO product_events (id, ts, name, json) VALUES (?, ?, ?, ?)", parsed.id, parsed.ts, parsed.name, JSON.stringify(parsed));
  }

  list(limit = 200): ProductEvent[] {
    return this.db.all<{ json: string }>("SELECT json FROM product_events ORDER BY ts DESC LIMIT ?", limit).map((r) => ProductEventSchema.parse(JSON.parse(r.json)));
  }

  all(): ProductEvent[] {
    return this.db.all<{ json: string }>("SELECT json FROM product_events ORDER BY ts ASC").map((r) => ProductEventSchema.parse(JSON.parse(r.json)));
  }

  countByName(name: string): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM product_events WHERE name = ?", name)?.c ?? 0;
  }

  deleteAll(): number {
    return this.db.run("DELETE FROM product_events").changes;
  }
}
