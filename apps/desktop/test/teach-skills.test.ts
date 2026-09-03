import { describe, expect, it } from "vitest";
import { makeEvent } from "@apprentice/core";
import { APP_BUNDLE_ID, type ActivityEvent, type ScreenshotRecord } from "@apprentice/schemas";
import { systemClock } from "../src/main/services/clock.js";
import { silentLogger } from "../src/main/services/logger.js";
import { SkillService } from "../src/main/services/skills/skill-service.js";
import { TeachService, readProtectedScreenshotIds } from "../src/main/services/teach/teach-service.js";
import { fixtures, makeContext, scenarioEvents } from "./helpers.js";

const TEXTEDIT = { bundleId: "com.apple.TextEdit", name: "TextEdit" };

/** A save in TextEdit, then the user presses the teach shortcut: helper shortcut event, marker, own-app click. */
function taughtSession(now: number): ActivityEvent[] {
  const base = { sessionId: "teach", app: TEXTEDIT };
  return [
    makeEvent({ ...base, id: "t-click", ts: now - 60_000, type: "mouse_down", element: { role: "AXMenuItem", name: "New Document" } }),
    makeEvent({ ...base, id: "t-save", ts: now - 50_000, type: "shortcut", payload: { keys: ["cmd", "s"] } }),
    makeEvent({ ...base, id: "t-own", ts: now - 45_000, type: "click", app: { bundleId: APP_BUNDLE_ID, name: "Apprentice" }, element: { role: "AXButton", name: "Save" } }),
    makeEvent({ ...base, id: "t-close", ts: now - 40_000, type: "shortcut", payload: { keys: ["cmd", "w"] } }),
    makeEvent({ ...base, id: "t-gap", ts: now - 35_000, type: "privacy_gap", source: "system", privacy: "allowed" }),
    makeEvent({ ...base, id: "t-teach-keys", ts: now - 30_000, type: "shortcut", payload: { keys: ["alt", "cmd", "l"] } }),
    makeEvent({ ...base, id: "t-marker", ts: now - 29_000, type: "teach_marker", source: "user", payload: { phase: "start" } }),
    makeEvent({ ...base, id: "t-after", ts: now - 20_000, type: "mouse_down", element: { role: "AXButton", name: "Documents" } })
  ];
}

describe("teach range filtering", () => {
  it("excludes the teach shortcut, the marker and everything after it, own-app events, and privacy gaps", async () => {
    const context = makeContext();
    const now = Date.now();
    context.storage.current.events.insertMany(taughtSession(now));
    expect(context.settings.get().shortcuts.teach).toBe("Alt+Command+L");
    const teach = new TeachService({ storage: context.storage, settings: context.settings, analytics: context.analytics, clock: systemClock, logger: silentLogger });
    const opened = teach.openRange(5);
    expect(opened.events.map((event) => event.id)).toEqual(["t-click", "t-save", "t-close"]);
    const drafted = await teach.draft({ startTs: opened.startTs, endTs: opened.endTs, excludedEventIds: [] });
    expect(drafted.draft.name).toBe("textedit: Press Cmd+S");
    expect(drafted.draft.goal).toBe("Press Cmd+S has visibly succeeded on textedit");
    expect(drafted.draft.allowedApps).toEqual(["com.apple.TextEdit"]);
    expect(drafted.retained.eventCount).toBe(3);
    const steps = drafted.draft.subtasks.flatMap((subtask) => subtask.keySteps);
    expect(steps).not.toContain("Press Cmd+Option+L");
    expect(steps).not.toContain("Click the 'Save' button");
  });

  it("reads the teach shortcut from settings, ignoring key order and modifier aliases", async () => {
    const context = makeContext();
    context.settings.update({ shortcuts: { teach: "Control+Shift+T" } });
    const now = Date.now();
    const base = { sessionId: "teach", app: { bundleId: "com.apple.finder", name: "Finder" } };
    context.storage.current.events.insertMany([
      makeEvent({ ...base, id: "f-click", ts: now - 30_000, type: "mouse_down", element: { role: "AXButton", name: "Documents" } }),
      makeEvent({ ...base, id: "f-other", ts: now - 20_000, type: "shortcut", payload: { keys: ["cmd", "alt", "l"] } }),
      makeEvent({ ...base, id: "f-teach", ts: now - 10_000, type: "shortcut", payload: { keys: ["shift", "control", "t"] } }),
      makeEvent({ ...base, id: "f-marker", ts: now - 9_000, type: "teach_marker", source: "user", payload: { phase: "start" } })
    ]);
    const teach = new TeachService({ storage: context.storage, settings: context.settings, analytics: context.analytics, clock: systemClock, logger: silentLogger });
    const opened = teach.openRange(5);
    expect(opened.events.map((event) => event.id)).toEqual(["f-click", "f-other"]);
    const drafted = await teach.draft({ startTs: opened.startTs, endTs: opened.endTs, excludedEventIds: [] });
    expect(drafted.draft.name).toBe("Work in finder");
    expect(drafted.draft.subtasks.flatMap((subtask) => subtask.keySteps)).toContain("Press Cmd+Option+L");
  });
});

describe("teach service", () => {
  it("opens a range, drafts deterministically with a retention preview, and saves a versioned skill", async () => {
    const context = makeContext();
    const now = Date.now();
    const events = scenarioEvents("postMeetingFollowup", 1, "teach", now - 10 * 60_000);
    context.storage.current.events.insertMany(events);
    const firstClick = events.find((event) => event.type === "click")!;
    const png = fixtures.readScreenshotPng("crmContact");
    const written = context.storage.current.blobs.write("shot-teach-1", png);
    const record: ScreenshotRecord = { id: "shot-teach-1", ts: firstClick.ts, sessionId: "teach", eventId: firstClick.id, width: 1440, height: 900, displayScale: 1, perceptualHash: "0000000000000000", byteLength: written.byteLength, reason: "click", analyzed: true };
    context.storage.current.screenshots.insert(record);
    let refined = 0;
    const teach = new TeachService({ storage: context.storage, settings: context.settings, analytics: context.analytics, clock: systemClock, logger: silentLogger, refiner: { refine: async () => { refined += 1; return null; } } });
    const opened = teach.openRange(15);
    expect(opened.events.length).toBe(events.filter((event) => event.privacy === "allowed").length);
    expect(opened.screenshots.map((shot) => shot.id)).toEqual(["shot-teach-1"]);
    const range = { startTs: opened.startTs, endTs: opened.endTs, excludedEventIds: [firstClick.id] };
    const drafted = await teach.draft(range);
    expect(drafted.draft.origin).toBe("deterministic");
    expect(drafted.draft.subtasks.length).toBeGreaterThan(0);
    expect(drafted.retained.eventCount).toBe(opened.events.length - 1);
    expect(drafted.retained.screenshotCount).toBe(1);
    expect(drafted.retained.fields).toEqual(expect.arrayContaining(["skill.name", "skill.trigger", "event.type", "screenshot.encryptedPng"]));
    expect(refined).toBe(1);
    const skill = teach.save(drafted.draft, range, "guide");
    expect(skill.version).toBe(1);
    expect(skill.source).toBe("taught");
    expect(skill.evidence.taughtRange).toEqual({ startTs: range.startTs, endTs: range.endTs });
    expect(skill.subtasks.every((subtask) => subtask.completionPredicates.length > 0)).toBe(true);
    expect(readProtectedScreenshotIds(context.storage).has("shot-teach-1")).toBe(true);
    expect(context.storage.current.productEvents.countByName("teach_saved")).toBe(1);
    await expect(teach.draft({ startTs: now + 1000, endTs: now + 2000, excludedEventIds: [] })).rejects.toThrow(/No recorded actions/);
  });
});

describe("skill service", () => {
  it("revises with version bumps and corrections, and deletes dependent runs", async () => {
    const context = makeContext();
    const now = Date.now();
    context.storage.current.events.insertMany(scenarioEvents("candidateReview", 1, "teach", now - 5 * 60_000));
    const teach = new TeachService({ storage: context.storage, settings: context.settings, analytics: context.analytics, clock: systemClock, logger: silentLogger });
    const opened = teach.openRange(10);
    const range = { startTs: opened.startTs, endTs: opened.endTs, excludedEventIds: [] };
    const skill = teach.save((await teach.draft(range)).draft, range, "approval_every_step");
    const service = new SkillService({ storage: context.storage, analytics: context.analytics, clock: systemClock });
    const revised = service.save({ ...skill, name: "Candidate review (edited)" }, "Renamed");
    expect(revised.version).toBe(2);
    expect(revised.corrections).toHaveLength(1);
    expect(revised.corrections[0]).toMatchObject({ field: "name", note: "Renamed", fromVersion: 1 });
    expect(service.get(skill.id).history.map((entry) => entry.version)).toEqual([2, 1]);
    expect(service.save(revised).version).toBe(2);
    context.storage.current.runs.save({ id: "run_del", skillId: skill.id, skillVersion: 2, skillName: skill.name, mode: "guide", status: "completed", currentSubtaskIndex: 0, subtaskCount: 1, startedAt: now, failureCategory: "none", provider: "mock", metrics: { steps: 0, approvedActions: 0, rejectedActions: 0, corrections: 0, modelLatencyMsTotal: 0, modelLatencyMsMax: 0, screenshotsUsed: 0 }, lowRiskRunApproval: false, navigationRunApproval: false, summary: "" });
    expect(service.delete(skill.id)).toBe(true);
    expect(service.list()).toHaveLength(0);
    expect(context.storage.current.runs.get("run_del")).toBeNull();
    expect(service.delete(skill.id)).toBe(false);
  });
});
