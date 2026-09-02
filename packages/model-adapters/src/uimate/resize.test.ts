import { describe, expect, it } from "vitest";
import { processImageDims, smartResize } from "./resize.js";
import { pyRoundHalfEven } from "./python-compat.js";
import { readGoldenJson } from "../testing/golden.js";

interface ResizeCase {
  readonly width: number;
  readonly height: number;
  readonly default: readonly [number, number];
  readonly process: readonly [number, number];
}

describe("smartResize / processImageDims (parity with smart_resize)", () => {
  it("matches the Python values for every golden size", () => {
    const cases = readGoldenJson<readonly ResizeCase[]>("smart_resize.json");
    expect(cases.length).toBeGreaterThanOrEqual(6);
    for (const c of cases) {
      expect([...smartResize(c.height, c.width)], `${c.width}x${c.height} default`).toEqual([...c.default]);
      const dims = processImageDims(c.width, c.height);
      expect([dims.height, dims.width], `${c.width}x${c.height} process`).toEqual([...c.process]);
    }
  });

  it("returns the expected dimensions for the documented inputs", () => {
    expect(processImageDims(1920, 1080)).toEqual({ width: 1920, height: 1088 });
    expect(processImageDims(2560, 1600)).toEqual({ width: 2560, height: 1600 });
    expect(processImageDims(1440, 900)).toEqual({ width: 1440, height: 896 });
    expect(processImageDims(3456, 2234)).toEqual({ width: 3456, height: 2240 });
    expect(processImageDims(800, 600)).toEqual({ width: 800, height: 608 });
    expect(processImageDims(100, 50)).toEqual({ width: 96, height: 64 });
  });

  it("raises on the same inputs Python raises on", () => {
    expect(() => smartResize(1, 100)).toThrow(RangeError);
    expect(() => smartResize(10, 3000)).toThrow(/aspect ratio/);
  });

  it("rounds half to even like Python round()", () => {
    expect(pyRoundHalfEven(0.5)).toBe(0);
    expect(pyRoundHalfEven(1.5)).toBe(2);
    expect(pyRoundHalfEven(2.5)).toBe(2);
    expect(pyRoundHalfEven(33.75)).toBe(34);
    expect(pyRoundHalfEven(28.125)).toBe(28);
  });
});
