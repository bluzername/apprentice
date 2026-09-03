import type { ActivityEvent, Episode, EpisodeBoundaryReason } from "@apprentice/schemas";
import { sha256Hex } from "../ids.js";
import { humanizeTokenWithContext } from "../humanize.js";
import { normalizeAppName } from "../normalize/app-name.js";
import { eventToToken, isMeaningfulToken, tokenAction } from "../normalize/token.js";
import { isSensitiveEvent } from "../sensitive/index.js";
import { isOutcomeEvent } from "./boundaries.js";
import { consumptionScore } from "./consumption.js";

export const ACTIVE_GAP_MAX_MS = 60_000;

function unique(values: ReadonlyArray<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined && value.length > 0))];
}

export function activeDuration(events: readonly ActivityEvent[]): number {
  let total = 0;
  for (let index = 1; index < events.length; index += 1) {
    const gap = events[index]!.ts - events[index - 1]!.ts;
    if (gap >= 0 && gap <= ACTIVE_GAP_MAX_MS) total += gap;
  }
  return total;
}

/** Consecutive identical browser view tokens (title flicker, tab refresh) count as one transition. */
export function dedupeConsecutiveViews(tokens: readonly string[]): string[] {
  return tokens.filter((token, index) => !(index > 0 && tokens[index - 1] === token && tokenAction(token) === "view"));
}

/** Ordered action tokens for an event list, with browser view flicker collapsed. */
export function episodeTokens(events: readonly ActivityEvent[]): string[] {
  return dedupeConsecutiveViews(events.map((event) => eventToToken(event)).filter((token): token is string => token !== null));
}

export function countMeaningfulActions(events: readonly ActivityEvent[]): number {
  return episodeTokens(events).filter((token) => isMeaningfulToken(token)).length;
}

export function episodeId(sessionId: string, events: readonly ActivityEvent[]): string {
  const first = events[0];
  const seed = `${sessionId}:${first?.ts ?? 0}:${first?.id ?? ""}:${events.length}`;
  return `ep_${sha256Hex(seed).slice(0, 20)}`;
}

export interface BuildEpisodeInput {
  readonly sessionId: string;
  readonly events: readonly ActivityEvent[];
  readonly boundaryReasons: readonly EpisodeBoundaryReason[];
  readonly explicit: boolean;
}

export function buildEpisode(input: BuildEpisodeInput): Episode {
  const { events } = input;
  if (events.length === 0) throw new Error("buildEpisode: an episode needs at least one event");
  const tokens = episodeTokens(events);
  const meaningful = tokens.filter((token) => isMeaningfulToken(token));
  const outcomeTokens = events
    .filter((event) => isOutcomeEvent(event))
    .map((event) => eventToToken(event))
    .filter((token): token is string => token !== null);
  const lastOutcome = outcomeTokens[outcomeTokens.length - 1];
  const firstMeaningful = meaningful[0];
  const hasSensitive = events.some((event) => isSensitiveEvent(event));
  const hasGaps = events.some((event) => event.privacy === "privacy_gap" || event.type === "privacy_gap");
  return {
    id: episodeId(input.sessionId, events),
    sessionId: input.sessionId,
    startTs: events[0]!.ts,
    endTs: events[events.length - 1]!.ts,
    eventIds: events.map((event) => event.id),
    boundary: input.explicit ? "explicit" : "inferred",
    boundaryReasons: [...input.boundaryReasons],
    apps: unique(events.map((event) => (event.app ? normalizeAppName(event.app.bundleId, event.app.name) : undefined))),
    domains: unique(events.map((event) => event.domain?.toLowerCase())),
    actionTokens: tokens,
    meaningfulActionCount: meaningful.length,
    triggerHypothesis: firstMeaningful !== undefined ? humanizeTokenWithContext(firstMeaningful) : undefined,
    outcomeHypothesis: lastOutcome !== undefined ? humanizeTokenWithContext(lastOutcome) : undefined,
    activeDurationMs: activeDuration(events),
    privacyStatus: hasSensitive ? "contains_sensitive" : hasGaps ? "contains_gaps" : "clean",
    analysisStatus: "none",
    consumptionScore: consumptionScore(events.map((event) => event.domain))
  };
}
