import { draftSkillFromCandidate, skillFromDraft } from "@apprentice/core";
import type { ActivityEvent, CandidateUserAction, CandidateSuppressionState, Episode, Run, Skill, SkillDraft, WorkflowCandidate } from "@apprentice/schemas";
import type { Analytics } from "../analytics.js";
import type { StorageRef } from "../app-context.js";
import type { Clock } from "../clock.js";
import { ServiceError } from "../errors.js";
import { addNeverLearnKey } from "./scheduler.js";

export interface CandidateActionResult {
  readonly candidate: WorkflowCandidate;
  readonly skill: Skill | null;
  readonly run: Run | null;
}

export interface CandidateActionsDeps {
  readonly storage: StorageRef;
  readonly analytics: Analytics;
  readonly clock: Clock;
  readonly startRun: (skillId: string) => Promise<Run>;
}

const SUPPRESSION: Readonly<Record<Exclude<CandidateUserAction, "try_once" | "edit_and_save">, CandidateSuppressionState>> = {
  not_useful: "not_useful",
  wrong_boundaries: "wrong_boundaries",
  private_workflow: "private",
  already_automated: "already_automated",
  never_learn: "never_learn"
};

/** Candidate card actions: convert to a skill (and optionally run) or suppress the pattern. */
export class CandidateActions {
  constructor(private readonly deps: CandidateActionsDeps) {}

  get(id: string): WorkflowCandidate {
    const candidate = this.deps.storage.current.candidates.get(id);
    if (!candidate) throw new ServiceError("not_found", `Candidate ${id} not found`);
    return candidate;
  }

  draft(id: string): SkillDraft {
    const candidate = this.get(id);
    const episodes = this.deps.storage.current.episodes.byIds(candidate.evidenceEpisodeIds);
    const core = draftSkillFromCandidate(candidate, episodes, this.evidenceEvents(episodes));
    return { ...core, subtasks: core.subtasks.map(({ completionPredicates: _predicates, ...rest }) => rest) };
  }

  /** Recorded events behind the evidence episodes; they carry the titles and apps the predicates are derived from. */
  private evidenceEvents(episodes: readonly Episode[]): ActivityEvent[] {
    const ids = episodes.flatMap((episode) => episode.eventIds);
    return ids.length === 0 ? [] : this.deps.storage.current.events.byIds(ids);
  }

  /** Materializes the candidate as a version-1 skill and marks the candidate converted. */
  convert(id: string, mode: Skill["policy"]["mode"] = "guide"): { candidate: WorkflowCandidate; skill: Skill } {
    const storage = this.deps.storage.current;
    const candidate = this.get(id);
    const episodes = storage.episodes.byIds(candidate.evidenceEpisodeIds);
    const draft = draftSkillFromCandidate(candidate, episodes, this.evidenceEvents(episodes));
    const skill = storage.skills.save(
      skillFromDraft(draft, { source: "candidate", evidence: { episodeIds: [...candidate.evidenceEpisodeIds], candidateId: candidate.id }, mode, now: this.deps.clock.now() })
    );
    const updated = storage.candidates.update({ ...candidate, suppression: { state: "converted", reason: `Skill ${skill.id}`, ts: this.deps.clock.now() }, updatedAt: this.deps.clock.now() });
    this.deps.analytics.track("skill_saved", { source: "candidate", subtasks: skill.subtasks.length }, skill.riskClass);
    return { candidate: updated, skill };
  }

  async act(id: string, action: CandidateUserAction): Promise<CandidateActionResult> {
    if (action === "try_once") {
      const { candidate, skill } = this.convert(id);
      this.deps.analytics.track("candidate_accepted", { action, repeatCount: candidate.repeatCount }, candidate.riskClass);
      const run = await this.deps.startRun(skill.id);
      return { candidate, skill, run };
    }
    if (action === "edit_and_save") {
      const { candidate, skill } = this.convert(id);
      this.deps.analytics.track("candidate_edited", { action, repeatCount: candidate.repeatCount }, candidate.riskClass);
      return { candidate, skill, run: null };
    }
    const candidate = this.get(id);
    const state = SUPPRESSION[action];
    const now = this.deps.clock.now();
    const updated = this.deps.storage.current.candidates.update({ ...candidate, suppression: { state, reason: action, ts: now }, updatedAt: now });
    if (action === "never_learn") addNeverLearnKey(this.deps.storage, candidate.patternKey);
    this.deps.analytics.track("candidate_rejected", { action, repeatCount: candidate.repeatCount }, candidate.riskClass);
    return { candidate: updated, skill: null, run: null };
  }
}
