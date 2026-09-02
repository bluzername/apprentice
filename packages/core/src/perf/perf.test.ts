import { describe, expect, it } from "vitest";
import { MetricsRecorder } from "./index.js";

describe("MetricsRecorder", () => {
  it("computes count, percentiles, max and last", () => {
    const recorder = new MetricsRecorder();
    for (let value = 1; value <= 100; value += 1) recorder.record("capture", value);
    const snapshot = recorder.snapshot();
    expect(snapshot["capture"]).toEqual({ count: 100, p50: 50, p95: 95, max: 100, last: 100 });
    recorder.record("capture", 7);
    expect(recorder.snapshot()["capture"]!.last).toBe(7);
    expect(recorder.snapshot()["capture"]!.max).toBe(100);
    expect(recorder.snapshot()["missing"]).toBeUndefined();
  });

  it("handles single samples, counters and bounded memory", () => {
    const recorder = new MetricsRecorder({ maxSamples: 3 });
    recorder.record("x", 42);
    expect(recorder.snapshot()["x"]).toEqual({ count: 1, p50: 42, p95: 42, max: 42, last: 42 });
    recorder.record("x", 1);
    recorder.record("x", 2);
    recorder.record("x", 3);
    expect(recorder.snapshot()["x"]).toEqual({ count: 3, p50: 2, p95: 3, max: 3, last: 3 });
    recorder.increment("helper_restarts");
    recorder.increment("helper_restarts", 2);
    expect(recorder.counters()).toEqual({ helper_restarts: 3 });
    expect(recorder.flat()["x.p95"]).toBe(3);
    expect(recorder.flat()["counter.helper_restarts"]).toBe(3);
    expect(() => recorder.record("bad", -1)).toThrow();
    expect(() => recorder.record("bad", Number.NaN)).toThrow();
    expect(() => new MetricsRecorder({ maxSamples: 0 })).toThrow();
    recorder.reset();
    expect(recorder.snapshot()).toEqual({});
    expect(recorder.counters()).toEqual({});
  });
});
