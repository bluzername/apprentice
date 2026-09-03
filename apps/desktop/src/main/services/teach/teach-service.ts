import { draftSkillFromEvents, eventToToken, skillFromDraft, skillRetentionPreview, type CoreSkillDraft } from "@apprentice/core";
import type { ActionPolicyMode, ActivityEvent, AppSettings, CompletionPredicate, DraftSkillInput, ScreenshotRecord, Skill, SkillDraft } from "@apprentice/schemas";
import type { Analytics } from "../analytics.js";
import type { StorageRef } from "../app-context.js";
import type { Clock } from "../clock.js";
import { ServiceError } from "../errors.js";
import type { Logger } from "../logger.js";
import { isTaughtEvent, parseTeachShortcut, trimAtTeachMarker } from "./teach-filter.js";

export const PROTECTED_SCREENSHOTS_META_KEY = "retention.protectedScreenshotIds";

export interface TeachRange {
  readonly startTs: number;
  readonly endTs: number;
  readonly excludedEventIds: readonly string[];
}

export interface TeachOpenResult {
  readonly startTs: number;
  readonly endTs: number;
  readonly events: ActivityEvent[];
  readonly screenshots: ScreenshotRecord[];
}

export interface TeachDraftResult {
  readonly draft: SkillDraft;
  readonly retained: { eventCount: number; screenshotCount: number; fields: string[] };
}

/** Optional model refinement: returns null when no healthy non-mock analysis provider exists. */
export interface DraftRefiner {
  refine(input: DraftSkillInput): Promise<SkillDraft | null>;
}

export interface TeachServiceDeps {
  readonly storage: StorageRef;
  readonly settings: { get(): AppSettings };
  readonly analytics: Analytics;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly refiner?: DraftRefiner;
}

export function readProtectedScreenshotIds(storage: StorageRef): Set<string> {
  const raw = storage.current.meta.get(PROTECTED_SCREENSHOTS_META_KEY);
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function rangeKey(range: TeachRange): string {
  return `${range.startTs}:${range.endTs}`;
}

/** "Learn what I just did": open a range, draft a skill, preview retention, save a versioned skill. */
export class TeachService {
  private readonly predicateCache = new Map<string, readonly (readonly CompletionPredicate[])[]>();

  constructor(private readonly deps: TeachServiceDeps) {}

  openRange(minutes: number): TeachOpenResult {
    const endTs = this.deps.clock.now();
    const startTs = endTs - minutes * 60_000;
    this.deps.analytics.track("teach_started", { minutes });
    return { startTs, endTs, ...this.load({ startTs, endTs, excludedEventIds: [] }) };
  }

  private load(range: TeachRange): { events: ActivityEvent[]; screenshots: ScreenshotRecord[] } {
    const storage = this.deps.storage.current;
    const excluded = new Set(range.excludedEventIds);
    const teachShortcut = parseTeachShortcut(this.deps.settings.get().shortcuts.teach);
    const stored = storage.events.query({ fromTs: range.startTs, toTs: range.endTs, limit: 5000 }, { revealSensitive: true });
    const events = trimAtTeachMarker(stored).filter((event) => isTaughtEvent(event, teachShortcut) && !excluded.has(event.id));
    const screenshots = storage.screenshots.inRange(range.startTs, range.endTs);
    return { events, screenshots };
  }

  async draft(range: TeachRange): Promise<TeachDraftResult> {
    const { events, screenshots } = this.load(range);
    const actionable = events.filter((event) => eventToToken(event) !== null);
    if (actionable.length === 0) throw new ServiceError("empty_range", "No recorded actions in the selected range");
    const core = draftSkillFromEvents(events);
    this.predicateCache.set(rangeKey(range), core.subtasks.map((subtask) => subtask.completionPredicates));
    const deterministic = stripPredicates(core);
    const refined = await this.tryRefine(deterministic, events);
    const draft = refined ?? deterministic;
    const retained = skillRetentionPreview(draft, events, screenshots);
    return { draft, retained: { eventCount: retained.eventCount, screenshotCount: retained.screenshotCount, fields: [...retained.fields] } };
  }

  private async tryRefine(deterministic: SkillDraft, events: readonly ActivityEvent[]): Promise<SkillDraft | null> {
    if (!this.deps.refiner) return null;
    const actionTokens = events.map((event) => eventToToken(event)).filter((token): token is string => token !== null).slice(0, 400);
    const redactedSummary = actionTokens.join("\n").slice(0, 8000);
    try {
      return await this.deps.refiner.refine({ deterministicDraft: deterministic, redactedSummary, actionTokens, screenshots: [] });
    } catch (error) {
      this.deps.logger.warn("draft refinement failed; keeping the deterministic draft", { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  save(draft: SkillDraft, range: TeachRange, mode: ActionPolicyMode): Skill {
    const storage = this.deps.storage.current;
    const cached = this.predicateCache.get(rangeKey(range));
    const withPredicates: CoreSkillDraft = {
      ...draft,
      subtasks: draft.subtasks.map((subtask, index) => ({
        ...subtask,
        keySteps: [...subtask.keySteps],
        completionPredicates: cached && cached.length === draft.subtasks.length ? [...(cached[index] ?? [])] : [{ kind: "user_confirm" }]
      }))
    };
    const skill = storage.skills.save(
      skillFromDraft(withPredicates, { source: "taught", evidence: { episodeIds: [], taughtRange: { startTs: range.startTs, endTs: range.endTs } }, mode, now: this.deps.clock.now() })
    );
    const screenshots = storage.screenshots.inRange(range.startTs, range.endTs);
    const protectedIds = readProtectedScreenshotIds(this.deps.storage);
    for (const shot of screenshots) protectedIds.add(shot.id);
    storage.meta.set(PROTECTED_SCREENSHOTS_META_KEY, JSON.stringify([...protectedIds]));
    this.deps.analytics.track("teach_saved", { subtasks: skill.subtasks.length, origin: draft.origin }, skill.riskClass);
    this.deps.analytics.track("skill_saved", { source: "taught", subtasks: skill.subtasks.length }, skill.riskClass);
    return skill;
  }
}

function stripPredicates(core: CoreSkillDraft): SkillDraft {
  return { ...core, subtasks: core.subtasks.map(({ completionPredicates: _predicates, ...rest }) => rest) };
}
