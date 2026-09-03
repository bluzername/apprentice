import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "@apprentice/schemas";
import { segmentEpisodes } from "../episodes/segment.js";
import { makeEvent } from "../testing/fixtures.js";
import { discoverCandidates } from "./discover.js";

const CHROME = { bundleId: "com.google.Chrome", name: "Google Chrome" };
const DAY = 86_400_000;
const STEP = 30_000;

/** Gmail inbox -> Gmail search -> Gmail message -> Sheets document -> click 'Save', from helper titles only. */
function browserSession(start: number, sessionId: string): ActivityEvent[] {
  const title = (offset: number, text: string): ActivityEvent =>
    makeEvent({ ts: start + offset, type: "window_title_changed", sessionId, app: CHROME, redaction: "redacted", payload: { title: text } });
  return [
    title(0, "Inbox (843) - user@example.com - Gmail"),
    title(STEP, "Inbox (843) - user@example.com - Gmail"),
    title(2 * STEP, "Search results - user@example.com - Gmail"),
    title(3 * STEP, "Re: Q3 pipeline numbers - user@example.com - Gmail"),
    title(4 * STEP, "Pipeline Q3 - Google Sheets"),
    makeEvent({ ts: start + 5 * STEP, type: "mouse_down", sessionId, app: CHROME, element: { role: "button", name: "Save" }, payload: { x: 10, y: 10, button: "left" } })
  ];
}

const EXPECTED_TOKENS = [
  "app:chrome|site:gmail|view:inbox|action:view",
  "app:chrome|site:gmail|view:search|action:view",
  "app:chrome|site:gmail|view:page|action:view",
  "app:chrome|site:google-sheets|view:document|action:view",
  "app:chrome|action:click|role:button|name:save"
];

describe("browser workflows learned from window titles", () => {
  it("yields one active candidate from two title-driven episodes", () => {
    const events = [...browserSession(0, "s1"), ...browserSession(2 * DAY, "s1")];
    const episodes = segmentEpisodes(events, { sessionId: "s1" });
    expect(episodes).toHaveLength(2);
    expect(episodes[0]!.actionTokens).toEqual(EXPECTED_TOKENS);
    expect(episodes[0]!.meaningfulActionCount).toBe(5);
    expect(episodes[0]!.triggerHypothesis).toBe("Open Gmail inbox on chrome");
    const candidates = discoverCandidates(episodes, { now: 3 * DAY });
    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate!.suppression.state).toBe("active");
    expect(candidate!.repeatCount).toBe(2);
    expect(candidate!.steps.map((step) => step.token)).toEqual(EXPECTED_TOKENS);
    expect(candidate!.steps.map((step) => step.description)).toEqual([
      "Open Gmail inbox on chrome",
      "Open Gmail search results on chrome",
      "Open a Gmail message on chrome",
      "Open a Google Sheets document on chrome",
      "Click the 'Save' button on chrome"
    ]);
    expect(candidate!.riskClass).toBe("internal_mutation");
    expect(JSON.stringify(candidate)).not.toMatch(/example\.com|pipeline|843/i);
  });

  it("does not learn from view transitions alone", () => {
    const viewsOnly = (start: number): ActivityEvent[] => browserSession(start, "s2").filter((event) => event.type !== "mouse_down");
    const episodes = segmentEpisodes([...viewsOnly(0), ...viewsOnly(2 * DAY)], { sessionId: "s2" });
    expect(episodes[0]!.meaningfulActionCount).toBe(4);
    expect(discoverCandidates(episodes, { now: 3 * DAY })).toEqual([]);
  });
});
