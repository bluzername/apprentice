import type { Episode, RiskClass, ScoreComponents } from "@apprentice/schemas";
import { LOW_RISK_CLASSES } from "../risk/dictionaries.js";
import { tokenRiskClass } from "../risk/token-risk.js";
import { outcomeConsistency, triggerConsistency } from "../similarity/metrics.js";

export const CONFIDENCE_WEIGHTS: Readonly<Record<keyof ScoreComponents, number>> = {
  sequenceSimilarity: 0.35,
  repeatCount: 0.15,
  triggerConsistency: 0.15,
  outcomeConsistency: 0.15,
  timeCost: 0.1,
  lowRiskCoverage: 0.1
};

const REPEATS_FOR_FULL_SCORE = 5;
const WEEKLY_MINUTES_FOR_FULL_SCORE = 60;

function clamp(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

export interface ScoreInput {
  readonly episodes: readonly Episode[];
  readonly meanSimilarity: number;
  readonly consensusTokens: readonly string[];
  readonly estimatedWeeklyMinutes: number;
}

export function lowRiskCoverage(tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const lowRisk = tokens.filter((token) => LOW_RISK_CLASSES.has(tokenRiskClass(token))).length;
  return lowRisk / tokens.length;
}

export function scoreComponents(input: ScoreInput): ScoreComponents {
  const repeats = input.episodes.length;
  return {
    sequenceSimilarity: clamp(input.meanSimilarity),
    repeatCount: clamp((repeats - 1) / (REPEATS_FOR_FULL_SCORE - 1)),
    triggerConsistency: clamp(triggerConsistency(input.episodes.map((episode) => episode.triggerHypothesis))),
    outcomeConsistency: clamp(outcomeConsistency(input.episodes.map((episode) => episode.outcomeHypothesis))),
    timeCost: clamp(input.estimatedWeeklyMinutes / WEEKLY_MINUTES_FOR_FULL_SCORE),
    lowRiskCoverage: clamp(lowRiskCoverage(input.consensusTokens))
  };
}

export function confidenceFromComponents(components: ScoreComponents): number {
  const keys = Object.keys(CONFIDENCE_WEIGHTS) as ReadonlyArray<keyof ScoreComponents>;
  return clamp(keys.reduce((sum, key) => sum + CONFIDENCE_WEIGHTS[key] * components[key], 0));
}

export interface ExplanationInput {
  readonly repeatCount: number;
  readonly components: ScoreComponents;
  readonly trigger?: string;
  readonly outcome?: string;
  readonly riskClass: RiskClass;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Plain-language explanation. Never claims to know the person, only what was observed. */
export function explainConfidence(input: ExplanationInput): string {
  const sentences: string[] = [];
  sentences.push(`I observed a similar sequence ${input.repeatCount} times.`);
  sentences.push(`The steps matched ${input.components.sequenceSimilarity >= 0.8 ? "closely" : "partially"} (${percent(input.components.sequenceSimilarity)}).`);
  if (input.trigger !== undefined && input.outcome !== undefined) {
    const triggerWord = input.components.triggerConsistency >= 0.99 ? "Each time" : "Most times, it";
    sentences.push(`${triggerWord} started with "${input.trigger}" and ended with "${input.outcome}".`);
  } else if (input.trigger !== undefined) {
    sentences.push(`It usually started with "${input.trigger}".`);
  }
  if (input.components.lowRiskCoverage >= 0.99) {
    sentences.push("All steps are low risk.");
  } else if (input.riskClass === "external_communication") {
    sentences.push("At least one step sends something outside your workspace, so that step will always ask first.");
  } else if (input.riskClass === "destructive" || input.riskClass === "financial_or_access") {
    sentences.push(`Some steps look ${input.riskClass === "destructive" ? "destructive" : "financial or access-related"}; those are not automated.`);
  } else {
    sentences.push(`${percent(input.components.lowRiskCoverage)} of the steps are low risk.`);
  }
  return sentences.join(" ").slice(0, 1000);
}
