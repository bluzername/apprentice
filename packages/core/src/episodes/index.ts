export { CONSUMPTION_DOMAINS, consumptionScore, isConsumptionDomain } from "./consumption.js";
export {
  CONTEXT_SHIFT_GAP_MS,
  CONTEXT_SHIFT_MIN_EVENTS,
  OUTCOME_CLICK_TERMS,
  eventContext,
  isContextShift,
  isOutcomeEvent,
  isUserCorrection
} from "./boundaries.js";
export { ACTIVE_GAP_MAX_MS, activeDuration, buildEpisode, dedupeConsecutiveViews, episodeId, type BuildEpisodeInput } from "./build.js";
export { DEFAULT_IDLE_GAP_MS, describeBoundaries, segmentEpisodes, type BoundaryDescription, type SegmentOptions } from "./segment.js";
