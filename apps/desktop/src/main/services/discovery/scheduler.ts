import { DEFAULT_IDLE_GAP_MS, discoverCandidates, segmentEpisodes } from "@apprentice/core";
import type { ActivityEvent, Episode, WorkflowCandidate } from "@apprentice/schemas";
import type { Analytics } from "../analytics.js";
import type { StorageRef } from "../app-context.js";
import type { Clock } from "../clock.js";
import type { Emit } from "../events.js";
import type { Logger } from "../logger.js";

export const NEVER_LEARN_META_KEY = "candidates.neverLearnPatternKeys";
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 2000;
const PERIOD_MS = 10 * 60 * 1000;
const MAX_EVENTS = 20_000;

export interface DiscoveryResult {
  readonly episodes: number;
  readonly candidates: number;
  readonly newCandidates: readonly WorkflowCandidate[];
}

export interface DiscoverySchedulerDeps {
  readonly storage: StorageRef;
  readonly emit: Emit;
  readonly analytics: Analytics;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly debounceMs?: number;
  readonly periodMs?: number;
}

export function readNeverLearnKeys(storage: StorageRef): Set<string> {
  const raw = storage.current.meta.get(NEVER_LEARN_META_KEY);
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []);
  } catch {
    return new Set();
  }
}

export function addNeverLearnKey(storage: StorageRef, patternKey: string): void {
  const keys = readNeverLearnKeys(storage);
  storage.current.meta.set(NEVER_LEARN_META_KEY, JSON.stringify([...keys, patternKey]));
}

function groupBySession(events: readonly ActivityEvent[]): Map<string, ActivityEvent[]> {
  const groups = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const group = groups.get(event.sessionId) ?? [];
    groups.set(event.sessionId, [...group, event]);
  }
  return groups;
}

/** Segments the recent event window into episodes (per session, idle gap 4 min). */
export function segmentRecent(storage: StorageRef, now: number): Episode[] {
  const events = storage.current.events.query({ fromTs: now - LOOKBACK_MS, toTs: now + 60_000, limit: MAX_EVENTS });
  const episodes: Episode[] = [];
  for (const [sessionId, sessionEvents] of groupBySession(events)) {
    episodes.push(...segmentEpisodes(sessionEvents, { sessionId, idleGapMs: DEFAULT_IDLE_GAP_MS }));
  }
  return episodes;
}

/**
 * Debounced (2 s after activity) and periodic (10 min) episode segmentation plus
 * candidate discovery. Suppressed patterns are never regenerated.
 */
export class DiscoveryScheduler {
  private debounceTimer: NodeJS.Timeout | null = null;
  private periodTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: DiscoverySchedulerDeps) {}

  start(): void {
    this.periodTimer = setInterval(() => this.safeRun("periodic"), this.deps.periodMs ?? PERIOD_MS);
    this.periodTimer.unref?.();
  }

  stop(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.periodTimer) clearInterval(this.periodTimer);
    this.debounceTimer = null;
    this.periodTimer = null;
  }

  /** Called after each stored batch; coalesces bursts of activity. */
  schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.safeRun("debounced");
    }, this.deps.debounceMs ?? DEBOUNCE_MS);
    this.debounceTimer.unref?.();
  }

  /** Synchronous segmentation + discovery; used by "episodes:resegment" and demo load. */
  runNow(): DiscoveryResult {
    const now = this.deps.clock.now();
    const storage = this.deps.storage.current;
    const episodes = segmentRecent(this.deps.storage, now);
    storage.episodes.replaceAll(episodes);
    const existing = storage.candidates.list(true);
    const suppressedKeys = new Set<string>([...existing.filter((candidate) => candidate.suppression.state !== "active").map((candidate) => candidate.patternKey), ...readNeverLearnKeys(this.deps.storage)]);
    const discovered = discoverCandidates(episodes, { now, existingPatternKeys: suppressedKeys });
    const byKey = new Map(existing.map((candidate) => [candidate.patternKey, candidate] as const));
    const fresh: WorkflowCandidate[] = [];
    for (const candidate of discovered) {
      const stored = byKey.get(candidate.patternKey);
      if (stored) {
        storage.candidates.upsert({ ...candidate, id: stored.id, createdAt: stored.createdAt, suppression: stored.suppression, refinedTitle: stored.refinedTitle, refinedDescription: stored.refinedDescription });
        continue;
      }
      const saved = storage.candidates.upsert(candidate);
      if (saved.suppression.state === "active") fresh.push(saved);
    }
    for (const candidate of fresh) {
      this.deps.emit("event:candidate", { candidate });
      this.deps.analytics.track("candidate_generated", { repeatCount: candidate.repeatCount, confidence: Math.round(candidate.confidence * 100) / 100, steps: candidate.steps.length }, candidate.riskClass);
    }
    return { episodes: episodes.length, candidates: storage.candidates.countActive(), newCandidates: fresh };
  }

  private safeRun(trigger: string): void {
    try {
      const result = this.runNow();
      if (result.newCandidates.length > 0) this.deps.logger.info("discovery produced new candidates", { trigger, count: result.newCandidates.length });
    } catch (error) {
      this.deps.logger.error("discovery failed", { trigger, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
