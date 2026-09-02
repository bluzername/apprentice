import type { ActionPolicyMode, RiskClass, Skill, SkillDraft } from "@apprentice/schemas";
import { canonicalJson, newId } from "../ids.js";
import { maxRiskClass } from "../risk/dictionaries.js";
import { classifyText } from "../risk/match.js";
import { DEFAULT_ACTION_POLICY } from "../risk/policy.js";
import type { CoreSkillDraft } from "./draft.js";

export interface SkillFromDraftOptions {
  readonly id?: string;
  readonly source: Skill["source"];
  readonly evidence: Skill["evidence"];
  readonly mode: ActionPolicyMode;
  readonly now?: number;
}

function hasPredicates(subtask: SkillDraft["subtasks"][number] | CoreSkillDraft["subtasks"][number]): subtask is CoreSkillDraft["subtasks"][number] {
  return Array.isArray((subtask as { completionPredicates?: unknown }).completionPredicates);
}

/** Risk class implied by the draft's key steps and risk notes. */
export function draftRiskClass(draft: SkillDraft | CoreSkillDraft): RiskClass {
  const texts = [
    ...draft.subtasks.flatMap((subtask) => subtask.keySteps),
    ...draft.riskNotes
  ];
  const classes = texts.map((text) => classifyText(text).riskClass).filter((riskClass) => riskClass !== "unknown");
  return classes.length === 0 ? "unknown" : maxRiskClass(classes);
}

/** Materializes a version-1 skill from a draft with policy defaults. */
export function skillFromDraft(draft: SkillDraft | CoreSkillDraft, options: SkillFromDraftOptions): Skill {
  if (draft.subtasks.length === 0) throw new Error("skillFromDraft: a skill needs at least one subtask");
  const now = options.now ?? Date.now();
  const id = options.id ?? newId("skill");
  return {
    id,
    version: 1,
    name: draft.name,
    description: draft.description,
    trigger: draft.trigger,
    preconditions: [],
    variables: draft.variables.map((variable) => ({ ...variable, examples: [...variable.examples] })),
    subtasks: draft.subtasks.map((subtask, index) => ({
      id: `${id}_st${index + 1}`,
      title: subtask.title,
      goal: subtask.goal,
      completionCriteria: subtask.completionCriteria,
      keySteps: [...subtask.keySteps],
      completionPredicates: hasPredicates(subtask) ? [...subtask.completionPredicates] : [{ kind: "user_confirm" }],
      appOrDomain: subtask.appOrDomain
    })),
    allowedApps: [...draft.allowedApps],
    allowedDomains: [...draft.allowedDomains],
    policy: { ...DEFAULT_ACTION_POLICY, mode: options.mode },
    maxSteps: 60,
    timeoutMs: 20 * 60 * 1000,
    riskClass: draftRiskClass(draft),
    evidence: { ...options.evidence, episodeIds: [...options.evidence.episodeIds] },
    corrections: [],
    successCriteria: [...draft.successCriteria],
    source: options.source,
    createdAt: now,
    updatedAt: now,
    archived: false
  };
}

const IMMUTABLE_FIELDS: ReadonlySet<string> = new Set(["id", "version", "corrections", "createdAt", "updatedAt"]);

/** Returns a new skill with version + 1 and one correction per changed field. The previous skill is untouched. */
export function reviseSkill(previous: Skill, changes: Partial<Skill>, note: string, now = Date.now()): Skill {
  const changedFields = (Object.keys(changes) as Array<keyof Skill>).filter(
    (field) => !IMMUTABLE_FIELDS.has(field) && changes[field] !== undefined && canonicalJson(changes[field]) !== canonicalJson(previous[field])
  );
  if (changedFields.length === 0) throw new Error("reviseSkill: no effective changes");
  const applied = changedFields.reduce<Partial<Skill>>((acc, field) => ({ ...acc, [field]: changes[field] }), {});
  const corrections = changedFields.map((field) => ({ ts: now, field: String(field).slice(0, 64), note: note.slice(0, 500), fromVersion: previous.version }));
  return {
    ...previous,
    ...applied,
    id: previous.id,
    version: previous.version + 1,
    createdAt: previous.createdAt,
    updatedAt: now,
    corrections: [...previous.corrections, ...corrections]
  };
}
