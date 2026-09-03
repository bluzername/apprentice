export { foreignHitBundleId, hasControlCharacters, validateProposedAction, type ValidationContext } from "./validate.js";
export { DEFAULT_AMBIGUITY_MARGIN_PX, DEFAULT_TARGET_MAX_DISTANCE_PX, resolveTarget, type ResolveTargetInput, type ResolvedTarget } from "./target.js";
export { toExecutableAction } from "./executable.js";
export {
  evaluateCompletionPredicates,
  predicateHolds,
  predicateKey,
  stateHash,
  urlPatternToRegExp,
  type PredicateEvaluation,
  type ScreenState,
  type StateHashInput
} from "./predicates.js";
export { ocrDiff, verifyStepDeterministic, type OcrDiff, type VerificationState, type VerifyStepInput } from "./verify.js";
