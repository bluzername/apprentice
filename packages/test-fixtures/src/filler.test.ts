import { ActivityEventSchema } from "@apprentice/schemas";
import { describe, expect, it } from "vitest";
import { generateConsumptionEpisode, generatePrivacyGapEvents, generateSensitiveEpisode } from "./filler.js";

const base = { seed: 3, occurrence: 1, startTs: 1_800_000_000_000, sessionId: "filler", seqStart: 10 };

describe("generateConsumptionEpisode", () => {
  it("browses news, video, and social without any outcome event", () => {
    const episode = generateConsumptionEpisode(base);
    episode.events.forEach((event) => expect(ActivityEventSchema.safeParse(event).success).toBe(true));
    expect(episode.expected.domains).toEqual(["news.example", "video.example", "social.example"]);
    expect(episode.expected.outcomeType).toBe("none");
    expect(episode.events.some((event) => ["form_submit", "download", "field_input"].includes(event.type))).toBe(false);
    expect(episode.events.filter((event) => event.payload?.intent === "scroll").length).toBeGreaterThanOrEqual(5);
    expect(episode.events[0]?.seq).toBe(10);
    expect(episode.screenshotRefs.length).toBeGreaterThan(0);
  });
});

describe("generateSensitiveEpisode", () => {
  it("marks the banking visit sensitive and emits privacy gaps without screenshots", () => {
    const episode = generateSensitiveEpisode(base);
    episode.events.forEach((event) => expect(ActivityEventSchema.safeParse(event).success).toBe(true));
    const navigation = episode.events.find((event) => event.type === "navigation");
    expect(navigation?.domain).toBe("bank.example");
    expect(navigation?.privacy).toBe("sensitive");
    expect(navigation?.redaction).toBe("redacted");
    expect(navigation?.routePattern).toBeUndefined();
    expect(navigation?.screenshotRef).toBeUndefined();
    const secure = episode.events.find((event) => event.type === "secure_field_focused");
    expect(secure?.privacy).toBe("sensitive");
    const gaps = episode.events.filter((event) => event.type === "privacy_gap");
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    gaps.forEach((gap) => {
      expect(gap.privacy).toBe("privacy_gap");
      expect(gap.screenshotRef).toBeUndefined();
    });
    expect(episode.screenshotRefs.every((ref) => ref.domain === undefined)).toBe(true);
  });
});

describe("generatePrivacyGapEvents", () => {
  it("emits app-less privacy_gap events from the native helper", () => {
    const events = generatePrivacyGapEvents({ seed: 3, startTs: 1_800_000_000_000, sessionId: "gap", seqStart: 5, count: 4 });
    expect(events).toHaveLength(4);
    events.forEach((event, index) => {
      expect(ActivityEventSchema.safeParse(event).success).toBe(true);
      expect(event.type).toBe("privacy_gap");
      expect(event.privacy).toBe("privacy_gap");
      expect(event.source).toBe("native_helper");
      expect(event.app).toBeUndefined();
      expect(event.domain).toBeUndefined();
      expect(event.screenshotRef).toBeUndefined();
      expect(event.seq).toBe(5 + index);
    });
    expect(events[0]?.ts).toBe(1_800_000_000_000);
    expect(events[3]?.ts).toBeGreaterThan(1_800_000_000_000);
  });

  it("picks a count between 2 and 5 when none is given", () => {
    const events = generatePrivacyGapEvents({ seed: 9, startTs: 0, sessionId: "gap", seqStart: 0 });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.length).toBeLessThanOrEqual(5);
  });
});
