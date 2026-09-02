import { describe, expect, it } from "vitest";
import { makeEpisode } from "../testing/fixtures.js";
import { episodeSimilarity, similarityMatrix } from "./episode.js";
import { appTransitionSimilarity, durationConsistency, normalizedEditDistance, tokenWeight, triggerConsistency, weightedLcs } from "./metrics.js";

const A = "app:chrome|domain:crm.example|action:click|name:contacts";
const B = "app:chrome|domain:crm.example|route:/contact/:id|action:navigate";
const C = "app:chrome|domain:crm.example|action:click|name:log-activity";
const D = "app:chrome|domain:crm.example|action:form-submit|purpose:update";
const X = "app:notion|action:shortcut|keys:cmd+shift+p";
const Y = "app:notion|action:click|name:new-page";
const Z = "app:notion|action:paste";

describe("tokenWeight", () => {
  it("weights outcomes highest and scrolling lowest", () => {
    expect(tokenWeight(D)).toBe(3);
    expect(tokenWeight("app:x|action:download")).toBe(3);
    expect(tokenWeight("app:x|action:click|name:send-message")).toBe(3);
    expect(tokenWeight(B)).toBe(1.5);
    expect(tokenWeight(X)).toBe(1.2);
    expect(tokenWeight(A)).toBe(1);
    expect(tokenWeight(Z)).toBe(0.8);
    expect(tokenWeight("app:x|action:scroll")).toBe(0.2);
  });
});

describe("sequence metrics", () => {
  it("weightedLcs is 1 for identical, 0 for disjoint, partial for reordering", () => {
    expect(weightedLcs([A, B, C, D], [A, B, C, D])).toBe(1);
    expect(weightedLcs([A, B, C, D], [X, Y, Z])).toBe(0);
    const reordered = weightedLcs([A, B, C, D], [B, A, C, D]);
    expect(reordered).toBeGreaterThan(0.6);
    expect(reordered).toBeLessThan(1);
    expect(weightedLcs([], [A])).toBe(0);
    expect(weightedLcs([A, B], [A, B, C, D])).toBeLessThan(0.5);
  });

  it("normalizedEditDistance behaves as a metric in [0, 1]", () => {
    expect(normalizedEditDistance([A, B, C], [A, B, C])).toBe(0);
    expect(normalizedEditDistance([A, B, C], [X, Y, Z])).toBe(1);
    expect(normalizedEditDistance([A, B, C], [A, C])).toBeCloseTo(1 / 3, 6);
    expect(normalizedEditDistance([], [])).toBe(0);
    expect(normalizedEditDistance([A], [])).toBe(1);
  });

  it("appTransitionSimilarity compares context switches", () => {
    expect(appTransitionSimilarity([X, A, B], [Y, C, D])).toBe(1);
    expect(appTransitionSimilarity([A, B], [X, Y])).toBe(0);
    expect(appTransitionSimilarity([A, B], [C, D])).toBe(1);
    expect(appTransitionSimilarity([X, A, X], [X, A])).toBe(0.5);
  });

  it("trigger and duration consistency", () => {
    expect(triggerConsistency(["a", "a", "a"])).toBe(1);
    expect(triggerConsistency(["a", "b", "a", "c"])).toBe(0.5);
    expect(triggerConsistency([undefined, undefined])).toBe(0);
    expect(durationConsistency([100, 100, 100])).toBe(1);
    expect(durationConsistency([120_000])).toBe(1);
    expect(durationConsistency([10, 1000])).toBeLessThan(0.2);
    expect(durationConsistency([])).toBe(0);
  });
});

describe("episodeSimilarity", () => {
  const first = makeEpisode({ id: "e1", actionTokens: [A, B, C, D], triggerHypothesis: "t", outcomeHypothesis: "o" });
  const same = makeEpisode({ id: "e2", actionTokens: [A, B, C, D], triggerHypothesis: "t", outcomeHypothesis: "o", startTs: 1_000_000, endTs: 1_120_000 });
  const other = makeEpisode({ id: "e3", actionTokens: [X, Y, Z], apps: ["notion"], triggerHypothesis: "x", outcomeHypothesis: "y", activeDurationMs: 30_000 });

  it("is 1 for identical episodes and near 0 for disjoint ones", () => {
    const identical = episodeSimilarity(first, same);
    expect(identical.meanPairwise).toBe(1);
    expect(identical.minPairwise).toBe(1);
    expect(identical.weightedLcs).toBe(1);
    expect(identical.editSimilarity).toBe(1);
    expect(identical.appTransitionSimilarity).toBe(1);
    expect(identical.durationConsistency).toBe(1);
    const disjoint = episodeSimilarity(first, other);
    expect(disjoint.meanPairwise).toBeLessThan(0.1);
    expect(disjoint.minPairwise).toBe(0);
    expect(disjoint.weightedLcs).toBe(0);
    expect(disjoint.editSimilarity).toBe(0);
  });

  it("is symmetric and builds a matrix with a unit diagonal", () => {
    const ab = episodeSimilarity(first, other).meanPairwise;
    const ba = episodeSimilarity(other, first).meanPairwise;
    expect(ab).toBe(ba);
    const matrix = similarityMatrix([first, same, other]);
    expect(matrix[0]![0]).toBe(1);
    expect(matrix[0]![1]).toBe(1);
    expect(matrix[1]![2]).toBe(matrix[2]![1]);
    expect(matrix).toHaveLength(3);
  });
});
