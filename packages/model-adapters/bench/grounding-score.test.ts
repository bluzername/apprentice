/**
 * Pure scoring/mapping unit tests for the GUI-grounding benchmark. These run in
 * the normal unit suite: no model server, no screenshots, no macOS APIs.
 */
import { describe, expect, it } from "vitest";
import {
  GroundingManifestSchema,
  aggregate,
  formatSummaryMarkdown,
  mapPoint,
  median,
  pointInRect,
  scoreCase,
  type GroundingCase,
  type GroundingOutcome
} from "./grounding-score.js";

const CASE: GroundingCase = {
  id: "finder-1",
  app: "Finder",
  image: "finder-1.png",
  imageWidth: 1400,
  imageHeight: 960,
  instruction: 'Click the "Save shortcut" button',
  rect: { x: 100, y: 200, width: 80, height: 40 },
  role: "AXButton",
  label: "Save shortcut",
  expectedAction: "click"
};

describe("mapPoint", () => {
  it("returns the same point when the provider reported the manifest size", () => {
    expect(mapPoint({ x: 120, y: 210 }, { width: 1400, height: 960 }, { width: 1400, height: 960 })).toEqual({ x: 120, y: 210 });
  });

  it("scales a point back from a resized source screenshot", () => {
    expect(mapPoint({ x: 350, y: 240 }, { width: 700, height: 480 }, { width: 1400, height: 960 })).toEqual({ x: 700, y: 480 });
  });

  it("scales each axis independently", () => {
    expect(mapPoint({ x: 10, y: 10 }, { width: 100, height: 50 }, { width: 300, height: 100 })).toEqual({ x: 30, y: 20 });
  });

  it("rejects a non-positive source size instead of dividing by zero", () => {
    expect(() => mapPoint({ x: 1, y: 1 }, { width: 0, height: 10 }, { width: 10, height: 10 })).toThrow(RangeError);
  });
});

describe("pointInRect", () => {
  const rect = { x: 100, y: 200, width: 80, height: 40 };

  it("accepts an interior point", () => {
    expect(pointInRect({ x: 140, y: 220 }, rect)).toBe(true);
  });

  it("accepts the edges", () => {
    expect(pointInRect({ x: 100, y: 200 }, rect)).toBe(true);
    expect(pointInRect({ x: 180, y: 240 }, rect)).toBe(true);
  });

  it("rejects a point outside", () => {
    expect(pointInRect({ x: 185, y: 220 }, rect)).toBe(false);
  });

  it("accepts a near miss within the tolerance", () => {
    expect(pointInRect({ x: 185, y: 220 }, rect, 6)).toBe(true);
    expect(pointInRect({ x: 187, y: 220 }, rect, 6)).toBe(false);
  });
});

describe("scoreCase", () => {
  it("scores a click inside the rect as a hit", () => {
    const score = scoreCase(CASE, { type: "click", x: 140, y: 220, sourceWidth: 1400, sourceHeight: 960 }, 0);
    expect(score).toMatchObject({ hit: true, actionType: "click", actionTypeMatches: true, distancePx: 0 });
    expect(score.mappedPoint).toEqual({ x: 140, y: 220 });
  });

  it("maps the point back when the provider resized the screenshot", () => {
    const score = scoreCase(CASE, { type: "click", x: 70, y: 110, sourceWidth: 700, sourceHeight: 480 }, 0);
    expect(score.mappedPoint).toEqual({ x: 140, y: 220 });
    expect(score.hit).toBe(true);
  });

  it("reports the distance to the rect for a miss", () => {
    const score = scoreCase(CASE, { type: "click", x: 200, y: 220, sourceWidth: 1400, sourceHeight: 960 }, 0);
    expect(score.hit).toBe(false);
    expect(score.distancePx).toBe(20);
  });

  it("counts a double_click inside the rect as a hit but flags the action mismatch", () => {
    const score = scoreCase(CASE, { type: "double_click", x: 140, y: 220, sourceWidth: 1400, sourceHeight: 960 }, 0);
    expect(score).toMatchObject({ hit: true, actionTypeMatches: false });
  });

  it("misses when the model proposed an action without coordinates", () => {
    const score = scoreCase(CASE, { type: "type_text", sourceWidth: 1400, sourceHeight: 960 }, 0);
    expect(score).toMatchObject({ hit: false, actionType: "type_text", mappedPoint: null, distancePx: null });
  });

  it("misses when there is no proposal at all", () => {
    const score = scoreCase(CASE, null, 6);
    expect(score).toMatchObject({ hit: false, actionType: null, mappedPoint: null });
  });
});

function outcome(partial: Partial<GroundingOutcome>): GroundingOutcome {
  return {
    id: "case",
    app: "Finder",
    role: "AXButton",
    label: "Save shortcut",
    instruction: "Click it",
    expectedAction: "click",
    actionType: "click",
    actionTypeMatches: true,
    hit: true,
    parsed: true,
    point: null,
    mappedPoint: null,
    distancePx: 0,
    latencyMs: 100,
    ...partial
  };
}

describe("aggregate", () => {
  it("computes overall, per-app and per-role hit rates plus median latency", () => {
    const summary = aggregate([
      outcome({ id: "a", app: "Finder", role: "AXButton", hit: true, latencyMs: 100 }),
      outcome({ id: "b", app: "Finder", role: "AXRow", hit: false, latencyMs: 300 }),
      outcome({ id: "c", app: "TextEdit", role: "AXButton", hit: true, latencyMs: 200 })
    ]);
    expect(summary.total).toBe(3);
    expect(summary.hits).toBe(2);
    expect(summary.hitRate).toBeCloseTo(2 / 3, 10);
    expect(summary.medianLatencyMs).toBe(200);
    expect(summary.byApp).toEqual([
      { key: "Finder", total: 2, hits: 1, hitRate: 0.5 },
      { key: "TextEdit", total: 1, hits: 1, hitRate: 1 }
    ]);
    expect(summary.byRole).toEqual([
      { key: "AXButton", total: 2, hits: 2, hitRate: 1 },
      { key: "AXRow", total: 1, hits: 0, hitRate: 0 }
    ]);
  });

  it("counts parse failures and action mismatches", () => {
    const summary = aggregate([
      outcome({ id: "a", parsed: false, hit: false, actionType: null, actionTypeMatches: false }),
      outcome({ id: "b", parsed: true, hit: true })
    ]);
    expect(summary.parseFailures).toBe(1);
    expect(summary.actionTypeMatches).toBe(1);
    expect(summary.actionCounts).toEqual([{ key: "click", total: 1 }]);
  });

  it("is empty-safe", () => {
    const summary = aggregate([]);
    expect(summary).toMatchObject({ total: 0, hits: 0, hitRate: 0, medianLatencyMs: 0, parseFailures: 0 });
  });
});

describe("median", () => {
  it("averages the two middle values for an even count", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("returns the middle value for an odd count", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("returns 0 for no values", () => {
    expect(median([])).toBe(0);
  });
});

describe("formatSummaryMarkdown", () => {
  it("renders overall, per-app and per-role tables", () => {
    const text = formatSummaryMarkdown(
      aggregate([
        outcome({ id: "a", app: "Finder", role: "AXButton", hit: true }),
        outcome({ id: "b", app: "Notes", role: "AXRow", hit: false })
      ])
    );
    expect(text).toContain("| Scope | Cases | Hits | Hit rate |");
    expect(text).toContain("| Finder |");
    expect(text).toContain("| AXRow |");
    expect(text).toContain("50.0%");
  });
});

describe("GroundingManifestSchema", () => {
  it("parses a manifest and defaults the expected action to click", () => {
    const parsed = GroundingManifestSchema.parse({
      cases: [{ ...CASE, expectedAction: undefined }]
    });
    expect(parsed.cases[0]?.expectedAction).toBe("click");
  });

  it("rejects a rect with a zero width", () => {
    const bad = { cases: [{ ...CASE, rect: { x: 0, y: 0, width: 0, height: 10 } }] };
    expect(GroundingManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a manifest with no cases", () => {
    expect(GroundingManifestSchema.safeParse({ cases: [] }).success).toBe(false);
  });
});
