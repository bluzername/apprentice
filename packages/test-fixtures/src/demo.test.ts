import { ActivityEventSchema } from "@apprentice/schemas";
import { describe, expect, it } from "vitest";
import { generateDemoDays } from "./demo.js";
import { loadFixtureManifest } from "./loaders.js";
import { DemoDatasetSchema, SCENARIO_NAMES, TEMPLATE_NAMES } from "./types.js";

const END_TS = Date.UTC(2026, 8, 1, 18, 0, 0);

describe("generateDemoDays", () => {
  const dataset = generateDemoDays({ days: 3, seed: 42, endTs: END_TS });

  it("validates against DemoDatasetSchema and every event against ActivityEventSchema", () => {
    expect(DemoDatasetSchema.safeParse(dataset).success).toBe(true);
    dataset.events.forEach((event) => expect(ActivityEventSchema.safeParse(event).success).toBe(true));
  });

  it("contains each scenario at least twice across 3 days", () => {
    SCENARIO_NAMES.forEach((scenario) => {
      expect(dataset.episodesExpected[scenario]).toBeGreaterThanOrEqual(2);
      expect(dataset.occurrences.filter((occurrence) => occurrence.scenario === scenario).length).toBe(
        dataset.episodesExpected[scenario]
      );
    });
    expect(dataset.fillerExpected.consumption).toBeGreaterThanOrEqual(3);
    expect(dataset.fillerExpected.privacyGapRuns).toBeGreaterThanOrEqual(3);
  });

  it("sorts events by timestamp with contiguous seq and consistent ids", () => {
    dataset.events.forEach((event, index) => {
      expect(event.seq).toBe(index);
      expect(event.id).toBe(`${event.sessionId}-e${index}`);
      const prev = dataset.events[index - 1];
      if (prev) {
        expect(event.ts).toBeGreaterThanOrEqual(prev.ts);
      }
    });
  });

  it("lays out weekday sessions from 09:00 to 18:00 local with session edges", () => {
    expect(dataset.sessions).toHaveLength(3);
    dataset.sessions.forEach((session) => {
      const start = new Date(session.startTs);
      const end = new Date(session.endTs);
      expect(start.getHours()).toBe(9);
      expect(end.getHours()).toBe(18);
      expect([0, 6]).not.toContain(start.getDay());
      const own = dataset.events.filter((event) => event.sessionId === session.id);
      expect(own[0]?.type).toBe("session_start");
      expect(own[own.length - 1]?.type).toBe("session_end");
      own.forEach((event) => {
        expect(event.ts).toBeGreaterThanOrEqual(session.startTs);
        expect(event.ts).toBeLessThanOrEqual(session.endTs);
      });
    });
    expect(dataset.endTs).toBeLessThanOrEqual(END_TS);
  });

  it("keeps scenario occurrences separated by more than the idle gap", () => {
    const sorted = [...dataset.occurrences].sort((a, b) => a.startTs - b.startTs);
    sorted.slice(1).forEach((occurrence, index) => {
      const prev = sorted[index];
      expect(occurrence.startTs - (prev?.endTs ?? 0)).toBeGreaterThan(4 * 60 * 1000);
    });
  });

  it("resolves every screenshot ref to a fixture in the manifest and to its event", () => {
    const manifestNames = new Set(loadFixtureManifest().screenshots.map((entry) => entry.name));
    const byId = new Map(dataset.events.map((event) => [event.id, event]));
    expect(dataset.screenshots.length).toBeGreaterThan(0);
    dataset.screenshots.forEach((shot) => {
      expect(manifestNames.has(shot.fixtureName)).toBe(true);
      expect(TEMPLATE_NAMES).toContain(shot.fixtureName);
      expect(shot.width).toBe(1440);
      expect(shot.height).toBe(900);
      const event = byId.get(shot.eventId);
      expect(event?.screenshotRef).toBe(shot.id);
      expect(event?.privacy).toBe("allowed");
    });
    const referencing = dataset.events.filter((event) => event.screenshotRef !== undefined);
    expect(referencing).toHaveLength(dataset.screenshots.length);
  });

  it("is deterministic for the same seed and end timestamp", () => {
    expect(generateDemoDays({ days: 2, seed: 5, endTs: END_TS })).toEqual(generateDemoDays({ days: 2, seed: 5, endTs: END_TS }));
    expect(generateDemoDays({ days: 2, seed: 6, endTs: END_TS })).not.toEqual(generateDemoDays({ days: 2, seed: 5, endTs: END_TS }));
  });

  it("honours scenario selection and session prefix", () => {
    const subset = generateDemoDays({ days: 2, seed: 1, endTs: END_TS, scenarios: ["invoiceProcessing"], sessionIdPrefix: "alt" });
    expect(subset.episodesExpected).toEqual({ postMeetingFollowup: 0, invoiceProcessing: 2, candidateReview: 0 });
    expect(subset.sessions.map((session) => session.id)).toEqual(["alt-day1", "alt-day2"]);
  });

  it("rejects fewer than two days", () => {
    expect(() => generateDemoDays({ days: 1, endTs: END_TS })).toThrow(/days must be an integer >= 2/);
  });
});
