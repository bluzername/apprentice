import { WorkflowCandidateSchema, type WorkflowCandidate } from "@apprentice/schemas";
import type { Database } from "../database.js";

export class CandidatesRepository {
  constructor(private readonly db: Database) {}

  upsert(candidate: WorkflowCandidate): WorkflowCandidate {
    const parsed = WorkflowCandidateSchema.parse(candidate);
    this.db.run(
      "INSERT INTO candidates (id, pattern_key, state, created_at, updated_at, json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(pattern_key) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at, json = excluded.json",
      parsed.id, parsed.patternKey, parsed.suppression.state, parsed.createdAt, parsed.updatedAt, JSON.stringify(parsed)
    );
    return this.byPatternKey(parsed.patternKey) ?? parsed;
  }

  byPatternKey(key: string): WorkflowCandidate | null {
    const row = this.db.get<{ json: string }>("SELECT json FROM candidates WHERE pattern_key = ?", key);
    return row ? WorkflowCandidateSchema.parse(JSON.parse(row.json)) : null;
  }

  get(id: string): WorkflowCandidate | null {
    const row = this.db.get<{ json: string }>("SELECT json FROM candidates WHERE id = ?", id);
    return row ? WorkflowCandidateSchema.parse(JSON.parse(row.json)) : null;
  }

  list(includeSuppressed = false): WorkflowCandidate[] {
    const rows = includeSuppressed
      ? this.db.all<{ json: string }>("SELECT json FROM candidates ORDER BY updated_at DESC")
      : this.db.all<{ json: string }>("SELECT json FROM candidates WHERE state = 'active' ORDER BY updated_at DESC");
    return rows.map((r) => WorkflowCandidateSchema.parse(JSON.parse(r.json)));
  }

  patternKeys(): Set<string> {
    return new Set(this.db.all<{ pattern_key: string }>("SELECT pattern_key FROM candidates").map((r) => r.pattern_key));
  }

  update(candidate: WorkflowCandidate): WorkflowCandidate {
    const parsed = WorkflowCandidateSchema.parse(candidate);
    this.db.run("UPDATE candidates SET state = ?, updated_at = ?, json = ? WHERE id = ?", parsed.suppression.state, parsed.updatedAt, JSON.stringify(parsed), parsed.id);
    return parsed;
  }

  countActive(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM candidates WHERE state = 'active'")?.c ?? 0;
  }

  count(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM candidates")?.c ?? 0;
  }

  deleteAll(): number {
    return this.db.run("DELETE FROM candidates").changes;
  }

  delete(id: string): number {
    return this.db.run("DELETE FROM candidates WHERE id = ?", id).changes;
  }
}
