import { describe, expect, it } from "vitest";
import { isSensitiveField, isSensitivePage, sensitiveFieldReason, sensitivePageReason } from "./sensitive.js";

describe("isSensitiveField", () => {
  it("flags password inputs", () => {
    expect(isSensitiveField({ tagName: "INPUT", type: "password", autocomplete: null })).toBe(true);
    expect(isSensitiveField({ tagName: "input", type: "Password", autocomplete: null })).toBe(true);
  });

  it("flags payment-card and one-time-code autocomplete tokens", () => {
    expect(isSensitiveField({ tagName: "INPUT", type: "text", autocomplete: "cc-number" })).toBe(true);
    expect(isSensitiveField({ tagName: "INPUT", type: "text", autocomplete: "section-pay cc-exp" })).toBe(true);
    expect(isSensitiveField({ tagName: "INPUT", type: "text", autocomplete: "one-time-code" })).toBe(true);
    expect(isSensitiveField({ tagName: "SELECT", type: null, autocomplete: "cc-exp-month" })).toBe(true);
  });

  it("ignores ordinary fields and non-form elements", () => {
    expect(isSensitiveField({ tagName: "INPUT", type: "email", autocomplete: "email" })).toBe(false);
    expect(isSensitiveField({ tagName: "DIV", type: null, autocomplete: "cc-number" })).toBe(false);
    expect(sensitiveFieldReason({ tagName: "INPUT", type: "text", autocomplete: null })).toBeNull();
    expect(sensitiveFieldReason({ tagName: "INPUT", type: "password", autocomplete: null })).toBe("password_field");
  });
});

describe("isSensitivePage", () => {
  it("matches sensitive words in the title or path", () => {
    expect(isSensitivePage({ title: "Sign in to Acme", path: "/", hasSensitiveMeta: false })).toBe(true);
    expect(isSensitivePage({ title: "Acme", path: "/account/login", hasSensitiveMeta: false })).toBe(true);
    expect(isSensitivePage({ title: "Acme", path: "/orders/checkout", hasSensitiveMeta: false })).toBe(true);
    expect(isSensitivePage({ title: "Verify your device", path: "/", hasSensitiveMeta: false })).toBe(true);
    expect(isSensitivePage({ title: "Enter 2FA code", path: "/", hasSensitiveMeta: false })).toBe(true);
    expect(isSensitivePage({ title: "Billing", path: "/", hasSensitiveMeta: false })).toBe(true);
  });

  it("honors the apprentice-sensitive meta tag", () => {
    expect(isSensitivePage({ title: "Dashboard", path: "/", hasSensitiveMeta: true })).toBe(true);
    expect(sensitivePageReason({ title: "Dashboard", path: "/", hasSensitiveMeta: true })).toBe("sensitive_page");
  });

  it("leaves ordinary pages alone", () => {
    expect(isSensitivePage({ title: "Project board", path: "/projects/42", hasSensitiveMeta: false })).toBe(false);
    expect(sensitivePageReason({ title: "Docs", path: "/docs", hasSensitiveMeta: false })).toBeNull();
  });
});
