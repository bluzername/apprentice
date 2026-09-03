export { clusterBySimilarity, median } from "./cluster.js";
export { DEFAULT_CONSENSUS_RATIO, consensusSteps, type ConsensusStep } from "./consensus.js";
export { alignedLabelVariables, detectVariables, guessVariableKind, routeVariables } from "./variables.js";
export {
  CONFIDENCE_WEIGHTS,
  confidenceFromComponents,
  explainConfidence,
  lowRiskCoverage,
  scoreComponents,
  type ExplanationInput,
  type ScoreInput
} from "./scoring.js";
export { deterministicTitle, outcomePhrase, triggerPhrase } from "./title.js";
export { DISCOVER_DEFAULTS, discoverCandidates, type DiscoverOptions } from "./discover.js";
