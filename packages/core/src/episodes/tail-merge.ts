import type { ActivityEvent, EpisodeBoundaryReason } from "@apprentice/schemas";
import { countMeaningfulActions } from "./build.js";

/** Fragments with fewer meaningful actions than this are merge candidates. */
export const FRAGMENT_MIN_ACTIONS = 2;
/** Fragments shorter than this are merge candidates. */
export const FRAGMENT_MAX_SPAN_MS = 10_000;
/** A fragment merges into the previous episode only when that episode ended less than this long before. */
export const TAIL_MERGE_GAP_MS = 20_000;

/** An episode before it is built: its events plus the boundary bookkeeping. */
export interface EpisodeDraft {
  readonly events: readonly ActivityEvent[];
  readonly reasons: readonly EpisodeBoundaryReason[];
  readonly explicit: boolean;
}

function firstTs(draft: EpisodeDraft): number | undefined {
  return draft.events[0]?.ts;
}

function lastTs(draft: EpisodeDraft): number | undefined {
  return draft.events[draft.events.length - 1]?.ts;
}

/**
 * True for an inferred draft that was split off by an outcome event and holds
 * fewer than two meaningful actions inside a span under ten seconds.
 */
export function isTrailingFragment(draft: EpisodeDraft): boolean {
  if (draft.explicit || draft.reasons[0] !== "outcome_event") return false;
  const start = firstTs(draft);
  const end = lastTs(draft);
  if (start === undefined || end === undefined) return false;
  return end - start < FRAGMENT_MAX_SPAN_MS && countMeaningfulActions(draft.events) < FRAGMENT_MIN_ACTIONS;
}

function dedupeAdjacent(reasons: readonly EpisodeBoundaryReason[]): EpisodeBoundaryReason[] {
  return reasons.filter((reason, index) => index === 0 || reasons[index - 1] !== reason);
}

/** Appends the fragment to the previous draft. The fragment's opening reason duplicates the previous close and is dropped. */
function mergeInto(previous: EpisodeDraft, fragment: EpisodeDraft): EpisodeDraft {
  return {
    events: [...previous.events, ...fragment.events],
    reasons: dedupeAdjacent([...previous.reasons, "absorbed_tail", ...fragment.reasons.slice(1)]),
    explicit: previous.explicit
  };
}

/**
 * Merges tiny post-outcome fragments into the episode before them when that
 * episode ended less than 20 s earlier. Fragments are never merged forward.
 */
export function mergeTrailingDrafts(drafts: readonly EpisodeDraft[]): EpisodeDraft[] {
  return drafts.reduce<EpisodeDraft[]>((merged, draft) => {
    const previous = merged[merged.length - 1];
    if (previous === undefined || !isTrailingFragment(draft)) return [...merged, draft];
    const previousEnd = lastTs(previous);
    const start = firstTs(draft);
    if (previousEnd === undefined || start === undefined || start - previousEnd >= TAIL_MERGE_GAP_MS) return [...merged, draft];
    return [...merged.slice(0, -1), mergeInto(previous, draft)];
  }, []);
}
