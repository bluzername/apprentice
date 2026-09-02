import { describe, expect, it } from "vitest";
import { BackgroundToContentMessageSchema, InboundMessageSchema, isErrorResponse } from "./messages.js";

describe("message schemas", () => {
  it("accepts well-formed content and popup messages", () => {
    expect(InboundMessageSchema.safeParse({ type: "content:hello", domain: "example.com", path: "/" }).success).toBe(true);
    expect(InboundMessageSchema.safeParse({ type: "popup:pair", code: "123456" }).success).toBe(true);
    expect(BackgroundToContentMessageSchema.safeParse({ type: "content:dom-query", marker: "Saved" }).success).toBe(true);
  });

  it("rejects unknown types, extra keys, and bad codes", () => {
    expect(InboundMessageSchema.safeParse({ type: "content:steal", domain: "x" }).success).toBe(false);
    expect(InboundMessageSchema.safeParse({ type: "popup:pair", code: "12345" }).success).toBe(false);
    expect(InboundMessageSchema.safeParse({ type: "popup:sync", extra: true }).success).toBe(false);
    expect(InboundMessageSchema.safeParse("popup:sync").success).toBe(false);
  });

  it("rejects events carrying field values or unknown keys", () => {
    const event = { id: "1", ts: 1, type: "field_input", domain: "example.com", value: "secret" };
    expect(InboundMessageSchema.safeParse({ type: "content:event", event }).success).toBe(false);
  });

  it("recognizes error responses", () => {
    expect(isErrorResponse({ ok: false, error: "nope" })).toBe(true);
    expect(isErrorResponse({ ok: true })).toBe(false);
  });
});
