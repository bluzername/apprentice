import { describe, expect, it } from "vitest";
import { makeClick, makeEvent, resetEventSequence } from "../testing/fixtures.js";
import { consumptionScore, isConsumptionDomain } from "./consumption.js";
import { describeBoundaries, segmentEpisodes } from "./segment.js";

const MIN = 60_000;
const session = { sessionId: "s1" };
const textEdit = { bundleId: "com.apple.TextEdit", name: "TextEdit" };
const finder = { bundleId: "com.apple.finder", name: "Finder" };
const chrome = { bundleId: "com.google.Chrome" };

describe("segmentEpisodes", () => {
  it("splits on idle gaps and keeps ordering", () => {
    const events = [
      makeClick({ ts: 0, domain: "crm.example", name: "Contacts" }),
      makeClick({ ts: 10_000, domain: "crm.example", name: "Open" }),
      makeClick({ ts: 10_000 + 5 * MIN, domain: "crm.example", name: "Contacts" }),
      makeClick({ ts: 20_000 + 5 * MIN, domain: "crm.example", name: "Open" })
    ];
    const episodes = segmentEpisodes([...events].reverse(), session);
    expect(episodes).toHaveLength(2);
    expect(episodes[0]!.eventIds).toEqual([events[0]!.id, events[1]!.id]);
    expect(episodes[1]!.boundaryReasons).toContain("idle_gap");
    expect(episodes[0]!.boundaryReasons).toContain("session_edge");
    expect(episodes[0]!.activeDurationMs).toBe(10_000);
    expect(episodes[1]!.startTs).toBe(10_000 + 5 * MIN);
    expect(episodes[0]!.id).not.toBe(episodes[1]!.id);
    expect(segmentEpisodes([...events], session)[0]!.id).toBe(episodes[0]!.id);
  });

  it("collapses consecutive identical browser view tokens into one", () => {
    const chrome = { bundleId: "com.google.Chrome" };
    const events = [
      makeEvent({ ts: 0, type: "window_title_changed", app: chrome, payload: { site: "gmail", view: "inbox" } }),
      makeEvent({ ts: 1000, type: "window_title_changed", app: chrome, payload: { site: "gmail", view: "inbox" } }),
      makeEvent({ ts: 2000, type: "window_title_changed", app: chrome, payload: { site: "gmail", view: "search" } }),
      makeEvent({ ts: 3000, type: "window_title_changed", app: chrome, payload: { site: "gmail", view: "inbox" } }),
      makeClick({ ts: 4000, name: "Archive" })
    ];
    const [episode] = segmentEpisodes(events, session);
    expect(episode!.actionTokens).toEqual([
      "app:chrome|site:gmail|view:inbox|action:view",
      "app:chrome|site:gmail|view:search|action:view",
      "app:chrome|site:gmail|view:inbox|action:view",
      "app:chrome|action:click|role:button|name:archive"
    ]);
    expect(episode!.meaningfulActionCount).toBe(4);
    expect(episode!.eventIds).toHaveLength(5);
  });

  it("uses a custom idle gap", () => {
    const events = [makeClick({ ts: 0, domain: "a.example", name: "x" }), makeClick({ ts: 90_000, domain: "a.example", name: "y" })];
    expect(segmentEpisodes(events, session)).toHaveLength(1);
    expect(segmentEpisodes(events, { ...session, idleGapMs: 60_000 })).toHaveLength(2);
    expect(() => segmentEpisodes(events, { ...session, idleGapMs: 0 })).toThrow();
  });

  it("creates explicit episodes from teach markers", () => {
    const events = [
      makeClick({ ts: 0, domain: "crm.example", name: "Contacts" }),
      makeEvent({ ts: 1000, type: "teach_marker", source: "user", payload: { phase: "start" } }),
      makeClick({ ts: 2000, domain: "crm.example", name: "Open" }),
      makeClick({ ts: 3000, domain: "crm.example", name: "Edit" }),
      makeEvent({ ts: 4000, type: "teach_marker", source: "user", payload: { phase: "end" } }),
      makeClick({ ts: 5000, domain: "crm.example", name: "Contacts" })
    ];
    const episodes = segmentEpisodes(events, session);
    expect(episodes).toHaveLength(3);
    expect(episodes[0]!.boundary).toBe("inferred");
    expect(episodes[1]!.boundary).toBe("explicit");
    expect(episodes[1]!.boundaryReasons).toEqual(["teach_marker", "teach_marker"]);
    expect(episodes[1]!.eventIds).toHaveLength(4);
    expect(episodes[1]!.actionTokens).toHaveLength(2);
    expect(episodes[2]!.eventIds).toEqual([events[5]!.id]);
  });

  it("closes an episode after strong outcome events", () => {
    const events = [
      makeClick({ ts: 0, domain: "mail.example", name: "Compose" }),
      makeEvent({ ts: 1000, type: "form_submit", source: "extension", domain: "mail.example", payload: { formPurpose: "message" } }),
      makeClick({ ts: 2000, domain: "mail.example", name: "Inbox" }),
      makeClick({ ts: 3000, domain: "crm.example", name: "Save contact" }),
      makeClick({ ts: 4000, domain: "crm.example", name: "Contacts" }),
      makeEvent({ ts: 5000, type: "shortcut", app: { bundleId: "notion.id" }, payload: { keys: ["cmd", "s"] } }),
      makeEvent({ ts: 30_000, type: "download", source: "extension", domain: "files.example", payload: { extension: "pdf" } })
    ];
    const episodes = segmentEpisodes(events, session);
    expect(episodes.map((episode) => episode.eventIds.length)).toEqual([2, 2, 2, 1]);
    expect(episodes.every((episode) => episode.boundaryReasons.includes("outcome_event"))).toBe(true);
    expect(episodes[0]!.outcomeHypothesis).toBe("Submit the message form on mail.example");
    expect(episodes[0]!.triggerHypothesis).toBe("Click the 'Compose' button on mail.example");
    expect(episodes[1]!.outcomeHypothesis).toBe("Click the 'Save contact' button on crm.example");
  });

  it("detects large application-context shifts", () => {
    const events = [
      makeClick({ ts: 0, domain: "crm.example", name: "Contacts" }),
      makeClick({ ts: 10_000, domain: "crm.example", name: "Open" }),
      makeEvent({ ts: 10_000 + 2 * MIN, type: "mouse_down", app: { bundleId: "notion.id" } }),
      makeEvent({ ts: 11_000 + 2 * MIN, type: "mouse_down", app: { bundleId: "notion.id" } }),
      makeEvent({ ts: 12_000 + 2 * MIN, type: "mouse_down", app: { bundleId: "notion.id" } })
    ];
    const episodes = segmentEpisodes(events, session);
    expect(episodes).toHaveLength(2);
    expect(episodes[1]!.boundaryReasons).toContain("context_shift");
    expect(episodes[1]!.apps).toEqual(["notion"]);
    expect(episodes[0]!.domains).toEqual(["crm.example"]);
    const tooFew = segmentEpisodes(events.slice(0, 4), session);
    expect(tooFew).toHaveLength(1);
  });

  it("splits on user corrections and idle_changed events", () => {
    const events = [
      makeClick({ ts: 0, domain: "crm.example", name: "Contacts" }),
      makeClick({ ts: 1000, domain: "crm.example", name: "Open", }),
      makeEvent({ ts: 2000, type: "click", source: "user", domain: "crm.example", payload: { correction: true } }),
      makeClick({ ts: 3000, domain: "crm.example", name: "Edit" }),
      makeEvent({ ts: 4000, type: "idle_changed", payload: { idle: true, idleSeconds: 240 } }),
      makeClick({ ts: 5000, domain: "crm.example", name: "Contacts" })
    ];
    const episodes = segmentEpisodes(events, session);
    expect(episodes).toHaveLength(3);
    expect(episodes[1]!.boundaryReasons[0]).toBe("user_correction");
    expect(episodes[2]!.boundaryReasons[0]).toBe("idle_gap");
  });

  it("computes privacy status, meaningful counts and consumption", () => {
    const events = [
      makeClick({ ts: 0, domain: "youtube.com", name: "Play" }),
      makeClick({ ts: 1000, domain: "youtube.com", name: "Next" }),
      makeClick({ ts: 2000, domain: "crm.example", name: "Contacts" }),
      makeEvent({ ts: 3000, type: "privacy_gap", privacy: "privacy_gap" })
    ];
    const [episode] = segmentEpisodes(events, session);
    expect(episode!.privacyStatus).toBe("contains_gaps");
    expect(episode!.meaningfulActionCount).toBe(3);
    expect(episode!.consumptionScore).toBe(0.5);
    const sensitive = segmentEpisodes([...events, makeEvent({ ts: 4000, type: "secure_field_focused" })], session);
    expect(sensitive[0]!.privacyStatus).toBe("contains_sensitive");
    expect(segmentEpisodes([], session)).toEqual([]);
  });

  it("absorbs closing actions that follow an outcome event into the same episode", () => {
    const events = [
      makeEvent({ ts: 0, type: "app_activated", app: textEdit }),
      makeEvent({ ts: 1000, type: "shortcut", app: textEdit, payload: { keys: ["cmd", "n"] } }),
      makeEvent({ ts: 2000, type: "field_input", app: textEdit, payload: { fieldLabel: "Body" } }),
      makeEvent({ ts: 5000, type: "shortcut", app: textEdit, payload: { keys: ["cmd", "s"] } }),
      makeEvent({ ts: 6000, type: "shortcut", app: textEdit, payload: { keys: ["cmd", "w"] } }),
      makeEvent({ ts: 7000, type: "app_activated", app: finder })
    ];
    const episodes = segmentEpisodes(events, session);
    expect(episodes).toHaveLength(1);
    const [episode] = episodes;
    expect(episode!.eventIds).toEqual(events.map((event) => event.id));
    expect(episode!.actionTokens.slice(-2)).toEqual(["app:textedit|action:shortcut|keys:cmd+w", "app:finder|action:activate"]);
    expect(episode!.boundaryReasons).toEqual(["session_edge", "outcome_event", "absorbed_tail"]);
    expect(episode!.outcomeHypothesis).toContain("on textedit");
    expect(episode!.endTs).toBe(7000);
    expect(describeBoundaries(episodes)[0]).toMatchObject({ endTs: 7000, eventCount: 6, reasons: ["session_edge", "outcome_event", "absorbed_tail"] });
  });

  it("absorbs every closing action kind within the window and starts a new episode at the next meaningful action", () => {
    const events = [
      makeClick({ ts: 0, domain: "crm.example", name: "Contacts" }),
      makeClick({ ts: 1000, domain: "crm.example", name: "Save contact" }),
      makeEvent({ ts: 2000, type: "shortcut", app: textEdit, payload: { keys: "escape" } }),
      makeEvent({ ts: 3000, type: "shortcut", app: textEdit, payload: { keys: ["cmd", "q"] } }),
      makeEvent({ ts: 4000, type: "window_title_changed", app: textEdit, payload: { title: "Untitled" } }),
      makeEvent({ ts: 5000, type: "clipboard_changed" }),
      makeEvent({ ts: 6000, type: "screenshot_captured", payload: { reason: "app_change" } }),
      makeEvent({ ts: 7000, type: "privacy_gap", privacy: "privacy_gap" }),
      makeEvent({ ts: 8000, type: "idle_changed", payload: { idle: false } }),
      makeClick({ ts: 9000, domain: "crm.example", name: "Contacts" }),
      makeClick({ ts: 10_000, domain: "crm.example", name: "Open" })
    ];
    const episodes = segmentEpisodes(events, session);
    expect(episodes).toHaveLength(2);
    expect(episodes[0]!.eventIds).toEqual(events.slice(0, 9).map((event) => event.id));
    expect(episodes[0]!.boundaryReasons).toEqual(["session_edge", "outcome_event", "absorbed_tail"]);
    expect(episodes[0]!.privacyStatus).toBe("contains_gaps");
    expect(episodes[1]!.eventIds).toEqual(events.slice(9).map((event) => event.id));
    expect(episodes[1]!.boundaryReasons).toEqual(["outcome_event", "session_edge"]);
  });

  it("does not absorb closing actions outside the 20 s window or non-closing events", () => {
    const late = [
      makeClick({ ts: 0, domain: "crm.example", name: "Open" }),
      makeClick({ ts: 1000, domain: "crm.example", name: "Save contact" }),
      makeEvent({ ts: 1000 + 21_000, type: "shortcut", app: textEdit, payload: { keys: ["cmd", "w"] } }),
      makeEvent({ ts: 2000 + 21_000, type: "app_activated", app: finder })
    ];
    const lateEpisodes = segmentEpisodes(late, session);
    expect(lateEpisodes).toHaveLength(2);
    expect(lateEpisodes[0]!.boundaryReasons).toEqual(["session_edge", "outcome_event"]);
    expect(lateEpisodes[1]!.eventIds).toHaveLength(2);

    const browserView = [
      makeClick({ ts: 0, domain: "crm.example", name: "Open" }),
      makeClick({ ts: 1000, domain: "crm.example", name: "Save contact" }),
      makeEvent({ ts: 2000, type: "window_title_changed", app: chrome, payload: { site: "gmail", view: "inbox" } }),
      makeClick({ ts: 3000, domain: "mail.example", name: "Archive" })
    ];
    const viewEpisodes = segmentEpisodes(browserView, session);
    expect(viewEpisodes).toHaveLength(2);
    expect(viewEpisodes[0]!.boundaryReasons).toEqual(["session_edge", "outcome_event"]);
    expect(viewEpisodes[1]!.actionTokens[0]).toBe("app:chrome|site:gmail|view:inbox|action:view");
  });

  it("closes an absorbed tail on idle start and opens the next episode with idle_gap", () => {
    const events = [
      makeClick({ ts: 0, domain: "crm.example", name: "Open" }),
      makeClick({ ts: 1000, domain: "crm.example", name: "Save contact" }),
      makeEvent({ ts: 2000, type: "shortcut", app: textEdit, payload: { keys: ["cmd", "w"] } }),
      makeEvent({ ts: 3000, type: "idle_changed", payload: { idle: true, idleSeconds: 240 } }),
      makeClick({ ts: 4000, domain: "crm.example", name: "Contacts" })
    ];
    const episodes = segmentEpisodes(events, session);
    expect(episodes).toHaveLength(2);
    expect(episodes[0]!.eventIds).toHaveLength(4);
    expect(episodes[0]!.boundaryReasons).toEqual(["session_edge", "outcome_event", "absorbed_tail", "idle_gap"]);
    expect(episodes[1]!.boundaryReasons).toEqual(["idle_gap", "session_edge"]);
  });

  it("merges tiny post-outcome fragments into the previous episode, never into the next", () => {
    const later = 5 * MIN;
    const events = [
      makeClick({ ts: 0, domain: "crm.example", name: "Open" }),
      makeClick({ ts: 1000, domain: "crm.example", name: "Save contact" }),
      makeClick({ ts: 2000, domain: "crm.example", name: "OK" }),
      makeClick({ ts: later, domain: "crm.example", name: "Contacts" }),
      makeClick({ ts: later + 1000, domain: "crm.example", name: "Open" }),
      makeClick({ ts: later + 2000, domain: "crm.example", name: "Save contact" }),
      makeClick({ ts: later + 2000 + 20_000, domain: "crm.example", name: "Contacts" })
    ];
    const episodes = segmentEpisodes(events, session);
    expect(episodes).toHaveLength(3);
    expect(episodes[0]!.eventIds).toEqual(events.slice(0, 3).map((event) => event.id));
    expect(episodes[0]!.boundaryReasons).toEqual(["session_edge", "outcome_event", "absorbed_tail", "idle_gap"]);
    expect(episodes[0]!.meaningfulActionCount).toBe(3);
    expect(episodes[0]!.outcomeHypothesis).toBe("Click the 'Save contact' button on crm.example");
    expect(episodes[1]!.eventIds).toEqual(events.slice(3, 6).map((event) => event.id));
    expect(episodes[1]!.boundaryReasons).toEqual(["idle_gap", "outcome_event"]);
    expect(episodes[2]!.eventIds).toEqual([events[6]!.id]);
    expect(episodes[2]!.boundaryReasons).toEqual(["outcome_event", "session_edge"]);
  });

  it("keeps tiny fragments that have two meaningful actions or follow a non-outcome boundary", () => {
    const twoActions = [
      makeClick({ ts: 0, domain: "crm.example", name: "Save contact" }),
      makeClick({ ts: 1000, domain: "crm.example", name: "Contacts" }),
      makeClick({ ts: 2000, domain: "crm.example", name: "Open" })
    ];
    expect(segmentEpisodes(twoActions, session).map((episode) => episode.eventIds.length)).toEqual([1, 2]);

    const afterCorrection = [
      makeClick({ ts: 0, domain: "crm.example", name: "Open" }),
      makeClick({ ts: 1000, domain: "crm.example", name: "Save contact" }),
      makeEvent({ ts: 2000, type: "click", source: "user", domain: "crm.example", payload: { correction: true } })
    ];
    const corrected = segmentEpisodes(afterCorrection, session);
    expect(corrected).toHaveLength(2);
    expect(corrected[1]!.boundaryReasons).toEqual(["user_correction", "session_edge"]);
  });

  it("folds a teach end marker that trails an outcome into the taught episode", () => {
    const events = [
      makeEvent({ ts: 0, type: "teach_marker", source: "user", payload: { phase: "start" } }),
      makeClick({ ts: 1000, domain: "crm.example", name: "Open" }),
      makeClick({ ts: 2000, domain: "crm.example", name: "Save contact" }),
      makeEvent({ ts: 3000, type: "shortcut", app: textEdit, payload: { keys: ["cmd", "w"] } }),
      makeEvent({ ts: 4000, type: "teach_marker", source: "user", payload: { phase: "end" } }),
      makeClick({ ts: 5000, domain: "crm.example", name: "Contacts" })
    ];
    const episodes = segmentEpisodes(events, session);
    expect(episodes).toHaveLength(2);
    expect(episodes[0]!.boundary).toBe("explicit");
    expect(episodes[0]!.eventIds).toEqual(events.slice(0, 5).map((event) => event.id));
    expect(episodes[0]!.boundaryReasons).toEqual(["teach_marker", "outcome_event", "absorbed_tail", "teach_marker"]);
    expect(episodes[1]!.boundaryReasons).toEqual(["teach_marker", "session_edge"]);
  });

  it("describes boundaries for the debug view", () => {
    const events = [makeClick({ ts: 0, domain: "crm.example", name: "A" }), makeClick({ ts: 10 * MIN, domain: "crm.example", name: "B" })];
    const described = describeBoundaries(segmentEpisodes(events, session));
    expect(described).toHaveLength(2);
    expect(described[0]).toMatchObject({ startTs: 0, endTs: 0, eventCount: 1, boundary: "inferred" });
    expect(described[1]!.reasons).toContain("idle_gap");
  });
});

describe("consumption", () => {
  it("recognizes consumption domains", () => {
    expect(isConsumptionDomain("www.youtube.com")).toBe(true);
    expect(isConsumptionDomain("x.com")).toBe(true);
    expect(isConsumptionDomain("news.bbc.co.uk")).toBe(true);
    expect(isConsumptionDomain("crm.example")).toBe(false);
    expect(consumptionScore(["youtube.com", "crm.example", undefined, "reddit.com"])).toBe(0.5);
    expect(consumptionScore([])).toBe(0);
  });
});

describe("app switches after an outcome that begin new work", () => {
  it("an app switch followed by meaningful work within 15 s starts the next episode instead of being absorbed", () => {
    resetEventSequence();
    const events = [
      makeEvent({ ts: 0, type: "app_activated", app: { bundleId: "com.google.Chrome" } }),
      makeEvent({ ts: 5_000, type: "download", app: { bundleId: "com.google.Chrome" }, domain: "mail.example" }),
      makeEvent({ ts: 8_000, type: "app_activated", app: { bundleId: "com.apple.finder" } }),
      makeClick({ ts: 12_000, bundleId: "com.apple.finder", name: "invoice.pdf", role: "row" }),
      makeClick({ ts: 20_000, bundleId: "com.apple.finder", name: "Move to", role: "menuitem" })
    ];
    const episodes = segmentEpisodes(events, { sessionId: "s" });
    expect(episodes).toHaveLength(2);
    expect(episodes[1]!.actionTokens[0]).toBe("app:finder|action:activate");
    expect(episodes[0]!.boundaryReasons).not.toContain("absorbed_tail");
  });
});
