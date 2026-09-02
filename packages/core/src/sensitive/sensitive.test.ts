import { describe, expect, it } from "vitest";
import { makeEvent } from "../testing/fixtures.js";
import { detectSensitiveContext, episodeHasSensitiveEvents } from "./index.js";

describe("detectSensitiveContext", () => {
  it("detects credential and payment terms in OCR", () => {
    expect(detectSensitiveContext({ ocrText: "Enter your Password to continue" })).toEqual({ sensitive: true, reasons: ["ocr:password"] });
    expect(detectSensitiveContext({ ocrText: "Your verification code is 123456" }).reasons).toContain("ocr:verification_code");
    expect(detectSensitiveContext({ ocrText: "Card number  CVV  Expiry date" }).reasons).toContain("ocr:payment_details");
    expect(detectSensitiveContext({ ocrText: "Routing number and account number" }).sensitive).toBe(true);
    expect(detectSensitiveContext({ ocrText: "Social Security Number" }).reasons).toContain("ocr:identity_number");
    expect(detectSensitiveContext({ ocrText: "Enable two-factor authentication" }).sensitive).toBe(true);
  });

  it("detects system authentication dialogs and private browsing", () => {
    expect(detectSensitiveContext({ ocrText: "Installer wants to make changes." }).reasons).toContain("ocr:system_authentication");
    expect(detectSensitiveContext({ windowTitle: "Touch ID" }).reasons).toContain("title:system_authentication");
    expect(detectSensitiveContext({ windowTitle: "New Incognito Window" }).reasons).toContain("title:private_browsing");
    expect(detectSensitiveContext({ windowTitle: "Sign in - Google Accounts" }).reasons).toContain("title:sign_in");
  });

  it("only trusts sign-in wording in window titles", () => {
    expect(detectSensitiveContext({ ocrText: "Sign in to see more" }).sensitive).toBe(false);
  });

  it("uses secure fields, roles, denied apps and domains", () => {
    expect(detectSensitiveContext({ secureFieldFocused: true }).reasons).toEqual(["secure_field_focused"]);
    expect(detectSensitiveContext({ axRole: "AXSecureTextField" }).reasons).toEqual(["secure_field_role"]);
    expect(detectSensitiveContext({ bundleId: "com.agilebits.onepassword7" }).reasons).toEqual(["denied_app"]);
    expect(detectSensitiveContext({ domain: "www.chase.com" }).reasons).toEqual(["denied_domain"]);
    expect(detectSensitiveContext({ domain: "crm.example", ocrText: "Log activity for the account manager" })).toEqual({ sensitive: false, reasons: [] });
  });

  it("flags episodes that contain sensitive events", () => {
    const clean = [makeEvent({ ts: 1, type: "click" }), makeEvent({ ts: 2, type: "navigation" })];
    expect(episodeHasSensitiveEvents(clean)).toBe(false);
    expect(episodeHasSensitiveEvents([...clean, makeEvent({ ts: 3, type: "secure_field_focused" })])).toBe(true);
    expect(episodeHasSensitiveEvents([...clean, makeEvent({ ts: 3, type: "click", privacy: "sensitive" })])).toBe(true);
    expect(episodeHasSensitiveEvents([makeEvent({ ts: 3, type: "click", payload: { sensitive: true } })])).toBe(true);
  });
});
