import { describe, expect, it } from "vitest";
import { WorkflowCandidateSchema } from "@apprentice/schemas";
import { makeEpisode } from "../testing/fixtures.js";
import { consensusSteps } from "./consensus.js";
import { discoverCandidates } from "./discover.js";
import { confidenceFromComponents, explainConfidence } from "./scoring.js";
import { deterministicTitle, outcomePhrase, triggerPhrase } from "./title.js";
import { alignedLabelVariables, routeVariables } from "./variables.js";

const NOTES = "app:notion|action:click|name:meeting-notes";
const COPY = "app:notion|action:copy";
const OPEN = "app:chrome|domain:crm.example|route:/contact/:id|action:navigate";
const LOG = "app:chrome|domain:crm.example|route:/contact/:id|action:click|role:button|name:log-activity";
const PASTE = "app:chrome|domain:crm.example|route:/contact/:id|action:paste";
const SAVE = "app:chrome|domain:crm.example|route:/contact/:id|action:form-submit|purpose:update";
const WORKFLOW = [NOTES, COPY, OPEN, LOG, PASTE, SAVE];
const DAY = 86_400_000;

function workflowEpisode(id: string, day: number, tokens: readonly string[] = WORKFLOW) {
  return makeEpisode({
    id,
    actionTokens: tokens,
    startTs: day * DAY,
    endTs: day * DAY + 180_000,
    activeDurationMs: 180_000,
    apps: ["notion", "chrome"],
    domains: ["crm.example"],
    meaningfulActionCount: tokens.length - 1,
    triggerHypothesis: "Click 'Meeting notes' on notion",
    outcomeHypothesis: "Submit the update form on crm.example"
  });
}

describe("discoverCandidates", () => {
  it("finds one candidate from two similar episodes and none from three dissimilar ones", () => {
    const similar = [workflowEpisode("e1", 0), workflowEpisode("e2", 2), workflowEpisode("e3", 4, [NOTES, COPY, OPEN, PASTE, SAVE])];
    const candidates = discoverCandidates(similar, { now: 7 * DAY });
    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(WorkflowCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(candidate!.repeatCount).toBe(3);
    expect(candidate!.evidenceEpisodeIds).toEqual(["e1", "e2", "e3"]);
    expect(candidate!.steps.map((step) => step.token)).toEqual(WORKFLOW);
    expect(candidate!.steps[3]!.occurrenceRatio).toBeCloseTo(0.667, 2);
    expect(candidate!.steps[3]!.description).toBe("Click the 'Log activity' button on crm.example");
    expect(candidate!.medianDurationMs).toBe(180_000);
    expect(candidate!.estimatedWeeklyFrequency).toBeCloseTo(5.25, 2);
    expect(candidate!.estimatedWeeklyMinutes).toBeCloseTo(15.8, 1);
    expect(candidate!.confidence).toBeGreaterThan(0.6);
    expect(candidate!.confidence).toBeLessThanOrEqual(1);
    expect(candidate!.riskClass).toBe("internal_mutation");
    expect(candidate!.suppression.state).toBe("active");
    expect(candidate!.source).toBe("passive");
    expect(candidate!.deterministicTitle).toBe("Submit the update form in crm.example after clicking 'Meeting notes' in Notion");
    expect(candidate!.expectedOutcome).toBe("Submit the update form");
    expect(candidate!.confidenceExplanation).toMatch(/^I observed a similar sequence 3 times\./);
    expect(candidate!.confidenceExplanation).not.toMatch(/I know you/i);
    expect(candidate!.scoreComponents.triggerConsistency).toBe(1);
    expect(candidate!.scoreComponents.lowRiskCoverage).toBeCloseTo(5 / 6, 3);
    expect(candidate!.confidenceExplanation).toMatch(/83% of the steps are low risk/);
    expect(candidate!.patternKey).toHaveLength(32);

    const dissimilar = [
      workflowEpisode("d1", 0),
      workflowEpisode("d2", 1, ["app:slack|action:click|name:channel", "app:slack|action:paste", "app:slack|action:click|name:send", "app:slack|action:shortcut|keys:cmd+enter"]),
      workflowEpisode("d3", 2, ["app:excel|action:shortcut|keys:cmd+o", "app:excel|action:click|name:sheet", "app:excel|action:copy", "app:excel|action:shortcut|keys:cmd+s"])
    ];
    expect(discoverCandidates(dissimilar, { now: 7 * DAY })).toEqual([]);
  });

  it("is deterministic and skips known pattern keys", () => {
    const episodes = [workflowEpisode("e1", 0), workflowEpisode("e2", 1)];
    const first = discoverCandidates(episodes, { now: 3 * DAY });
    const second = discoverCandidates(episodes, { now: 3 * DAY });
    expect(first).toEqual(second);
    expect(discoverCandidates(episodes, { now: 3 * DAY, existingPatternKeys: new Set([first[0]!.patternKey]) })).toEqual([]);
  });

  it("applies the minimum thresholds", () => {
    const episodes = [workflowEpisode("e1", 0), workflowEpisode("e2", 1)];
    expect(discoverCandidates([episodes[0]!], { now: DAY })).toEqual([]);
    expect(discoverCandidates(episodes, { now: DAY, minEpisodes: 3 })).toEqual([]);
    expect(discoverCandidates(episodes, { now: DAY, minMedianDurationMs: 200_000 })).toEqual([]);
    expect(discoverCandidates(episodes, { now: DAY, minMeaningfulActions: 10 })).toEqual([]);
    expect(discoverCandidates(episodes.map((episode) => ({ ...episode, privacyStatus: "contains_sensitive" as const })), { now: DAY })).toEqual([]);
  });

  it("suppresses consumption-dominated passive candidates but not taught ones", () => {
    const browsing = ["app:chrome|domain:youtube.com|action:click|name:play", "app:chrome|domain:youtube.com|action:click|name:next", "app:chrome|domain:reddit.com|action:navigate", "app:chrome|domain:reddit.com|action:click|name:upvote"];
    const episodes = [
      { ...workflowEpisode("c1", 0, browsing), consumptionScore: 0.9, domains: ["youtube.com", "reddit.com"] },
      { ...workflowEpisode("c2", 1, browsing), consumptionScore: 0.8, domains: ["youtube.com", "reddit.com"] }
    ];
    const passive = discoverCandidates(episodes, { now: 3 * DAY });
    expect(passive).toHaveLength(1);
    expect(passive[0]!.suppression.state).toBe("consumption_suppressed");
    expect(passive[0]!.suppression.reason).toMatch(/consumption/);
    const taught = discoverCandidates(episodes, { now: 3 * DAY, source: "taught" });
    expect(taught[0]!.suppression.state).toBe("active");
  });

  it("detects variables from route ids and differing labels", () => {
    const variant = [NOTES, COPY, OPEN, "app:chrome|domain:crm.example|route:/contact/:id|action:click|role:button|name:log-call", PASTE, SAVE];
    const [candidate] = discoverCandidates([workflowEpisode("v1", 0), workflowEpisode("v2", 1, variant)], { now: 3 * DAY });
    const names = candidate!.variables.map((variable) => variable.name);
    expect(names).toContain("contact_id");
    expect(candidate!.variables.find((variable) => variable.name === "contact_id")!.kind).toBe("person");
    expect(names).toContain("step4_target");
    const target = candidate!.variables.find((variable) => variable.name === "step4_target")!;
    expect(target.examples).toEqual(["log-activity", "log-call"]);
    expect(target.kind).toBe("text");
  });

  it("names the invoice-filing routine by its save, not the closing Cmd+W", () => {
    const filing = [
      "app:finder|action:activate",
      "app:finder|action:click|role:textbox|name:download-1-pdf",
      "app:preview|action:activate",
      "app:preview|action:shortcut|keys:cmd+w",
      "app:textedit|action:activate",
      "app:textedit|action:click|name:ledger-txt",
      "app:textedit|action:shortcut|keys:cmd+s",
      "app:textedit|action:shortcut|keys:cmd+w"
    ];
    const episodes = [0, 1].map((day) => ({ ...workflowEpisode(`f${day}`, day, filing), apps: ["finder", "preview", "textedit"], domains: [], meaningfulActionCount: 5 }));
    const [candidate] = discoverCandidates(episodes, { now: 3 * DAY });
    expect(candidate).toBeDefined();
    expect(candidate!.deterministicTitle).toBe("Save in TextEdit after opening 'download-1.pdf' in Finder");
    expect(candidate!.deterministicTitle).toMatch(/Save/);
    expect(candidate!.deterministicTitle).toMatch(/TextEdit/);
    expect(candidate!.deterministicTitle).toMatch(/Finder/);
    expect(candidate!.deterministicTitle).not.toMatch(/cmd\+w/i);
    expect(candidate!.expectedOutcome).toBe("Save");
    expect(candidate!.expectedOutcome).not.toMatch(/cmd\+w/i);
    expect(candidate!.trigger).toBe("Open 'download-1.pdf'");
    expect(candidate!.confidenceExplanation).toMatch(/ended with "Save"/);
  });

  it("falls back to the last non-closing step when no strong outcome exists", () => {
    const browse = ["app:finder|action:click|name:reports", "app:preview|action:click|name:next-page", "app:preview|action:shortcut|keys:cmd+w"];
    const episodes = [0, 1].map((day) => ({ ...workflowEpisode(`b${day}`, day, browse), apps: ["finder", "preview"], domains: [], meaningfulActionCount: 3 }));
    const [candidate] = discoverCandidates(episodes, { now: 3 * DAY });
    expect(candidate!.deterministicTitle).toBe("Click 'Next page' in Preview after clicking 'Reports' in Finder");
    expect(candidate!.expectedOutcome).toBe("Click 'Next page'");
  });

  it("marks external communication outcomes with the right risk class", () => {
    const send = [NOTES, COPY, "app:chrome|domain:mail.example|route:/compose|action:navigate", "app:chrome|domain:mail.example|route:/compose|action:paste", "app:chrome|domain:mail.example|route:/compose|action:form-submit|purpose:message"];
    const [candidate] = discoverCandidates([workflowEpisode("s1", 0, send), workflowEpisode("s2", 1, send)], { now: 3 * DAY });
    expect(candidate!.riskClass).toBe("external_communication");
    expect(candidate!.scoreComponents.lowRiskCoverage).toBeCloseTo(0.6, 6);
    expect(candidate!.confidenceExplanation).toMatch(/always ask first/);
  });
});

describe("consensus and helpers", () => {
  it("keeps tokens present in at least half of the sequences ordered by median position", () => {
    const steps = consensusSteps([["a", "b", "c"], ["a", "c"], ["a", "b", "c", "d"]]);
    expect(steps.map((step) => step.token)).toEqual(["a", "b", "c"]);
    expect(steps[1]!.occurrenceRatio).toBeCloseTo(0.667, 2);
    expect(consensusSteps([])).toEqual([]);
  });

  it("builds titles and variables", () => {
    expect(deterministicTitle(NOTES, SAVE)).toBe("Submit the update form in crm.example after clicking 'Meeting notes' in Notion");
    expect(deterministicTitle(LOG, LOG)).toBe("Click the 'Log activity' button in crm.example");
    expect(deterministicTitle(OPEN, SAVE)).toBe("Submit the update form after opening /contact/:id in crm.example");
    expect(deterministicTitle(undefined, SAVE)).toBe("Submit the update form in crm.example");
    expect(deterministicTitle(NOTES, undefined)).toBe("Click 'Meeting notes' in Notion");
    expect(deterministicTitle(undefined, undefined)).toBe("Repeated workflow");
    expect(deterministicTitle("app:some-tool|action:copy", "app:chrome|domain:mail.example|action:click|role:button|name:send")).toBe("Send in mail.example after copying to the clipboard in Some Tool");
    expect(routeVariables(["app:x|domain:crm.example|route:/deals/:id/items/:id|action:navigate"]).map((variable) => variable.name)).toEqual(["deals_id", "items_id"]);
    expect(routeVariables(["app:x|route:/deals/:id|action:navigate"])[0]!.kind).toBe("identifier");
    expect(alignedLabelVariables([["app:x|action:click|name:a"]])).toEqual([]);
    const amount = alignedLabelVariables([["app:x|action:click|name:total-usd"], ["app:x|action:click|name:total-eur"]]);
    expect(amount[0]!.kind).toBe("amount");
  });

  it("phrases outcomes and triggers", () => {
    expect(outcomePhrase("app:textedit|action:shortcut|keys:cmd+s")).toBe("Save");
    expect(outcomePhrase("app:slack|action:shortcut|keys:cmd+enter")).toBe("Submit");
    expect(outcomePhrase("app:textedit|action:shortcut|keys:cmd+w")).toBe("Press Cmd+W");
    expect(outcomePhrase("app:chrome|action:click|role:button|name:create-issue")).toBe("Create issue");
    expect(outcomePhrase("app:chrome|action:download|ext:pdf")).toBe("Download a .pdf file");
    expect(outcomePhrase("app:finder|action:click|role:row|name:report-pdf")).toBe("Open 'report.pdf'");
    expect(triggerPhrase("app:finder|action:click|role:textbox|name:download-1-pdf")).toBe("opening 'download-1.pdf'");
    expect(triggerPhrase("app:finder|action:click|role:button|name:save-pdf")).toBe("clicking the 'Save pdf' button");
    expect(triggerPhrase(LOG)).toBe("clicking the 'Log activity' button");
    expect(triggerPhrase(OPEN)).toBe("opening /contact/:id");
    expect(triggerPhrase(SAVE)).toBe("submitting the update form");
    expect(triggerPhrase("app:chrome|site:gmail|view:inbox|action:view")).toBe("opening Gmail inbox");
    expect(triggerPhrase("app:chrome|site:gmail|view:compose|action:view")).toBe("starting a new message in Gmail");
    expect(triggerPhrase("app:chrome|site:web|view:login|action:view")).toBe("signing in to web");
    expect(triggerPhrase("app:notion|action:shortcut|keys:cmd+shift+p")).toBe("pressing Cmd+Shift+P");
    expect(triggerPhrase("app:textedit|action:activate")).toBe("switching to TextEdit");
    expect(triggerPhrase("app:x|action:field-input|field:subject")).toBe("filling in 'Subject'");
  });

  it("computes confidence as the weighted mean", () => {
    expect(confidenceFromComponents({ sequenceSimilarity: 1, repeatCount: 1, triggerConsistency: 1, outcomeConsistency: 1, timeCost: 1, lowRiskCoverage: 1 })).toBe(1);
    expect(confidenceFromComponents({ sequenceSimilarity: 1, repeatCount: 0, triggerConsistency: 0, outcomeConsistency: 0, timeCost: 0, lowRiskCoverage: 0 })).toBe(0.35);
    const explanation = explainConfidence({ repeatCount: 2, components: { sequenceSimilarity: 0.84, repeatCount: 0.25, triggerConsistency: 1, outcomeConsistency: 1, timeCost: 0.3, lowRiskCoverage: 1 }, trigger: "opening meeting notes", outcome: "submitting a CRM form", riskClass: "internal_mutation" });
    expect(explanation).toBe('I observed a similar sequence 2 times. The steps matched closely (84%). Each time started with "opening meeting notes" and ended with "submitting a CRM form". All steps are low risk.');
  });
});
