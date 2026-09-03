import { describe, expect, it } from "vitest";
import type { ActivityEvent, ScreenshotRecord } from "@apprentice/schemas";
import { activityItems, mergeEvents, mergeScreenshots, screenshotItemId, screenshotLocation, screenshotTitle, standaloneScreenshots } from "./activity-items";

function event(i: number, overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return { id: `evt_${i}`, ts: 1_000 + i * 100, seq: i, sessionId: "s1", source: "native_helper", type: "app_activated", app: { bundleId: "com.google.Chrome", name: "Google Chrome" }, privacy: "allowed", redaction: "none_needed", ...overrides };
}

function shot(id: string, ts: number, overrides: Partial<ScreenshotRecord> = {}): ScreenshotRecord {
  return { id, ts, sessionId: "s1", width: 100, height: 50, displayScale: 2, perceptualHash: "ab", byteLength: 10, reason: "interval", analyzed: false, app: { bundleId: "com.google.Chrome", name: "Google Chrome" }, ...overrides };
}

describe("standaloneScreenshots", () => {
  it("keeps screenshots that no listed event displays", () => {
    const events = [event(1, { screenshotRef: "shot_a" }), event(2)];
    const shots = [shot("shot_a", 1_100, { eventId: "evt_1", reason: "click" }), shot("shot_b", 1_150, { eventId: "evt_2" }), shot("shot_c", 1_300), shot("shot_d", 1_400, { eventId: "evt_missing" })];
    expect(standaloneScreenshots(events, shots).map((s) => s.id)).toEqual(["shot_c", "shot_d"]);
  });
});

describe("activityItems", () => {
  it("interleaves events and standalone screenshots by time, events first at a tie", () => {
    const events = [event(2), event(1)];
    const shots = [shot("shot_x", 1_100), shot("shot_y", 1_050)];
    const items = activityItems(events, shots);
    expect(items.map((item) => item.id)).toEqual(["shot:shot_y", "evt_1", "shot:shot_x", "evt_2"]);
    expect(items[0]).toMatchObject({ kind: "screenshot", ts: 1_050 });
    expect(screenshotItemId("shot_x")).toBe("shot:shot_x");
  });
});

describe("merge helpers", () => {
  it("replaces known events by id and appends new ones in order", () => {
    const current = [event(1), event(3)];
    const merged = mergeEvents(current, [event(3, { screenshotRef: "shot_z" }), event(2)]);
    expect(merged.map((e) => e.id)).toEqual(["evt_1", "evt_2", "evt_3"]);
    expect(merged[2]?.screenshotRef).toBe("shot_z");
    expect(current[1]?.screenshotRef).toBeUndefined();
  });
  it("merges screenshots the same way", () => {
    const merged = mergeScreenshots([shot("a", 10)], [shot("a", 10, { eventId: "evt_1" }), shot("b", 5)]);
    expect(merged.map((s) => [s.id, s.eventId])).toEqual([["b", undefined], ["a", "evt_1"]]);
  });
});

describe("labels", () => {
  it("names the capture reason and location", () => {
    expect(screenshotTitle(shot("a", 1))).toBe("Screenshot (interval)");
    expect(screenshotTitle(shot("a", 1, { reason: "run_step" }))).toBe("Screenshot (run step)");
    expect(screenshotLocation(shot("a", 1, { domain: "crm.example" }))).toBe("Google Chrome / crm.example");
    expect(screenshotLocation(shot("a", 1, { app: { bundleId: "com.apple.mail" } }))).toBe("com.apple.mail");
  });
});
