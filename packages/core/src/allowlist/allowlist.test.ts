import { describe, expect, it } from "vitest";
import { classifyContext, isAppAllowed, isDomainAllowed } from "./index.js";

const apps = [{ bundleId: "com.google.Chrome", name: "Google Chrome" }, "notion.id"];
const domains = ["crm.example", "mail.example"];

describe("isAppAllowed", () => {
  it("matches allowlisted bundle ids case-insensitively", () => {
    expect(isAppAllowed("com.google.chrome", apps)).toBe(true);
    expect(isAppAllowed("notion.id", apps)).toBe(true);
    expect(isAppAllowed("com.apple.Safari", apps)).toBe(false);
    expect(isAppAllowed("", apps)).toBe(false);
  });

  it("deny patterns always win", () => {
    expect(isAppAllowed("com.1password.1password", [{ bundleId: "com.1password.1password", name: "1Password" }])).toBe(false);
    expect(isAppAllowed("com.apple.SystemSettings", ["com.apple.SystemSettings"])).toBe(false);
    expect(isAppAllowed("com.example.app", ["com.example.app"], ["com.example"])).toBe(false);
  });
});

describe("isDomainAllowed", () => {
  it("allows exact and subdomain matches only", () => {
    expect(isDomainAllowed("crm.example", domains)).toBe(true);
    expect(isDomainAllowed("app.crm.example", domains)).toBe(true);
    expect(isDomainAllowed("CRM.EXAMPLE", domains)).toBe(true);
    expect(isDomainAllowed("notcrm.example", domains)).toBe(false);
    expect(isDomainAllowed("crm.example.evil", domains)).toBe(false);
    expect(isDomainAllowed("", domains)).toBe(false);
  });

  it("denies banking, password managers and auth domains even when allowlisted", () => {
    expect(isDomainAllowed("chase.com", ["chase.com"])).toBe(false);
    expect(isDomainAllowed("secure.bankofamerica.com", ["bankofamerica.com"])).toBe(false);
    expect(isDomainAllowed("my.1password.com", ["1password.com"])).toBe(false);
    expect(isDomainAllowed("accounts.google.com", ["google.com"])).toBe(false);
    expect(isDomainAllowed("app.mychart.com", ["mychart.com"])).toBe(false);
    expect(isDomainAllowed("crm.example", domains, ["crm"])).toBe(false);
  });
});

describe("classifyContext", () => {
  const allowlist = { apps, domains };

  it("excludes whenever learning is not active", () => {
    for (const learningState of ["paused", "private", "stopped"] as const) {
      expect(classifyContext({ bundleId: "com.google.Chrome", domain: "crm.example", learningState, allowlist })).toBe("excluded");
    }
  });

  it("marks private windows and secure input as sensitive", () => {
    expect(classifyContext({ bundleId: "com.google.Chrome", domain: "crm.example", isPrivateWindow: true, learningState: "learning", allowlist })).toBe("sensitive");
    expect(classifyContext({ bundleId: "notion.id", isSecureInput: true, learningState: "learning", allowlist })).toBe("sensitive");
  });

  it("marks denied apps and domains as sensitive", () => {
    expect(classifyContext({ bundleId: "com.1password.1password", learningState: "learning", allowlist })).toBe("sensitive");
    expect(classifyContext({ bundleId: "com.google.Chrome", domain: "paypal.com", learningState: "learning", allowlist })).toBe("sensitive");
  });

  it("allows allowlisted contexts and reports gaps otherwise", () => {
    expect(classifyContext({ bundleId: "com.google.Chrome", domain: "app.crm.example", learningState: "learning", allowlist })).toBe("allowed");
    expect(classifyContext({ bundleId: "notion.id", learningState: "learning", allowlist })).toBe("allowed");
    expect(classifyContext({ bundleId: "com.google.Chrome", domain: "news.example", learningState: "learning", allowlist })).toBe("privacy_gap");
    expect(classifyContext({ bundleId: "com.apple.Safari", learningState: "learning", allowlist })).toBe("privacy_gap");
    expect(classifyContext({ learningState: "learning", allowlist })).toBe("privacy_gap");
  });
});
