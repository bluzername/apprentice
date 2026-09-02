import { describe, expect, it } from "vitest";
import type { ScreenshotRecord } from "@apprentice/schemas";
import { systemClock } from "../src/main/services/clock.js";
import { silentLogger } from "../src/main/services/logger.js";
import { SkillService } from "../src/main/services/skills/skill-service.js";
import { TeachService, readProtectedScreenshotIds } from "../src/main/services/teach/teach-service.js";
import { fixtures, makeContext, scenarioEvents } from "./helpers.js";

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
    const teach = new TeachService({ storage: context.storage, analytics: context.analytics, clock: systemClock, logger: silentLogger, refiner: { refine: async () => { refined += 1; return null; } } });
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
    const teach = new TeachService({ storage: context.storage, analytics: context.analytics, clock: systemClock, logger: silentLogger });
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
