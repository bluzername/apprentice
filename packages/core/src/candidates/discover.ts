import type { CandidateStep, Episode, WorkflowCandidate } from "@apprentice/schemas";
import { humanizeToken } from "../humanize.js";
import { stableHash } from "../ids.js";
import { isMeaningfulToken, tokenAction, tokenContext } from "../normalize/token.js";
import { candidateRiskClass } from "../risk/token-risk.js";
import { episodeSimilarity, similarityMatrix } from "../similarity/episode.js";
import { clusterBySimilarity, median } from "./cluster.js";
import { consensusSteps } from "./consensus.js";
import { confidenceFromComponents, explainConfidence, scoreComponents } from "./scoring.js";
import { deterministicTitle } from "./title.js";
import { detectVariables } from "./variables.js";

export interface DiscoverOptions {
  readonly now: number;
  readonly minEpisodes?: number;
  readonly minMeaningfulActions?: number;
  readonly similarityThreshold?: number;
  readonly minMedianDurationMs?: number;
  readonly existingPatternKeys?: ReadonlySet<string>;
  readonly source?: WorkflowCandidate["source"];
}

export const DISCOVER_DEFAULTS = {
  minEpisodes: 2,
  minMeaningfulActions: 3,
  similarityThreshold: 0.62,
  minMedianDurationMs: 90_000,
  consumptionSuppressionThreshold: 0.5
} as const;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Browser view transitions count as meaningful, but pure browsing (views only) is never a workflow. */
function hasInteraction(tokens: readonly string[]): boolean {
  return tokens.some((token) => isMeaningfulToken(token) && tokenAction(token) !== "view");
}

function eligible(episode: Episode, minMeaningful: number): boolean {
  return (
    episode.privacyStatus !== "contains_sensitive" &&
    episode.actionTokens.length > 0 &&
    episode.meaningfulActionCount >= minMeaningful &&
    hasInteraction(episode.actionTokens)
  );
}

function meanPairwise(members: readonly Episode[]): { mean: number; min: number } {
  const scores: number[] = [];
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      scores.push(episodeSimilarity(members[i]!, members[j]!).meanPairwise);
    }
  }
  if (scores.length === 0) return { mean: 1, min: 1 };
  return { mean: scores.reduce((sum, value) => sum + value, 0) / scores.length, min: Math.min(...scores) };
}

function stepsFromConsensus(tokens: ReadonlyArray<{ token: string; occurrenceRatio: number }>): CandidateStep[] {
  return tokens.map((step, index) => {
    const context = tokenContext(step.token);
    const sentence = humanizeToken(step.token);
    return {
      index,
      token: step.token.slice(0, 512),
      description: (context !== undefined ? `${sentence} on ${context}` : sentence).slice(0, 256),
      appOrDomain: context,
      occurrenceRatio: step.occurrenceRatio
    };
  });
}

function buildCandidate(members: readonly Episode[], options: DiscoverOptions, allMetrics: ReturnType<typeof episodeSimilarity>): WorkflowCandidate {
  const source = options.source ?? "passive";
  const sequences = members.map((episode) => episode.actionTokens);
  const consensus = consensusSteps(sequences);
  const consensusTokens = consensus.map((step) => step.token);
  const patternKey = stableHash(consensusTokens).slice(0, 32);
  const durations = members.map((episode) => episode.activeDurationMs);
  const medianDurationMs = Math.round(median(durations));
  const spanMs = Math.max(DAY_MS, Math.max(...members.map((episode) => episode.endTs)) - Math.min(...members.map((episode) => episode.startTs)));
  const estimatedWeeklyFrequency = Math.round((members.length / spanMs) * WEEK_MS * 100) / 100;
  const estimatedWeeklyMinutes = Math.round(estimatedWeeklyFrequency * (medianDurationMs / 60_000) * 10) / 10;
  const meaningful = consensusTokens.filter((token) => isMeaningfulToken(token));
  const triggerToken = meaningful[0];
  const outcomeToken = meaningful[meaningful.length - 1];
  const riskClass = candidateRiskClass(consensusTokens);
  const components = scoreComponents({ episodes: members, meanSimilarity: allMetrics.meanPairwise, consensusTokens, estimatedWeeklyMinutes });
  const meanConsumption = members.reduce((sum, episode) => sum + episode.consumptionScore, 0) / members.length;
  const suppressed = source === "passive" && meanConsumption > DISCOVER_DEFAULTS.consumptionSuppressionThreshold;
  const trigger = triggerToken !== undefined ? humanizeToken(triggerToken) : (members[0]?.triggerHypothesis ?? "Unknown trigger");
  const outcome = outcomeToken !== undefined ? humanizeToken(outcomeToken) : (members[0]?.outcomeHypothesis ?? "Unknown outcome");
  return {
    id: `cand_${patternKey.slice(0, 24)}`,
    source,
    evidenceEpisodeIds: members.map((episode) => episode.id),
    similarity: allMetrics,
    repeatCount: members.length,
    medianDurationMs,
    estimatedWeeklyFrequency,
    estimatedWeeklyMinutes,
    deterministicTitle: deterministicTitle(triggerToken, outcomeToken),
    trigger: trigger.slice(0, 512),
    steps: stepsFromConsensus(consensus),
    variables: detectVariables(consensusTokens, sequences),
    expectedOutcome: outcome.slice(0, 512),
    confidence: confidenceFromComponents(components),
    confidenceExplanation: explainConfidence({ repeatCount: members.length, components, trigger, outcome, riskClass }),
    scoreComponents: components,
    riskClass,
    suppression: suppressed
      ? { state: "consumption_suppressed", reason: `Mostly browsing or consumption (${Math.round(meanConsumption * 100)}% of events)`, ts: options.now }
      : { state: "active" },
    apps: [...new Set(members.flatMap((episode) => episode.apps))],
    domains: [...new Set(members.flatMap((episode) => episode.domains))],
    createdAt: options.now,
    updatedAt: options.now,
    patternKey
  };
}

function clusterMetrics(members: readonly Episode[]): ReturnType<typeof episodeSimilarity> {
  const pair = meanPairwise(members);
  const first = members[0]!;
  const second = members[1] ?? first;
  const base = episodeSimilarity(first, second);
  return { ...base, meanPairwise: Math.round(pair.mean * 10_000) / 10_000, minPairwise: Math.round(pair.min * 10_000) / 10_000 };
}

/** Deterministic workflow candidate discovery from segmented episodes. */
export function discoverCandidates(episodes: readonly Episode[], options: DiscoverOptions): WorkflowCandidate[] {
  const minEpisodes = options.minEpisodes ?? DISCOVER_DEFAULTS.minEpisodes;
  const minMeaningful = options.minMeaningfulActions ?? DISCOVER_DEFAULTS.minMeaningfulActions;
  const threshold = options.similarityThreshold ?? DISCOVER_DEFAULTS.similarityThreshold;
  const minMedianDuration = options.minMedianDurationMs ?? DISCOVER_DEFAULTS.minMedianDurationMs;
  const existing = options.existingPatternKeys ?? new Set<string>();
  const pool = [...episodes].filter((episode) => eligible(episode, minMeaningful)).sort((a, b) => a.startTs - b.startTs);
  if (pool.length < minEpisodes) return [];
  const clusters = clusterBySimilarity(similarityMatrix(pool), threshold);
  const candidates: WorkflowCandidate[] = [];
  for (const cluster of clusters) {
    if (cluster.length < minEpisodes) continue;
    const members = cluster.map((index) => pool[index]!);
    if (median(members.map((episode) => episode.activeDurationMs)) < minMedianDuration) continue;
    const candidate = buildCandidate(members, options, clusterMetrics(members));
    if (existing.has(candidate.patternKey)) continue;
    candidates.push(candidate);
  }
  return candidates.sort((a, b) => b.confidence - a.confidence || a.patternKey.localeCompare(b.patternKey));
}
