import { describe, expect, it } from "vitest";
import { makeClick, makeEvent } from "../testing/fixtures.js";
import { normalizeAppName } from "./app-name.js";
import { normalizeLabel } from "./label.js";
import { normalizeRoute } from "./route.js";
import { eventToToken, isMeaningfulToken, normalizeKeys, parseToken } from "./token.js";

describe("normalizeRoute", () => {
  it("replaces volatile segments and strips query strings", () => {
    expect(normalizeRoute("/contact/3f9d2c1e-1b2a-4c3d-9e8f-123456789abc?tab=1#x")).toBe("/contact/:id");
    expect(normalizeRoute("/deals/123456/edit")).toBe("/deals/:id/edit");
    expect(normalizeRoute("/orders/deadbeef1234cafe")).toBe("/orders/:id");
    expect(normalizeRoute("/reports/2026-09-02")).toBe("/reports/:id");
    expect(normalizeRoute("/reports/2026-09-02T10:00:00Z/summary")).toBe("/reports/:id/summary");
    expect(normalizeRoute("/users/jane.doe@example.com/profile")).toBe("/users/:id/profile");
    expect(normalizeRoute("/Contacts/New")).toBe("/contacts/new");
    expect(normalizeRoute("")).toBe("/");
    expect(normalizeRoute("/a/b/?q=1")).toBe("/a/b");
    expect(normalizeRoute("/v2/items/42")).toBe("/v2/items/42");
  });
});

describe("normalizeAppName", () => {
  it("maps bundle ids to slugs", () => {
    expect(normalizeAppName("com.google.Chrome")).toBe("chrome");
    expect(normalizeAppName("notion.id")).toBe("notion");
    expect(normalizeAppName("com.tinyspeck.slackmacgap")).toBe("slack");
    expect(normalizeAppName("com.example.MyTool")).toBe("mytool");
    expect(normalizeAppName(undefined, "Some App!")).toBe("some-app");
    expect(normalizeAppName("", "")).toBe("unknown");
  });
});

describe("normalizeLabel", () => {
  it("lowercases, removes volatile parts and kebab-cases", () => {
    expect(normalizeLabel("Log Activity")).toBe("log-activity");
    expect(normalizeLabel("Save Draft")).toBe("save-draft");
    expect(normalizeLabel("Email jane@example.com")).toBe("email");
    expect(normalizeLabel("Order #123456")).toBe("order");
    expect(normalizeLabel("button css-1x2y3z primary")).toBe("button-primary");
    expect(normalizeLabel("sc-abc123 Send")).toBe("send");
    expect(normalizeLabel("Call John Smith")).toBe("call");
    expect(normalizeLabel("   Multiple    spaces   ")).toBe("multiple-spaces");
    expect(normalizeLabel("x".repeat(80)).length).toBeLessThanOrEqual(40);
  });
});

describe("normalizeKeys", () => {
  it("orders modifiers and lowercases", () => {
    expect(normalizeKeys(["Shift", "Command", "p"])).toBe("cmd+shift+p");
    expect(normalizeKeys("ctrl+alt+Delete")).toBe("ctrl+alt+delete");
    expect(normalizeKeys(["meta", "s"])).toBe("cmd+s");
  });
});

describe("eventToToken", () => {
  it("produces the documented token shapes", () => {
    const click = makeClick({ ts: 1, domain: "crm.example", route: "/contact/8f2c9a1b-1234-4c3d-9e8f-abcdefabcdef", name: "Log activity" });
    expect(eventToToken(click)).toBe("app:chrome|domain:crm.example|route:/contact/:id|action:click|role:button|name:log-activity");
    const submit = makeEvent({
      ts: 2,
      type: "form_submit",
      source: "extension",
      app: { bundleId: "com.google.Chrome" },
      domain: "mail.example",
      routePattern: "/compose",
      payload: { formPurpose: "message" }
    });
    expect(eventToToken(submit)).toBe("app:chrome|domain:mail.example|route:/compose|action:form-submit|purpose:message");
    const shortcut = makeEvent({ ts: 3, type: "shortcut", app: { bundleId: "notion.id" }, payload: { keys: ["cmd", "shift", "p"] } });
    expect(eventToToken(shortcut)).toBe("app:notion|action:shortcut|keys:cmd+shift+p");
    const nav = makeEvent({ ts: 4, type: "navigation", source: "extension", domain: "crm.example", routePattern: "/deals?x=1" });
    expect(eventToToken(nav)).toBe("domain:crm.example|route:/deals|action:navigate");
    const download = makeEvent({ ts: 5, type: "download", source: "extension", domain: "files.example", payload: { extension: "PDF" } });
    expect(eventToToken(download)).toBe("domain:files.example|action:download|ext:pdf");
  });

  it("produces coarse view tokens for browser window titles only", () => {
    const gmail = makeEvent({ ts: 6, type: "window_title_changed", app: { bundleId: "com.google.Chrome" }, payload: { title: "Inbox (843) - user@example.com - Gmail" } });
    expect(eventToToken(gmail)).toBe("app:chrome|site:gmail|view:inbox|action:view");
    const ingested = makeEvent({ ts: 7, type: "window_title_changed", app: { bundleId: "com.apple.Safari" }, payload: { site: "google-sheets", view: "document" } });
    expect(eventToToken(ingested)).toBe("app:safari|site:google-sheets|view:document|action:view");
    const native = makeEvent({ ts: 8, type: "window_title_changed", app: { bundleId: "com.apple.mail" }, payload: { title: "Inbox - Mail" } });
    expect(eventToToken(native)).toBeNull();
    const encrypted = makeEvent({ ts: 9, type: "window_title_changed", app: { bundleId: "com.google.Chrome" } });
    expect(eventToToken(encrypted)).toBeNull();
  });

  it("returns null for non-action events", () => {
    for (const type of ["idle_changed", "clipboard_changed", "privacy_gap", "screenshot_captured", "window_title_changed", "page_title", "teach_marker", "session_start", "learning_state_changed", "secure_field_focused"] as const) {
      expect(eventToToken(makeEvent({ ts: 1, type }))).toBeNull();
    }
  });

  it("parses tokens back into parts", () => {
    const parts = parseToken("app:chrome|domain:crm.example|route:/contact/:id|action:click|name:log-activity");
    expect(parts["app"]).toBe("chrome");
    expect(parts["route"]).toBe("/contact/:id");
    expect(parts["name"]).toBe("log-activity");
  });

  it("classifies meaningful tokens", () => {
    expect(isMeaningfulToken("app:chrome|action:click")).toBe(true);
    expect(isMeaningfulToken("app:chrome|action:form-submit|purpose:message")).toBe(true);
    expect(isMeaningfulToken("domain:x.example|action:navigate")).toBe(true);
    expect(isMeaningfulToken("app:notion|action:shortcut|keys:cmd+s")).toBe(true);
    expect(isMeaningfulToken("app:chrome|action:download")).toBe(true);
    expect(isMeaningfulToken("app:chrome|action:copy")).toBe(true);
    expect(isMeaningfulToken("app:chrome|action:paste")).toBe(true);
    expect(isMeaningfulToken("app:chrome|site:gmail|view:inbox|action:view")).toBe(true);
    expect(isMeaningfulToken("app:chrome|site:web|view:page|action:view")).toBe(true);
    expect(isMeaningfulToken("app:chrome|action:scroll")).toBe(false);
    expect(isMeaningfulToken("app:chrome|action:move")).toBe(false);
    expect(isMeaningfulToken("app:chrome|action:activate")).toBe(false);
    expect(isMeaningfulToken("garbage")).toBe(false);
  });
});
