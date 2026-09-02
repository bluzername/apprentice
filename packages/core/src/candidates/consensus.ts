import { median } from "./cluster.js";

export interface ConsensusStep {
  readonly token: string;
  readonly occurrenceRatio: number;
  readonly medianPosition: number;
}

export const DEFAULT_CONSENSUS_RATIO = 0.5;

/** Tokens present in at least `minRatio` of the sequences, ordered by median relative position. */
export function consensusSteps(sequences: ReadonlyArray<readonly string[]>, minRatio = DEFAULT_CONSENSUS_RATIO): ConsensusStep[] {
  if (sequences.length === 0) return [];
  const positions = new Map<string, number[]>();
  for (const sequence of sequences) {
    const seen = new Set<string>();
    sequence.forEach((token, index) => {
      if (seen.has(token)) return;
      seen.add(token);
      const relative = sequence.length <= 1 ? 0 : index / (sequence.length - 1);
      positions.set(token, [...(positions.get(token) ?? []), relative]);
    });
  }
  return [...positions.entries()]
    .map(([token, list]) => ({
      token,
      occurrenceRatio: Math.round((list.length / sequences.length) * 1000) / 1000,
      medianPosition: median(list)
    }))
    .filter((step) => step.occurrenceRatio >= minRatio)
    .sort((a, b) => a.medianPosition - b.medianPosition || a.token.localeCompare(b.token));
}
