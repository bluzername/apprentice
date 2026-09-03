import type { ActivityEvent, Episode, EpisodeBoundaryReason } from "@apprentice/schemas";
import {
  OUTCOME_TAIL_WINDOW_MS,
  isClosingAction,
  isContextShift,
  isIdleStart,
  isOutcomeEvent,
  isUserCorrection,
  teachPhase
} from "./boundaries.js";
import { buildEpisode } from "./build.js";
import { mergeTrailingDrafts, type EpisodeDraft } from "./tail-merge.js";

export const DEFAULT_IDLE_GAP_MS = 240_000;

export interface SegmentOptions {
  readonly sessionId: string;
  readonly idleGapMs?: number;
}

/** An outcome event was seen; the close is deferred so closing actions can be absorbed. */
interface PendingOutcome {
  readonly ts: number;
  readonly absorbed: boolean;
}

interface Open extends EpisodeDraft {
  readonly pending?: PendingOutcome;
}

interface State {
  readonly open: Open;
  readonly closed: readonly EpisodeDraft[];
}

function sortEvents(events: readonly ActivityEvent[]): ActivityEvent[] {
  return [...events].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
}

function emptyOpen(reason: EpisodeBoundaryReason, explicit: boolean): Open {
  return { events: [], reasons: [reason], explicit };
}

/**
 * Closes the open draft (if any) with `closeReasons`; the next draft opens with
 * `nextReason`. `nextExplicit` marks the episode that starts next as taught.
 */
function close(
  state: State,
  closeReasons: readonly EpisodeBoundaryReason[],
  nextReason: EpisodeBoundaryReason,
  nextExplicit = false
): State {
  if (state.open.events.length === 0) {
    return { open: emptyOpen(nextReason, nextExplicit || state.open.explicit), closed: state.closed };
  }
  const draft: EpisodeDraft = {
    events: state.open.events,
    reasons: [...state.open.reasons, ...closeReasons],
    explicit: state.open.explicit
  };
  return { open: emptyOpen(nextReason, nextExplicit), closed: [...state.closed, draft] };
}

function closeWith(state: State, reason: EpisodeBoundaryReason, nextExplicit = false): State {
  return close(state, [reason], reason, nextExplicit);
}

/** Performs the deferred outcome close. Absorbed closing actions add "absorbed_tail". */
function resolvePending(state: State, nextReason: EpisodeBoundaryReason = "outcome_event"): State {
  const pending = state.open.pending;
  if (pending === undefined) return state;
  const tail: readonly EpisodeBoundaryReason[] = pending.absorbed ? ["outcome_event", "absorbed_tail"] : ["outcome_event"];
  const extra: readonly EpisodeBoundaryReason[] = nextReason === "outcome_event" ? [] : [nextReason];
  return close(state, [...tail, ...extra], nextReason);
}

function append(state: State, event: ActivityEvent): State {
  return { ...state, open: { ...state.open, events: [...state.open.events, event] } };
}

function absorb(state: State, event: ActivityEvent, pending: PendingOutcome): State {
  const appended = append(state, event);
  return { ...appended, open: { ...appended.open, pending: { ...pending, absorbed: true } } };
}

function markOutcome(state: State, event: ActivityEvent): State {
  return { ...state, open: { ...state.open, pending: { ts: event.ts, absorbed: false } } };
}

/** Closing actions within the tail window after an outcome stay in the finished episode. */
function shouldAbsorb(event: ActivityEvent, pending: PendingOutcome): boolean {
  return event.ts - pending.ts <= OUTCOME_TAIL_WINDOW_MS && isClosingAction(event);
}

/**
 * Splits an event stream into episodes using teach markers, idle gaps, outcome
 * events, context shifts, and user corrections. After an outcome event, closing
 * actions (cmd+w, cmd+q, escape, app switches, ...) within 20 s are absorbed into
 * the finished episode; the next meaningful action starts a new one. Tiny
 * post-outcome fragments are then folded back into the episode before them.
 * Pure: inputs are never mutated.
 */
export function segmentEpisodes(events: readonly ActivityEvent[], options: SegmentOptions): Episode[] {
  const idleGapMs = options.idleGapMs ?? DEFAULT_IDLE_GAP_MS;
  if (idleGapMs <= 0) throw new Error("segmentEpisodes: idleGapMs must be positive");
  const sorted = sortEvents(events);
  let state: State = { open: emptyOpen("session_edge", false), closed: [] };

  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index]!;
    const previous = sorted[index - 1];
    const pending = state.open.pending;

    if (pending !== undefined) {
      if (shouldAbsorb(event, pending)) {
        state = absorb(state, event, pending);
        if (isIdleStart(event)) state = resolvePending(state, "idle_gap");
        continue;
      }
      state = resolvePending(state);
    }

    const phase = teachPhase(event);
    if (phase === "start") {
      state = append(closeWith(state, "teach_marker", true), event);
      continue;
    }
    if (phase === "end") {
      state = closeWith(append(state, event), "teach_marker", false);
      continue;
    }
    if (isIdleStart(event)) {
      state = closeWith(append(state, event), "idle_gap");
      continue;
    }
    if (previous !== undefined && event.ts - previous.ts > idleGapMs) {
      state = closeWith(state, "idle_gap");
    } else if (isUserCorrection(event)) {
      state = closeWith(state, "user_correction");
    } else if (isContextShift(sorted, index)) {
      state = closeWith(state, "context_shift");
    }
    state = append(state, event);
    if (isOutcomeEvent(event)) state = markOutcome(state, event);
  }
  const final = close(resolvePending(state), ["session_edge"], "session_edge");
  return mergeTrailingDrafts(final.closed).map((draft) =>
    buildEpisode({ sessionId: options.sessionId, events: draft.events, boundaryReasons: draft.reasons, explicit: draft.explicit })
  );
}

export interface BoundaryDescription {
  readonly episodeId: string;
  readonly startTs: number;
  readonly endTs: number;
  readonly reasons: readonly EpisodeBoundaryReason[];
  readonly eventCount: number;
  readonly boundary: Episode["boundary"];
}

/** Debug view of episode boundaries. */
export function describeBoundaries(episodes: readonly Episode[]): BoundaryDescription[] {
  return episodes.map((episode) => ({
    episodeId: episode.id,
    startTs: episode.startTs,
    endTs: episode.endTs,
    reasons: episode.boundaryReasons,
    eventCount: episode.eventIds.length,
    boundary: episode.boundary
  }));
}
