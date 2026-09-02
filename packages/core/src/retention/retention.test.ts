import { describe, expect, it } from "vitest";
import { computeRetentionPlan, deleteTodayPlan, startOfLocalDay } from "./index.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = 100 * DAY;
const settings = { screenshotHours: 24, ocrDays: 7, eventsDays: 30 };

const inventory = {
  screenshots: [
    { id: "s_fresh", ts: now - HOUR, analyzed: true },
    { id: "s_old_analyzed", ts: now - 30 * HOUR, analyzed: true },
    { id: "s_recently_analyzed", ts: now - 30 * HOUR, analyzed: true, analyzedAt: now - 2 * HOUR },
    { id: "s_unanalyzed_30h", ts: now - 30 * HOUR, analyzed: false },
    { id: "s_unanalyzed_50h", ts: now - 50 * HOUR, analyzed: false }
  ],
  ocr: [
    { id: "o_new", ts: now - 6 * DAY },
    { id: "o_old", ts: now - 8 * DAY }
  ],
  events: [
    { id: "e_new", ts: now - 29 * DAY, type: "click" },
    { id: "e_old", ts: now - 31 * DAY, type: "click" },
    { id: "e_protected", ts: now - 40 * DAY, type: "click" },
    { id: "e_today", ts: now - HOUR, type: "click" }
  ],
  skillsProtectEventIds: new Set(["e_protected"])
};

describe("computeRetentionPlan", () => {
  it("applies the screenshot, OCR and event windows", () => {
    const plan = computeRetentionPlan(now, settings, inventory);
    expect(plan.screenshotIds).toEqual(["s_old_analyzed", "s_unanalyzed_50h"]);
    expect(plan.ocrIds).toEqual(["o_old"]);
    expect(plan.eventIds).toEqual(["e_old"]);
  });

  it("honours shorter retention settings", () => {
    const plan = computeRetentionPlan(now, { screenshotHours: 1, ocrDays: 1, eventsDays: 1 }, inventory);
    expect(plan.screenshotIds).toContain("s_recently_analyzed");
    expect(plan.screenshotIds).not.toContain("s_fresh");
    expect(plan.screenshotIds).not.toContain("s_unanalyzed_30h");
    expect(plan.ocrIds).toEqual(["o_new", "o_old"]);
    expect(plan.eventIds).toEqual(["e_new", "e_old"]);
    expect(plan.eventIds).not.toContain("e_protected");
  });
});

describe("deleteTodayPlan", () => {
  it("selects everything since local midnight, including protected events", () => {
    const late = now + 20 * HOUR;
    const plan = deleteTodayPlan(late, { ...inventory, events: [...inventory.events, { id: "e_protected_today", ts: late - HOUR, type: "click" }], skillsProtectEventIds: new Set(["e_protected_today"]) });
    expect(plan.screenshotIds).toEqual([]);
    expect(plan.eventIds).toEqual(["e_protected_today"]);
    const morning = deleteTodayPlan(now + 2 * HOUR, {
      ...inventory,
      screenshots: [...inventory.screenshots, { id: "s_today", ts: now + HOUR, analyzed: false }],
      events: [...inventory.events, { id: "e_now", ts: now + HOUR, type: "click" }]
    });
    expect(morning.screenshotIds).toEqual(["s_today"]);
    expect(morning.eventIds).toEqual(["e_now"]);
    expect(morning.ocrIds).toEqual([]);
    expect(startOfLocalDay(now + 5 * HOUR)).toBe(now);
    expect(startOfLocalDay(now + 5 * HOUR, 120)).toBe(now - 2 * HOUR);
    expect(startOfLocalDay(now + HOUR, -120)).toBe(now - 22 * HOUR);
  });
});
