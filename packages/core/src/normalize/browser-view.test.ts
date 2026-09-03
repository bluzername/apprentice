import { describe, expect, it } from "vitest";
import { makeEvent } from "../testing/fixtures.js";
import { browserViewFromEvent, browserViewFromTitle, isBrowserBundleId } from "./browser-view.js";

const CHROME = "com.google.Chrome";
const SAFARI = "com.apple.Safari";

describe("browserViewFromTitle", () => {
  it("classifies Gmail folders, search, and messages without leaking subjects or addresses", () => {
    expect(browserViewFromTitle("Inbox (843) - user@example.com - Gmail", CHROME)).toEqual({ site: "gmail", view: "inbox", sensitive: false });
    expect(browserViewFromTitle("Search results - user@example.com - Gmail", CHROME)).toEqual({ site: "gmail", view: "search", sensitive: false });
    const message = browserViewFromTitle("Re: Q3 budget for Jordan Rivera 4471 - jordan.rivera@example.com - Gmail", CHROME);
    expect(message).toEqual({ site: "gmail", view: "page", sensitive: false });
    expect(JSON.stringify(message)).not.toMatch(/jordan|rivera|budget|4471|@/i);
    expect(browserViewFromTitle("Starred - user@example.com - Gmail", CHROME)?.view).toBe("starred");
    expect(browserViewFromTitle("Sent Mail - user@example.com - Gmail", CHROME)?.view).toBe("sent");
    expect(browserViewFromTitle("Drafts (2) - user@example.com - Gmail", CHROME)?.view).toBe("drafts");
    expect(browserViewFromTitle("New Message - user@example.com - Gmail", CHROME)?.view).toBe("compose");
    expect(browserViewFromTitle("Settings - user@example.com - Gmail", CHROME)?.view).toBe("settings");
  });

  it("classifies Sheets, Docs, and Notion pages as documents and GitHub PRs as pages", () => {
    expect(browserViewFromTitle("Pipeline Q3 - Google Sheets", CHROME)).toEqual({ site: "google-sheets", view: "document", sensitive: false });
    expect(browserViewFromTitle("Offer letter Jordan Rivera - Google Docs", CHROME)).toEqual({ site: "google-docs", view: "document", sensitive: false });
    expect(browserViewFromTitle("Roadmap 2027 - Notion", "com.brave.Browser")).toEqual({ site: "notion", view: "document", sensitive: false });
    expect(browserViewFromTitle("Fix flaky test by jr · Pull Request #1234 · acme/app · GitHub", "company.thebrowser.Browser")).toEqual({ site: "github", view: "page", sensitive: false });
    expect(browserViewFromTitle("Project board | Linear", "com.microsoft.edgemac")).toEqual({ site: "linear", view: "page", sensitive: false });
  });

  it("marks login and checkout views sensitive", () => {
    expect(browserViewFromTitle("Sign in - Google Accounts", CHROME)).toEqual({ site: "google-accounts", view: "login", sensitive: true });
    expect(browserViewFromTitle("Log in to Notion - Notion", CHROME)).toEqual({ site: "notion", view: "login", sensitive: true });
    expect(browserViewFromTitle("Checkout - Shopify", CHROME)).toEqual({ site: "shopify", view: "checkout", sensitive: true });
    expect(browserViewFromTitle("Checkout - Acme Store", CHROME)).toEqual({ site: "web", view: "checkout", sensitive: true });
  });

  it("handles Safari titles where the site is the only segment", () => {
    expect(browserViewFromTitle("GitHub", SAFARI)).toEqual({ site: "github", view: "page", sensitive: false });
    expect(browserViewFromTitle("Inbox (12)", SAFARI)).toEqual({ site: "web", view: "inbox", sensitive: false });
    expect(browserViewFromTitle("Quarterly plan Jordan Rivera", SAFARI)).toEqual({ site: "web", view: "page", sensitive: false });
  });

  it("never turns a person name, an email, or a long title into a site", () => {
    expect(browserViewFromTitle("Notes - Jordan Rivera", CHROME)?.site).toBe("web");
    expect(browserViewFromTitle("Inbox - user@example.com", CHROME)).toEqual({ site: "web", view: "inbox", sensitive: false });
    expect(browserViewFromTitle("Report - Some very long site name with many words", CHROME)?.site).toBe("web");
    expect(browserViewFromTitle("Inbox - Gmail - Google Chrome", CHROME)?.site).toBe("gmail");
  });

  it("returns null for native apps and empty titles", () => {
    expect(browserViewFromTitle("Inbox - Mail", "com.apple.mail")).toBeNull();
    expect(browserViewFromTitle("   ", CHROME)).toBeNull();
    expect(isBrowserBundleId("com.google.Chrome")).toBe(true);
    expect(isBrowserBundleId("notion.id")).toBe(false);
    expect(isBrowserBundleId(undefined)).toBe(false);
  });
});

describe("browserViewFromEvent", () => {
  it("prefers the coarse payload written at ingestion and falls back to a plain title", () => {
    const stored = makeEvent({ ts: 1, type: "window_title_changed", app: { bundleId: CHROME }, payload: { site: "gmail", view: "inbox" } });
    expect(browserViewFromEvent(stored)).toEqual({ site: "gmail", view: "inbox", sensitive: false });
    const plain = makeEvent({ ts: 2, type: "window_title_changed", app: { bundleId: CHROME }, payload: { title: "Pipeline - Google Sheets" } });
    expect(browserViewFromEvent(plain)?.view).toBe("document");
    const encrypted = makeEvent({ ts: 3, type: "window_title_changed", app: { bundleId: CHROME } });
    expect(browserViewFromEvent(encrypted)).toBeNull();
    const invalid = makeEvent({ ts: 4, type: "window_title_changed", app: { bundleId: CHROME }, payload: { site: "gmail", view: "not-a-view" } });
    expect(browserViewFromEvent(invalid)).toBeNull();
    const native = makeEvent({ ts: 5, type: "window_title_changed", app: { bundleId: "com.apple.mail" }, payload: { site: "gmail", view: "inbox" } });
    expect(browserViewFromEvent(native)).toBeNull();
  });
});
