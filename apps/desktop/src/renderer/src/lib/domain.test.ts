import { describe, expect, it } from "vitest";
import { normalizeDomain, validateBundleId, validateDomain } from "./domain";

describe("normalizeDomain", () => {
  it("strips scheme, www, path, port and credentials", () => {
    expect(normalizeDomain("https://www.Example.com/inbox?x=1")).toBe("example.com");
    expect(normalizeDomain("user@mail.example.com:8080")).toBe("mail.example.com");
    expect(normalizeDomain("  notion.so.  ")).toBe("notion.so");
  });
});

describe("validateDomain", () => {
  it("accepts real domains", () => {
    expect(validateDomain("app.linear.app")).toEqual({ ok: true, value: "app.linear.app" });
  });
  it("rejects empty, single-label and numeric domains", () => {
    expect(validateDomain("").ok).toBe(false);
    expect(validateDomain("localhost").ok).toBe(false);
    expect(validateDomain("10.0.0.1").ok).toBe(false);
    expect(validateDomain("bad_domain.com").ok).toBe(false);
  });
});

describe("validateBundleId", () => {
  it("accepts reverse-DNS identifiers", () => {
    expect(validateBundleId("com.apple.Safari").ok).toBe(true);
    expect(validateBundleId("notion.id").ok).toBe(true);
  });
  it("rejects malformed identifiers", () => {
    expect(validateBundleId("").ok).toBe(false);
    expect(validateBundleId("Safari").ok).toBe(false);
    expect(validateBundleId(".com.bad.").ok).toBe(false);
  });
});
