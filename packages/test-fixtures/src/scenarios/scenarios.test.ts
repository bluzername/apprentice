import { ActivityEventSchema, type ActivityEvent } from "@apprentice/schemas";
import { describe, expect, it } from "vitest";
import { SCENARIO_NAMES, type GeneratedEpisode, type ScenarioName } from "../types.js";
import { countMeaningfulActions } from "./builder.js";
import { MAX_GAP_S, MIN_GAP_S, MIN_SCREENSHOT_INTERVAL_MS } from "./constants.js";
import { SCENARIO_GENERATORS } from "./index.js";

const OCCURRENCES = [1, 2, 3, 4] as const;
const VARIANTS = [0, 1, 2] as const;
const STRONG_OUTCOME_TYPES = new Set<ActivityEvent["type"]>(["form_submit"]);

function generate(scenario: ScenarioName, occurrence: number, variant = 0): GeneratedEpisode {
  return SCENARIO_GENERATORS[scenario]({
    seed: 7,
    occurrence,
    startTs: 1_800_000_000_000 + occurrence * 86_400_000,
    sessionId: `s-${scenario}-${occurrence}`,
    seqStart: occurrence * 100,
    variant
  });
}

function tuples(events: readonly ActivityEvent[]): readonly string[] {
  return events.map((event) => `${event.type}|${event.domain ?? ""}|${event.element?.name ?? ""}`);
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const table = a.reduce<readonly (readonly number[])[]>(
    (rows, itemA) => {
      const prev = rows[rows.length - 1] ?? [];
      const row = b.reduce<readonly number[]>((acc, itemB, j) => {
        const diag = prev[j] ?? 0;
        const up = prev[j + 1] ?? 0;
        const left = acc[j] ?? 0;
        return [...acc, itemA === itemB ? diag + 1 : Math.max(up, left)];
      }, [0]);
      return [...rows, row];
    },
    [Array.from({ length: b.length + 1 }, () => 0)]
  );
  return table[a.length]?.[b.length] ?? 0;
}

function orderedOverlap(a: readonly ActivityEvent[], b: readonly ActivityEvent[]): number {
  const ta = tuples(a);
  const tb = tuples(b);
  return lcsLength(ta, tb) / Math.max(ta.length, tb.length);
}

describe.each(SCENARIO_NAMES)("scenario %s", (scenario) => {
  const cases = OCCURRENCES.flatMap((occurrence) => VARIANTS.map((variant) => [occurrence, variant] as const));

  it.each(cases)("occurrence %i variant %i validates against ActivityEventSchema", (occurrence, variant) => {
    const episode = generate(scenario, occurrence, variant);
    episode.events.forEach((event) => {
      const parsed = ActivityEventSchema.safeParse(event);
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    });
  });

  it.each(cases)("occurrence %i variant %i is ordered, sequenced, and realistically timed", (occurrence, variant) => {
    const { events, expected } = generate(scenario, occurrence, variant);
    const first = events[0];
    expect(first?.ts).toBe(1_800_000_000_000 + occurrence * 86_400_000);
    expect(first?.seq).toBe(occurrence * 100);
    events.slice(1).forEach((event, index) => {
      const prev = events[index];
      if (!prev) {
        throw new Error("missing previous event");
      }
      const gap = event.ts - prev.ts;
      expect(gap).toBeGreaterThanOrEqual(MIN_GAP_S * 1000);
      expect(gap).toBeLessThanOrEqual(MAX_GAP_S * 1000);
      expect(event.seq).toBe(prev.seq + 1);
      expect(event.activeDurationMs).toBe(gap);
      expect(event.id).toBe(`${event.sessionId}-e${event.seq}`);
    });
    expect(expected.activeDurationMs).toBeGreaterThanOrEqual(3 * 60 * 1000);
    expect(expected.activeDurationMs).toBeLessThanOrEqual(9 * 60 * 1000);
    const meaningful = countMeaningfulActions(events);
    expect(meaningful).toBeGreaterThanOrEqual(8);
    expect(meaningful).toBeLessThanOrEqual(16);
  });

  it.each(cases)("occurrence %i variant %i ends with exactly one strong outcome event", (occurrence, variant) => {
    const { events, expected } = generate(scenario, occurrence, variant);
    const outcomes = events.filter((event) => STRONG_OUTCOME_TYPES.has(event.type));
    expect(outcomes).toHaveLength(1);
    const last = events[events.length - 1];
    expect(last?.type).toBe("form_submit");
    expect(`${last?.type}:${String(last?.payload?.purpose)}`).toBe(expected.outcomeType);
    expect(last?.screenshotRef).toBeDefined();
  });

  it.each(cases)("occurrence %i variant %i sets privacy, redaction, and source correctly", (occurrence, variant) => {
    const { events, expected } = generate(scenario, occurrence, variant);
    events.forEach((event) => {
      expect(event.privacy).toBe("allowed");
      expect(event.redaction).toBe("none_needed");
      expect(event.source).toBe(event.domain ? "extension" : "native_helper");
      if (event.type === "field_input") {
        expect(typeof event.payload?.valueLength).toBe("number");
        expect(Object.keys(event.payload ?? {})).not.toContain("value");
      }
      expect(event.app?.bundleId).toBeDefined();
    });
    expect(expected.apps).toContain("com.google.Chrome");
    expect(expected.domains.length).toBeGreaterThanOrEqual(3);
  });

  it.each(cases)("occurrence %i variant %i attaches sparse screenshot refs", (occurrence, variant) => {
    const { events, screenshotRefs } = generate(scenario, occurrence, variant);
    const byId = new Map(events.map((event) => [event.id, event]));
    expect(screenshotRefs.length).toBeGreaterThanOrEqual(4);
    screenshotRefs.forEach((ref, index) => {
      const event = byId.get(ref.eventId);
      expect(event?.screenshotRef).toBe(ref.id);
      expect(event?.ts).toBe(ref.ts);
      expect(["app_activated", "navigation", "click", "form_submit"]).toContain(event?.type);
      const prev = screenshotRefs[index - 1];
      if (prev) {
        expect(ref.ts - prev.ts).toBeGreaterThanOrEqual(MIN_SCREENSHOT_INTERVAL_MS);
      }
    });
    const withRef = events.filter((event) => event.screenshotRef !== undefined);
    expect(withRef).toHaveLength(screenshotRefs.length);
  });

  it("is deterministic for identical options", () => {
    expect(generate(scenario, 2, 1)).toEqual(generate(scenario, 2, 1));
  });

  it("occurrences share >= 70% of (type, domain, element.name) tuples in order", () => {
    const base = generate(scenario, 1, 0);
    OCCURRENCES.slice(1).forEach((occurrence) => {
      const other = generate(scenario, occurrence, (occurrence - 1) % 3);
      expect(orderedOverlap(base.events, other.events)).toBeGreaterThanOrEqual(0.7);
    });
  });

  it("occurrences differ in routePattern ids", () => {
    const routes = OCCURRENCES.map((occurrence) =>
      generate(scenario, occurrence, 0)
        .events.filter((event) => event.routePattern?.match(/[0-9a-f]{6,}/))
        .map((event) => event.routePattern)
        .join(",")
    );
    expect(new Set(routes).size).toBe(OCCURRENCES.length);
  });
});
