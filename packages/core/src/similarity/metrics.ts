import { parseToken, tokenContext } from "../normalize/token.js";

export type WeightFn = (token: string) => number;

const SEND_LIKE = /(^|-)(send|submit|publish|post|reply|share|invite)($|-)/;

/** Weight of a token for sequence similarity: outcomes count most, scrolling least. */
export function tokenWeight(token: string): number {
  const parts = parseToken(token);
  const action = parts["action"];
  const name = parts["name"] ?? "";
  if (action === "form-submit" || action === "download") return 3.0;
  if (action === "click" && SEND_LIKE.test(name)) return 3.0;
  if (action === "navigate") return 1.5;
  if (action === "shortcut") return 1.2;
  if (action === "click") return 1.0;
  if (action === "copy" || action === "paste") return 0.8;
  if (action === "view") return 0.6;
  if (action === "scroll" || action === "move") return 0.2;
  return 0.5;
}

function total(tokens: readonly string[], weightFn: WeightFn): number {
  return tokens.reduce((sum, token) => sum + weightFn(token), 0);
}

/** Weighted longest common subsequence normalized by the heavier sequence; 1 for identical. */
export function weightedLcs(a: readonly string[], b: readonly string[], weightFn: WeightFn = tokenWeight): number {
  if (a.length === 0 || b.length === 0) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Float64Array(rows * cols);
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const tokenA = a[i - 1]!;
      const tokenB = b[j - 1]!;
      const diagonal = table[(i - 1) * cols + (j - 1)]! + (tokenA === tokenB ? weightFn(tokenA) : 0);
      const up = table[(i - 1) * cols + j]!;
      const left = table[i * cols + (j - 1)]!;
      table[i * cols + j] = Math.max(tokenA === tokenB ? diagonal : 0, up, left);
    }
  }
  const lcs = table[a.length * cols + b.length]!;
  const denominator = Math.max(total(a, weightFn), total(b, weightFn));
  return denominator === 0 ? 0 : Math.min(1, lcs / denominator);
}

/** Levenshtein distance divided by the longer length (0 identical, 1 disjoint). */
export function normalizedEditDistance(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0 || b.length === 0) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost));
    }
    previous = current;
  }
  return previous[b.length]! / Math.max(a.length, b.length);
}

export function transitions(tokens: readonly string[]): string[] {
  const contexts = tokens.map((token) => tokenContext(token) ?? "unknown");
  const result: string[] = [];
  for (let index = 1; index < contexts.length; index += 1) {
    if (contexts[index] !== contexts[index - 1]) result.push(`${contexts[index - 1]}>${contexts[index]}`);
  }
  return result;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Jaccard over consecutive app/domain transitions; falls back to context sets when nobody switches. */
export function appTransitionSimilarity(a: readonly string[], b: readonly string[]): number {
  const transitionsA = new Set(transitions(a));
  const transitionsB = new Set(transitions(b));
  if (transitionsA.size === 0 && transitionsB.size === 0) {
    const contextsA = new Set(a.map((token) => tokenContext(token) ?? "unknown"));
    const contextsB = new Set(b.map((token) => tokenContext(token) ?? "unknown"));
    return jaccard(contextsA, contextsB);
  }
  return jaccard(transitionsA, transitionsB);
}

/** Share of the most common value; 1 when all agree, 0 when nothing is known. */
export function agreement(values: ReadonlyArray<string | undefined>): number {
  const known = values.filter((value): value is string => value !== undefined && value.length > 0);
  if (known.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const value of known) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Math.max(...counts.values()) / values.length;
}

export const triggerConsistency = agreement;
export const outcomeConsistency = agreement;

/** 1 minus the coefficient of variation, clamped to [0, 1]. A single value is fully consistent. */
export function durationConsistency(durations: readonly number[]): number {
  const valid = durations.filter((value) => Number.isFinite(value) && value >= 0);
  if (valid.length === 0) return 0;
  if (valid.length === 1) return 1;
  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  if (mean === 0) return 1;
  const variance = valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(0, Math.min(1, 1 - cv));
}
