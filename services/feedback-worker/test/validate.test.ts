import { describe, expect, it } from "vitest";
import { classifyString, scanForbiddenKeys, scanValues } from "../src/validate.js";

describe("scanForbiddenKeys", () => {
  it("finds forbidden keys at any depth, case-insensitively, with array-aware paths", () => {
    const issues = scanForbiddenKeys({ ok: 1, Title: "x", deep: [{ fine: 1 }, { inner: { PROMPT: "y" } }] });
    expect(issues).toEqual([
      { path: "Title", code: "forbidden_key" },
      { path: "deep[1].inner.PROMPT", code: "forbidden_key" }
    ]);
  });

  it("exempts only events[].name", () => {
    expect(scanForbiddenKeys({ events: [{ name: "app_launched" }] })).toEqual([]);
    expect(scanForbiddenKeys({ feedback: [{ name: "x" }] })).toEqual([{ path: "feedback[0].name", code: "forbidden_key" }]);
    expect(scanForbiddenKeys({ name: "x" })).toEqual([{ path: "name", code: "forbidden_key" }]);
  });

  it("stops at excessive depth instead of recursing forever", () => {
    const deep = Array.from({ length: 30 }).reduce<unknown>((acc) => ({ a: acc }), 1);
    expect(scanForbiddenKeys(deep).some((i) => i.code === "too_deep")).toBe(true);
  });
});

describe("classifyString and scanValues", () => {
  it("classifies suspicious strings and leaves ordinary text alone", () => {
    expect(classifyString("http://a.b")).toBe("url_like");
    expect(classifyString("mailto:someone@example.com")).toBe("email_like");
    expect(classifyString("visit www.example.io")).toBe("url_like");
    expect(classifyString("docs.example.co/page")).toBe("url_like");
    expect(classifyString("first.last@corp.example")).toBe("email_like");
    expect(classifyString("x".repeat(199))).toBeNull();
    expect(classifyString(`${"b".repeat(200)}==`)).toBe("base64_blob");
    expect(classifyString("DATA:IMAGE/jpeg;base64,/9j")).toBe("image_data");
    expect(classifyString("plain sentence with numbers 1.2.3 and e.g. abbreviations")).toBeNull();
    expect(classifyString("")).toBeNull();
  });

  it("reports string values at any depth with their paths", () => {
    const issues = scanValues({ a: "fine", b: ["ok", "https://x.y"], c: { d: "me@example.com" } });
    expect(issues).toEqual([
      { path: "b[1]", code: "url_like" },
      { path: "c.d", code: "email_like" }
    ]);
  });
});
