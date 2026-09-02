import { describe, expect, it } from "vitest";
import { shortHash } from "./hash.js";
import { detectBrowser } from "./browser.js";

describe("shortHash", () => {
  it("is deterministic, 8 hex chars, and input-sensitive", () => {
    expect(shortHash("button|button|save")).toBe(shortHash("button|button|save"));
    expect(shortHash("a")).toMatch(/^[0-9a-f]{8}$/);
    expect(shortHash("a")).not.toBe(shortHash("b"));
    expect(shortHash("")).toBe("811c9dc5");
  });
});

describe("detectBrowser", () => {
  it("maps client hint brands to the protocol enum", () => {
    expect(detectBrowser({ brands: ["Chromium", "Google Chrome", "Not=A?Brand"], hasBraveApi: false })).toBe("chrome");
    expect(detectBrowser({ brands: ["Chromium", "Microsoft Edge"], hasBraveApi: false })).toBe("edge");
    expect(detectBrowser({ brands: ["Chromium", "Brave"], hasBraveApi: false })).toBe("brave");
    expect(detectBrowser({ brands: ["Chromium", "Google Chrome"], hasBraveApi: true })).toBe("brave");
    expect(detectBrowser({ brands: ["Chromium"], hasBraveApi: false })).toBe("chromium");
    expect(detectBrowser({ brands: [], hasBraveApi: false })).toBe("unknown");
  });
});
