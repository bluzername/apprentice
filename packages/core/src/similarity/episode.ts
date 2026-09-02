import type { Episode, SimilarityMetrics } from "@apprentice/schemas";
import {
  appTransitionSimilarity,
  durationConsistency,
  normalizedEditDistance,
  tokenWeight,
  weightedLcs
} from "./metrics.js";

export const SIMILARITY_WEIGHTS = {
  weightedLcs: 0.45,
  editSimilarity: 0.2,
  appTransitionSimilarity: 0.15,
  durationConsistency: 0.1,
  trigger: 0.05,
  outcome: 0.05
} as const;

function round(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

function sameHypothesis(a: string | undefined, b: string | undefined): number {
  if (a === undefined || b === undefined) return 0;
  return a === b ? 1 : 0;
}

/** Pairwise similarity between two episodes. meanPairwise is the weighted combination. */
export function episodeSimilarity(a: Episode, b: Episode): SimilarityMetrics {
  const lcs = weightedLcs(a.actionTokens, b.actionTokens, tokenWeight);
  const editSimilarity = 1 - normalizedEditDistance(a.actionTokens, b.actionTokens);
  const transition = appTransitionSimilarity(a.actionTokens, b.actionTokens);
  const duration = durationConsistency([a.activeDurationMs, b.activeDurationMs]);
  const trigger = sameHypothesis(a.triggerHypothesis, b.triggerHypothesis);
  const outcome = sameHypothesis(a.outcomeHypothesis, b.outcomeHypothesis);
  const mean =
    SIMILARITY_WEIGHTS.weightedLcs * lcs +
    SIMILARITY_WEIGHTS.editSimilarity * editSimilarity +
    SIMILARITY_WEIGHTS.appTransitionSimilarity * transition +
    SIMILARITY_WEIGHTS.durationConsistency * duration +
    SIMILARITY_WEIGHTS.trigger * trigger +
    SIMILARITY_WEIGHTS.outcome * outcome;
  return {
    meanPairwise: round(mean),
    minPairwise: round(Math.min(lcs, editSimilarity, transition)),
    weightedLcs: round(lcs),
    editSimilarity: round(editSimilarity),
    appTransitionSimilarity: round(transition),
    durationConsistency: round(duration)
  };
}

/** Symmetric matrix of meanPairwise scores; the diagonal is 1. */
export function similarityMatrix(episodes: readonly Episode[]): number[][] {
  return episodes.map((a, i) =>
    episodes.map((b, j) => {
      if (i === j) return 1;
      return episodeSimilarity(a, b).meanPairwise;
    })
  );
}
