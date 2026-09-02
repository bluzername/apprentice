import { describe, expect, it } from "vitest";
import {
  clampRange,
  fractionToTs,
  includedItems,
  keyboardStepMs,
  moveHandle,
  nearestItemTs,
  pointerToTs,
  setHandle,
  tsToFraction
} from "./range-math";

const bounds = { startTs: 1_000_000, endTs: 1_900_000 };

describe("fractions", () => {
  it("maps timestamps to fractions and back", () => {
    expect(tsToFraction(1_000_000, bounds)).toBe(0);
    expect(tsToFraction(1_450_000, bounds)).toBeCloseTo(0.5);
    expect(tsToFraction(5_000_000, bounds)).toBe(1);
    expect(fractionToTs(0.5, bounds)).toBe(1_450_000);
    expect(fractionToTs(2, bounds)).toBe(bounds.endTs);
  });
  it("handles a zero-width span without dividing by zero", () => {
    expect(tsToFraction(5, { startTs: 5, endTs: 5 })).toBe(0);
  });
});

describe("clampRange", () => {
  it("keeps the range inside bounds", () => {
    expect(clampRange({ startTs: 0, endTs: 9_999_999 }, bounds)).toEqual(bounds);
  });
  it("enforces a minimum span", () => {
    const r = clampRange({ startTs: 1_500_000, endTs: 1_500_100 }, bounds, 10_000);
    expect(r.endTs - r.startTs).toBe(10_000);
  });
  it("shrinks the minimum span when bounds are tiny", () => {
    const tiny = { startTs: 0, endTs: 2_000 };
    expect(clampRange({ startTs: 0, endTs: 100 }, tiny, 10_000)).toEqual(tiny);
  });
});

describe("handles", () => {
  const range = { startTs: 1_200_000, endTs: 1_600_000 };
  it("moves the start handle without crossing the end", () => {
    const moved = moveHandle(range, "start", 500_000, bounds, 10_000);
    expect(moved.startTs).toBe(1_590_000);
    expect(moved.endTs).toBe(1_600_000);
  });
  it("moves the end handle within bounds", () => {
    const moved = moveHandle(range, "end", 900_000, bounds, 10_000);
    expect(moved).toEqual({ startTs: 1_200_000, endTs: 1_900_000 });
  });
  it("sets a handle to an absolute time", () => {
    expect(setHandle(range, "start", 1_100_000, bounds).startTs).toBe(1_100_000);
    expect(setHandle(range, "end", 1_000_001, bounds, 10_000).endTs).toBe(1_210_000);
  });
  it("computes keyboard steps with a one second floor", () => {
    expect(keyboardStepMs(bounds)).toBe(9_000);
    expect(keyboardStepMs(bounds, true)).toBe(90_000);
    expect(keyboardStepMs({ startTs: 0, endTs: 100 })).toBe(1_000);
  });
});

describe("items", () => {
  const items = [
    { id: "a", ts: 1_100_000 },
    { id: "b", ts: 1_300_000 },
    { id: "c", ts: 1_800_000 }
  ];
  it("filters items by range and exclusions", () => {
    const included = includedItems(items, { startTs: 1_200_000, endTs: 1_850_000 }, ["c"]);
    expect(included.map((i) => i.id)).toEqual(["b"]);
    expect(includedItems(items, bounds, new Set(["a"])).length).toBe(2);
  });
  it("finds the nearest item", () => {
    expect(nearestItemTs(items, 1_290_000)).toBe(1_300_000);
    expect(nearestItemTs([], 5)).toBeNull();
  });
  it("converts pointer positions to timestamps", () => {
    expect(pointerToTs(150, 100, 100, bounds)).toBe(1_450_000);
    expect(pointerToTs(50, 100, 0, bounds)).toBe(bounds.startTs);
  });
});
