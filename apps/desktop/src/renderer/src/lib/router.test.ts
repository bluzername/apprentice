import { describe, expect, it } from "vitest";
import { buildHash, normalizeRouteInput, parseRoute } from "./router";

describe("parseRoute", () => {
  it("parses pages and ids", () => {
    expect(parseRoute("#/skills/abc")).toEqual({ page: "skills", id: "abc" });
    expect(parseRoute("#/runs")).toEqual({ page: "runs" });
    expect(parseRoute("#/Runs/")).toEqual({ page: "runs" });
  });
  it("falls back to overview", () => {
    expect(parseRoute("")).toEqual({ page: "overview" });
    expect(parseRoute("#/nowhere")).toEqual({ page: "overview" });
  });
  it("decodes ids", () => {
    expect(parseRoute("#/candidates/a%20b").id).toBe("a b");
  });
});

describe("buildHash and normalizeRouteInput", () => {
  it("builds hashes", () => {
    expect(buildHash("skills", "x y")).toBe("#/skills/x%20y");
    expect(buildHash("privacy")).toBe("#/privacy");
  });
  it("normalises navigate events", () => {
    expect(normalizeRouteInput("runs/123")).toBe("#/runs/123");
    expect(normalizeRouteInput("/teach")).toBe("#/teach");
    expect(normalizeRouteInput("#/feedback")).toBe("#/feedback");
  });
});
