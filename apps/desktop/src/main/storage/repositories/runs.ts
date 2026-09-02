import { RunSchema, RunStepSchema, type Run, type RunStep } from "@apprentice/schemas";
import type { Database } from "../database.js";

export class RunsRepository {
  constructor(private readonly db: Database) {}

  save(run: Run): Run {
    const parsed = RunSchema.parse(run);
    // Upsert without INSERT OR REPLACE: a replace would delete the row and cascade-delete its steps.
    this.db.run(
      "INSERT INTO runs (id, skill_id, status, started_at, json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET skill_id = excluded.skill_id, status = excluded.status, started_at = excluded.started_at, json = excluded.json",
      parsed.id, parsed.skillId, parsed.status, parsed.startedAt, JSON.stringify(parsed)
    );
    return parsed;
  }

  get(id: string): Run | null {
    const row = this.db.get<{ json: string }>("SELECT json FROM runs WHERE id = ?", id);
    return row ? RunSchema.parse(JSON.parse(row.json)) : null;
  }

  list(limit = 50): Run[] {
    return this.db.all<{ json: string }>("SELECT json FROM runs ORDER BY started_at DESC LIMIT ?", limit).map((r) => RunSchema.parse(JSON.parse(r.json)));
  }

  saveStep(step: RunStep): RunStep {
    const parsed = RunStepSchema.parse(step);
    this.db.run("INSERT OR REPLACE INTO run_steps (id, run_id, idx, json) VALUES (?, ?, ?, ?)", parsed.id, parsed.runId, parsed.index, JSON.stringify(parsed));
    return parsed;
  }

  steps(runId: string): RunStep[] {
    return this.db.all<{ json: string }>("SELECT json FROM run_steps WHERE run_id = ? ORDER BY idx ASC", runId).map((r) => RunStepSchema.parse(JSON.parse(r.json)));
  }

  count(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM runs")?.c ?? 0;
  }

  deleteBySkill(skillId: string): number {
    return this.db.run("DELETE FROM runs WHERE skill_id = ?", skillId).changes;
  }

  deleteAll(): number {
    this.db.run("DELETE FROM run_steps");
    return this.db.run("DELETE FROM runs").changes;
  }
}
