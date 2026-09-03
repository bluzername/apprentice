import type { ActivityEvent } from "@apprentice/schemas";
import { OUTCOME_TAIL_WINDOW_MS, eventContext } from "../episodes/boundaries.js";

/** A title observed at the end of a subtask, with the one it replaced. */
export interface TitleObservation {
  readonly after: string;
  readonly before?: string;
}

export interface GroupRange {
  readonly context: string;
  readonly startTs: number;
  readonly endTs: number;
  /** First action of the next group; titles from there on belong to that group. */
  readonly nextStartTs?: number;
}

/**
 * What recorded activity tells the deterministic drafter about a subtask group.
 * Two implementations: a real timeline (taught ranges) and context-keyed
 * observations (candidates, whose step "timestamps" are only indices).
 */
export interface DraftEvidence {
  /** Bundle id of the app that owned a context (app name or domain), when recorded. */
  readonly bundleIdFor: (context: string) => string | undefined;
  /** The title on screen once the group's last action is done. */
  readonly titleAfter: (range: GroupRange) => TitleObservation | undefined;
}

export const NO_DRAFT_EVIDENCE: DraftEvidence = {
  bundleIdFor: () => undefined,
  titleAfter: () => undefined
};

interface TitleEntry {
  readonly ts: number;
  readonly title: string;
  readonly context: string | undefined;
}

function titleEntries(events: readonly ActivityEvent[]): TitleEntry[] {
  return events
    .filter((event) => event.type === "window_title_changed" || event.type === "page_title")
    .map((event) => ({ ts: event.ts, title: event.payload?.["title"], context: eventContext(event) }))
    .filter((entry): entry is TitleEntry => typeof entry.title === "string" && entry.title.trim().length > 0);
}

/** Context (app name or domain) to the bundle id that produced it; the first sighting wins. */
function bundleIdsByContext(events: readonly ActivityEvent[]): ReadonlyMap<string, string> {
  return events.reduce((map, event) => {
    const context = eventContext(event);
    const bundleId = event.app?.bundleId;
    if (context === undefined || bundleId === undefined || map.has(context)) return map;
    return new Map([...map, [context, bundleId]]);
  }, new Map<string, string>());
}

function lastIndexWhere(entries: readonly TitleEntry[], matches: (entry: TitleEntry) => boolean): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (matches(entries[index]!)) return index;
  }
  return -1;
}

/** The matched title plus the title it replaced, so callers can diff the two. */
function withPredecessor(entries: readonly TitleEntry[], index: number): TitleObservation | undefined {
  const after = entries[index];
  if (after === undefined) return undefined;
  const before = entries[index - 1];
  return before === undefined ? { after: after.title } : { after: after.title, before: before.title };
}

function sortByTime(events: readonly ActivityEvent[]): ActivityEvent[] {
  return [...events].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
}

/**
 * Evidence from a real timeline. The title lookup runs past the group's last
 * action by the outcome tail window, so the title a submit or save produces
 * counts as that subtask's completion signal. It never runs into the next
 * group, whose titles describe the next subtask's screen.
 */
export function timelineEvidence(events: readonly ActivityEvent[]): DraftEvidence {
  const sorted = sortByTime(events);
  const titles = titleEntries(sorted);
  const bundleIds = bundleIdsByContext(sorted);
  return {
    bundleIdFor: (context) => bundleIds.get(context),
    titleAfter: ({ startTs, endTs, nextStartTs }) => {
      const tailEnd = endTs + OUTCOME_TAIL_WINDOW_MS;
      const inRange = (entry: TitleEntry): boolean => entry.ts >= startTs && entry.ts <= tailEnd && (nextStartTs === undefined || entry.ts < nextStartTs);
      return withPredecessor(titles, lastIndexWhere(titles, inRange));
    }
  };
}

/**
 * Evidence for a candidate, whose steps carry indices rather than clock times.
 * The last title recorded in a group's own context stands in for the title
 * after its last action.
 */
export function contextEvidence(events: readonly ActivityEvent[]): DraftEvidence {
  const sorted = sortByTime(events);
  const titles = titleEntries(sorted);
  const bundleIds = bundleIdsByContext(sorted);
  return {
    bundleIdFor: (context) => bundleIds.get(context),
    titleAfter: ({ context }) => withPredecessor(titles, lastIndexWhere(titles, (entry) => entry.context === context))
  };
}

/**
 * The part of `after` that `before` did not already contain, as a run of
 * consecutive words. "Inbox - Mail" -> "Re: Offer - Mail" yields "Re: Offer".
 * Falls back to the whole title when nothing is new.
 */
export function changedTitlePart(after: string, before: string | undefined): string {
  if (before === undefined || before.trim().length === 0) return after;
  const seen = new Set(before.toLowerCase().split(/\s+/).filter((word) => word.length > 0));
  const words = after.split(/\s+/).filter((word) => word.length > 0);
  const best = words.reduce<{ best: readonly string[]; current: readonly string[] }>(
    (state, word) => {
      if (seen.has(word.toLowerCase())) return { best: state.best, current: [] };
      const current = [...state.current, word];
      return { best: current.length > state.best.length ? current : state.best, current };
    },
    { best: [], current: [] }
  ).best;
  return best.length > 0 ? best.join(" ") : after;
}
