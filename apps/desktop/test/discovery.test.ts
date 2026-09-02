import { describe, expect, it } from "vitest";
import { generateConsumptionEpisode } from "@apprentice/test-fixtures";
import type { Run } from "@apprentice/schemas";
import { systemClock } from "../src/main/services/clock.js";
import { CandidateActions } from "../src/main/services/discovery/candidate-actions.js";
import { DiscoveryScheduler, readNeverLearnKeys } from "../src/main/services/discovery/scheduler.js";
import { createRecordingEmitter } from "../src/main/services/events.js";
import { silentLogger } from "../src/main/services/logger.js";
import { makeContext, scenarioEvents } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const context = makeContext();
  const recorder = createRecordingEmitter();
  const scheduler = new DiscoveryScheduler({ storage: context.storage, emit: recorder.emit, analytics: context.analytics, clock: systemClock, logger: silentLogger });
  return { context, recorder, scheduler };
}

describe("discovery scheduler", () => {
  it("turns two fixture occurrences of one scenario into an active candidate", () => {
    const { context, scheduler, recorder } = setup();
    const now = Date.now();
    context.storage.current.events.insertMany([...scenarioEvents("postMeetingFollowup", 1, "s1", now - 2 * DAY), ...scenarioEvents("postMeetingFollowup", 2, "s2", now - DAY)]);
    const result = scheduler.runNow();
    expect(result.episodes).toBeGreaterThanOrEqual(2);
    expect(result.candidates).toBeGreaterThanOrEqual(1);
    const candidate = context.storage.current.candidates.list(false)[0]!;
    expect(candidate.repeatCount).toBe(2);
    expect(candidate.evidenceEpisodeIds).toHaveLength(2);
    expect(candidate.steps.length).toBeGreaterThanOrEqual(3);
    expect(recorder.of("event:candidate")).toHaveLength(result.newCandidates.length);
    expect(context.storage.current.productEvents.countByName("candidate_generated")).toBe(result.newCandidates.length);
    const again = scheduler.runNow();
    expect(again.newCandidates).toHaveLength(0);
    expect(context.storage.current.candidates.list(false)).toHaveLength(result.candidates);
  });

  it("yields three candidates for three different scenarios and none for consumption episodes", () => {
    const { context, scheduler } = setup();
    const now = Date.now();
    const events = (["postMeetingFollowup", "invoiceProcessing", "candidateReview"] as const).flatMap((scenario, index) => [
      ...scenarioEvents(scenario, 1, `${scenario}-a`, now - (6 - index) * DAY),
      ...scenarioEvents(scenario, 2, `${scenario}-b`, now - (3 - index) * DAY)
    ]);
    context.storage.current.events.insertMany(events);
    expect(scheduler.runNow().candidates).toBe(3);

    const consumption = setup();
    const filler = [1, 2, 3].map((occurrence) => generateConsumptionEpisode({ seed: 42, occurrence, variant: occurrence, startTs: now - occurrence * DAY, sessionId: `c${occurrence}`, seqStart: 0 }));
    consumption.context.storage.current.events.insertMany(filler.flatMap((episode) => episode.events));
    expect(consumption.scheduler.runNow().candidates).toBe(0);
  });
});

describe("candidate actions", () => {
  function withCandidate() {
    const { context, scheduler } = setup();
    const now = Date.now();
    context.storage.current.events.insertMany([...scenarioEvents("invoiceProcessing", 1, "s1", now - 2 * DAY), ...scenarioEvents("invoiceProcessing", 2, "s2", now - DAY)]);
    scheduler.runNow();
    const candidate = context.storage.current.candidates.list(false)[0]!;
    const started: string[] = [];
    const actions = new CandidateActions({
      storage: context.storage,
      analytics: context.analytics,
      clock: systemClock,
      startRun: async (skillId) => {
        started.push(skillId);
        return { id: "run_test", skillId, skillVersion: 1, skillName: "x", mode: "guide", status: "running", currentSubtaskIndex: 0, subtaskCount: 1, startedAt: now, failureCategory: "none", provider: "mock", metrics: { steps: 0, approvedActions: 0, rejectedActions: 0, corrections: 0, modelLatencyMsTotal: 0, modelLatencyMsMax: 0, screenshotsUsed: 0 }, lowRiskRunApproval: false, navigationRunApproval: false, summary: "" } satisfies Run;
      }
    });
    return { context, scheduler, candidate, actions, started };
  }

  it("suppression actions update state and never_learn prevents regeneration", async () => {
    const { context, scheduler, candidate, actions } = withCandidate();
    const notUseful = await actions.act(candidate.id, "not_useful");
    expect(notUseful.candidate.suppression.state).toBe("not_useful");
    expect(context.storage.current.candidates.list(false)).toHaveLength(0);
    const never = await actions.act(candidate.id, "never_learn");
    expect(never.candidate.suppression.state).toBe("never_learn");
    expect(readNeverLearnKeys(context.storage).has(candidate.patternKey)).toBe(true);
    context.storage.current.candidates.delete(candidate.id);
    scheduler.runNow();
    expect(context.storage.current.candidates.byPatternKey(candidate.patternKey)).toBeNull();
    expect(context.storage.current.productEvents.countByName("candidate_rejected")).toBe(2);
  });

  it("try_once converts the candidate into a skill and starts a run", async () => {
    const { context, candidate, actions, started } = withCandidate();
    const draft = actions.draft(candidate.id);
    expect(draft.subtasks.length).toBeGreaterThan(0);
    const result = await actions.act(candidate.id, "try_once");
    expect(result.skill?.source).toBe("candidate");
    expect(result.skill?.evidence.candidateId).toBe(candidate.id);
    expect(result.skill?.evidence.episodeIds).toEqual(candidate.evidenceEpisodeIds);
    expect(result.run?.id).toBe("run_test");
    expect(started).toEqual([result.skill?.id]);
    expect(result.candidate.suppression.state).toBe("converted");
    expect(context.storage.current.skills.getCurrent(result.skill!.id)?.version).toBe(1);
    expect(context.storage.current.productEvents.countByName("candidate_accepted")).toBe(1);
  });
});
