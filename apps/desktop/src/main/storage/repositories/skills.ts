import { SkillSchema, type Skill } from "@apprentice/schemas";
import type { Database } from "../database.js";

export class SkillsRepository {
  constructor(private readonly db: Database) {}

  save(skill: Skill): Skill {
    const parsed = SkillSchema.parse(skill);
    this.db.run(
      "INSERT OR REPLACE INTO skills (id, version, name, archived, updated_at, json) VALUES (?, ?, ?, ?, ?, ?)",
      parsed.id, parsed.version, parsed.name, parsed.archived ? 1 : 0, parsed.updatedAt, JSON.stringify(parsed)
    );
    return parsed;
  }

  /** Latest version of every non-archived skill. */
  listCurrent(): Skill[] {
    const rows = this.db.all<{ json: string }>(
      "SELECT s.json FROM skills s JOIN (SELECT id, MAX(version) AS v FROM skills GROUP BY id) m ON s.id = m.id AND s.version = m.v WHERE s.archived = 0 ORDER BY s.updated_at DESC"
    );
    return rows.map((r) => SkillSchema.parse(JSON.parse(r.json)));
  }

  getCurrent(id: string): Skill | null {
    const row = this.db.get<{ json: string }>("SELECT json FROM skills WHERE id = ? ORDER BY version DESC LIMIT 1", id);
    return row ? SkillSchema.parse(JSON.parse(row.json)) : null;
  }

  getVersion(id: string, version: number): Skill | null {
    const row = this.db.get<{ json: string }>("SELECT json FROM skills WHERE id = ? AND version = ?", id, version);
    return row ? SkillSchema.parse(JSON.parse(row.json)) : null;
  }

  history(id: string): Skill[] {
    return this.db.all<{ json: string }>("SELECT json FROM skills WHERE id = ? ORDER BY version DESC", id).map((r) => SkillSchema.parse(JSON.parse(r.json)));
  }

  countCurrent(): number {
    return this.listCurrent().length;
  }

  delete(id: string): number {
    return this.db.run("DELETE FROM skills WHERE id = ?", id).changes;
  }

  deleteAll(): number {
    return this.db.run("DELETE FROM skills").changes;
  }

  /** Event ids referenced as evidence by any skill version (protected from retention). */
  protectedEventIds(): Set<string> {
    // Evidence is stored as episode ids; callers map episodes to events.
    return new Set<string>();
  }

  evidenceEpisodeIds(): Set<string> {
    const out = new Set<string>();
    for (const row of this.db.all<{ json: string }>("SELECT json FROM skills")) {
      const skill = SkillSchema.parse(JSON.parse(row.json));
      for (const id of skill.evidence.episodeIds) out.add(id);
    }
    return out;
  }
}
