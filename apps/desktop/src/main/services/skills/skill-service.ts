import { reviseSkill } from "@apprentice/core";
import { SkillSchema, type Skill } from "@apprentice/schemas";
import type { Analytics } from "../analytics.js";
import type { StorageRef } from "../app-context.js";
import type { Clock } from "../clock.js";
import { ServiceError } from "../errors.js";

export interface SkillServiceDeps {
  readonly storage: StorageRef;
  readonly analytics: Analytics;
  readonly clock: Clock;
}

/** Skill library: list, history, versioned save with corrections, delete with dependent data. */
export class SkillService {
  constructor(private readonly deps: SkillServiceDeps) {}

  list(): Skill[] {
    return this.deps.storage.current.skills.listCurrent();
  }

  get(id: string): { skill: Skill; history: Skill[] } {
    const skill = this.deps.storage.current.skills.getCurrent(id);
    if (!skill) throw new ServiceError("not_found", `Skill ${id} not found`);
    return { skill, history: this.deps.storage.current.skills.history(id) };
  }

  save(skill: Skill, correctionNote?: string): Skill {
    const storage = this.deps.storage.current;
    const parsed = SkillSchema.parse(skill);
    const existing = storage.skills.getCurrent(parsed.id);
    if (!existing) {
      const created = storage.skills.save({ ...parsed, version: 1, createdAt: this.deps.clock.now(), updatedAt: this.deps.clock.now() });
      this.deps.analytics.track("skill_saved", { source: created.source, version: 1 }, created.riskClass);
      return created;
    }
    const { id: _id, version: _version, corrections: _corrections, createdAt: _createdAt, updatedAt: _updatedAt, ...changes } = parsed;
    let revised: Skill;
    try {
      revised = reviseSkill(existing, changes, correctionNote ?? "Edited in the skill editor", this.deps.clock.now());
    } catch {
      return existing;
    }
    const saved = storage.skills.save(revised);
    this.deps.analytics.track("skill_saved", { source: saved.source, version: saved.version, corrections: saved.corrections.length }, saved.riskClass);
    return saved;
  }

  delete(id: string): boolean {
    const storage = this.deps.storage.current;
    const skill = storage.skills.getCurrent(id);
    if (!skill) return false;
    storage.runs.deleteBySkill(id);
    storage.skills.delete(id);
    if (skill.evidence.candidateId) {
      const candidate = storage.candidates.get(skill.evidence.candidateId);
      if (candidate && candidate.suppression.state === "converted") {
        storage.candidates.update({ ...candidate, suppression: { state: "not_useful", reason: "Skill deleted", ts: this.deps.clock.now() }, updatedAt: this.deps.clock.now() });
      }
    }
    this.deps.analytics.track("skill_deleted", { source: skill.source, version: skill.version });
    return true;
  }
}
