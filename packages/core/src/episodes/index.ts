export { CONSUMPTION_DOMAINS, consumptionScore, isConsumptionDomain } from "./consumption.js";
export {
  CONTEXT_SHIFT_GAP_MS,
  CONTEXT_SHIFT_MIN_EVENTS,
  OUTCOME_CLICK_TERMS,
  OUTCOME_TAIL_WINDOW_MS,
  eventContext,
  isClosingAction,
  isContextShift,
  isOutcomeEvent,
  isUserCorrection
} from "./boundaries.js";
export {
  ACTIVE_GAP_MAX_MS,
  activeDuration,
  buildEpisode,
  countMeaningfulActions,
  dedupeConsecutiveViews,
  episodeId,
  episodeTokens,
  type BuildEpisodeInput
} from "./build.js";
export {
  FRAGMENT_MAX_SPAN_MS,
  FRAGMENT_MIN_ACTIONS,
  TAIL_MERGE_GAP_MS,
  isTrailingFragment,
  mergeTrailingDrafts,
  type EpisodeDraft
} from "./tail-merge.js";
export { DEFAULT_IDLE_GAP_MS, describeBoundaries, segmentEpisodes, type BoundaryDescription, type SegmentOptions } from "./segment.js";
