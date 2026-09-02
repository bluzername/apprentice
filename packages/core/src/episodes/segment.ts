import type { ActivityEvent, Episode, EpisodeBoundaryReason } from "@apprentice/schemas";
import { isContextShift, isIdleStart, isOutcomeEvent, isUserCorrection, teachPhase } from "./boundaries.js";
import { buildEpisode } from "./build.js";

export const DEFAULT_IDLE_GAP_MS = 240_000;

export interface SegmentOptions {
  readonly sessionId: string;
  readonly idleGapMs?: number;
}

interface Open {
  readonly events: readonly ActivityEvent[];
  readonly reasons: readonly EpisodeBoundaryReason[];
  readonly explicit: boolean;
}

interface State {
  readonly open: Open;
  readonly closed: readonly Episode[];
}

function sortEvents(events: readonly ActivityEvent[]): ActivityEvent[] {
  return [...events].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
}

/** Closes the open episode (if any). `nextExplicit` marks the episode that starts next as taught. */
function close(state: State, sessionId: string, reason: EpisodeBoundaryReason, nextExplicit = false): State {
  if (state.open.events.length === 0) {
    return { open: { events: [], reasons: [reason], explicit: nextExplicit || state.open.explicit }, closed: state.closed };
  }
  const episode = buildEpisode({
    sessionId,
    events: state.open.events,
    boundaryReasons: [...state.open.reasons, reason],
    explicit: state.open.explicit
  });
  return { open: { events: [], reasons: [reason], explicit: nextExplicit }, closed: [...state.closed, episode] };
}

function append(state: State, event: ActivityEvent): State {
  return { ...state, open: { ...state.open, events: [...state.open.events, event] } };
}

/**
 * Splits an event stream into episodes using teach markers, idle gaps, outcome
 * events, context shifts, and user corrections. Pure: inputs are never mutated.
 */
export function segmentEpisodes(events: readonly ActivityEvent[], options: SegmentOptions): Episode[] {
  const idleGapMs = options.idleGapMs ?? DEFAULT_IDLE_GAP_MS;
  if (idleGapMs <= 0) throw new Error("segmentEpisodes: idleGapMs must be positive");
  const sorted = sortEvents(events);
  let state: State = { open: { events: [], reasons: ["session_edge"], explicit: false }, closed: [] };

  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index]!;
    const previous = sorted[index - 1];
    const phase = teachPhase(event);

    if (phase === "start") {
      state = append(close(state, options.sessionId, "teach_marker", true), event);
      continue;
    }
    if (phase === "end") {
      state = close(append(state, event), options.sessionId, "teach_marker", false);
      continue;
    }
    if (isIdleStart(event)) {
      state = close(append(state, event), options.sessionId, "idle_gap");
      continue;
    }
    if (previous !== undefined && event.ts - previous.ts > idleGapMs) {
      state = close(state, options.sessionId, "idle_gap");
    } else if (isUserCorrection(event)) {
      state = close(state, options.sessionId, "user_correction");
    } else if (isContextShift(sorted, index)) {
      state = close(state, options.sessionId, "context_shift");
    }
    state = append(state, event);
    if (isOutcomeEvent(event)) {
      state = close(state, options.sessionId, "outcome_event");
    }
  }
  const final = close(state, options.sessionId, "session_edge");
  return [...final.closed];
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
