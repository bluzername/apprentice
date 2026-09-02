import { describe, expect, it } from "vitest";
import type { ImageTransform } from "@apprentice/schemas";
import { clampPointToRect, distanceToRect, geometryMatches, isStaleScreen, mapDisplayToImage, mapImageToDisplay } from "./index.js";

const transform: ImageTransform = {
  originalWidth: 2880,
  originalHeight: 1800,
  resizedWidth: 1280,
  resizedHeight: 800,
  displayScale: 2,
  originX: 100,
  originY: 50,
  displayId: "main"
};

describe("coordinate transforms", () => {
  it("maps image pixels to display points and back", () => {
    const display = mapImageToDisplay({ x: 640, y: 400 }, transform);
    expect(display).toEqual({ x: 100 + 720, y: 50 + 450 });
    const image = mapDisplayToImage(display, transform);
    expect(image.x).toBeCloseTo(640, 6);
    expect(image.y).toBeCloseTo(400, 6);
    expect(mapImageToDisplay({ x: 0, y: 0 }, transform)).toEqual({ x: 100, y: 50 });
    expect(mapImageToDisplay({ x: 1280, y: 800 }, transform)).toEqual({ x: 100 + 1440, y: 50 + 900 });
  });

  it("rejects invalid transforms", () => {
    expect(() => mapImageToDisplay({ x: 1, y: 1 }, { ...transform, resizedWidth: 0 })).toThrow();
    expect(() => mapDisplayToImage({ x: 1, y: 1 }, { ...transform, displayScale: 0 })).toThrow();
  });
});

describe("geometryMatches", () => {
  const a = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, displayScale: 2, displayId: "main" };
  it("tolerates small drift only", () => {
    expect(geometryMatches(a, { ...a, bounds: { x: 5, y: 3, width: 1440, height: 900 } })).toBe(true);
    expect(geometryMatches(a, { ...a, bounds: { x: 20, y: 0, width: 1440, height: 900 } })).toBe(false);
    expect(geometryMatches(a, { ...a, bounds: { x: 20, y: 0, width: 1440, height: 900 } }, 30)).toBe(true);
    expect(geometryMatches(a, { ...a, displayScale: 1 })).toBe(false);
    expect(geometryMatches(a, { ...a, displayId: "external" })).toBe(false);
    expect(geometryMatches(a, { bounds: a.bounds, displayScale: 2 })).toBe(true);
  });
});

describe("isStaleScreen", () => {
  it("rejects old screenshots and changed content", () => {
    expect(isStaleScreen({ capturedAt: 0, now: 1000 })).toEqual({ stale: false, reasons: [] });
    const old = isStaleScreen({ capturedAt: 0, now: 6000 });
    expect(old.stale).toBe(true);
    expect(old.reasons[0]).toMatch(/age_exceeded/);
    const changed = isStaleScreen({ capturedAt: 0, now: 100, beforeHash: "0000000000000000", afterHash: "ffffffffffffffff" });
    expect(changed.stale).toBe(true);
    expect(changed.reasons[0]).toMatch(/content_changed:hamming=64/);
    expect(isStaleScreen({ capturedAt: 0, now: 100, beforeHash: "0000000000000000", afterHash: "0000000000000007" }).stale).toBe(false);
    expect(isStaleScreen({ capturedAt: 0, now: 100, beforeHash: "0000000000000000", afterHash: "0000000000000007", maxHamming: 2 }).stale).toBe(true);
    expect(isStaleScreen({ capturedAt: 500, now: 100 }).reasons).toContain("captured_in_future");
  });
});

describe("rect helpers", () => {
  it("clamps and measures distance", () => {
    const rect = { x: 10, y: 10, width: 100, height: 50 };
    expect(clampPointToRect({ x: -5, y: 500 }, rect)).toEqual({ x: 10, y: 60 });
    expect(clampPointToRect({ x: 50, y: 20 }, rect)).toEqual({ x: 50, y: 20 });
    expect(distanceToRect({ x: 50, y: 20 }, rect)).toBe(0);
    expect(distanceToRect({ x: 110, y: 90 }, rect)).toBe(30);
    expect(distanceToRect({ x: 113, y: 64 }, rect)).toBe(5);
  });
});
