import { describe, expect, it } from "vitest";
import { EpisodeAnalysisSchema, ProposedActionResultSchema, type NextActionInput, type SkillDraft } from "@apprentice/schemas";
import { MockVisionAgentProvider, improveTitle, parseActionToken } from "./mock-provider.js";

const TOKENS = [
  "app:chrome|domain:crm.example|route:/contact/:id|action:click|role:button|name:log-activity",
  "app:chrome|domain:crm.example|route:/contact/:id/activity|action:type|role:textbox|name:notes",
  "app:chrome|domain:mail.example|route:/compose|action:form-submit|purpose:message",
  "app:notion|action:shortcut|keys:cmd+shift+p"
];

function nextInput(runId: string, subtask: number, overrides: Partial<NextActionInput> = {}): NextActionInput {
  return {
    runId,
    sessionId: "session_1",
    instruction: "Do the thing",
    skill: {
      name: "Post-meeting CRM update",
      subtasks: [
        { title: "Open contact", goal: "Open the contact", completionCriteria: "Contact page visible", keySteps: ["Click the search box"] },
        { title: "Log activity", goal: "Log the activity", completionCriteria: "Activity listed", keySteps: [] }
      ]
    },
    currentSubtaskIndex: subtask,
    priorActions: [],
    screenshot: { id: "shot_1", pngBase64: "AAAA", width: 1280, height: 800 },
    platform: "macos",
    variables: {},
    ...overrides
  };
}

describe("MockVisionAgentProvider", () => {
  it("reports healthy", async () => {
    const health = await new MockVisionAgentProvider({ now: () => 5 }).health();
    expect(health).toMatchObject({ ok: true, provider: "mock", checkedAt: 5 });
  });

  it("derives a schema-valid episode analysis from action tokens", async () => {
    const analysis = await new MockVisionAgentProvider().analyzeEpisode({
      episodeId: "ep_1",
      redactedSummary: "summary",
      actionTokens: TOKENS,
      apps: ["chrome", "notion"],
      domains: ["crm.example", "mail.example"],
      activeDurationMs: 120000,
      screenshots: []
    });
    expect(EpisodeAnalysisSchema.safeParse(analysis).success).toBe(true);
    expect(analysis.stepGroups.map((g) => g.tokenIndexes)).toEqual([[0, 1], [2], [3]]);
    expect(analysis.variables.map((v) => v.name)).toEqual(["id"]);
    expect(analysis.suggestedSkillName).toBe("Click log-activity to shortcut notion");
    expect(analysis.successCriteria).toEqual(["form-submit /compose completed"]);
    expect(analysis.riskNotes).toHaveLength(1);
    expect(analysis.provider).toBe("mock");
    expect(parseActionToken(TOKENS[0] ?? "")).toMatchObject({ app: "chrome", domain: "crm.example", route: "/contact/:id", name: "log-activity" });
  });

  it("returns a model_refined draft with an improved title and the same subtasks", async () => {
    const draft: SkillDraft = {
      name: "post-meeting crm update",
      description: "",
      goal: "",
      trigger: "after a meeting",
      subtasks: [{ title: "open crm contact", goal: "g", completionCriteria: "c", keySteps: [] }],
      variables: [],
      successCriteria: [],
      riskNotes: [],
      allowedApps: [],
      allowedDomains: [],
      origin: "deterministic",
      confidence: 0.5
    };
    const refined = await new MockVisionAgentProvider().draftSkill({ deterministicDraft: draft, redactedSummary: "", actionTokens: [], screenshots: [] });
    expect(refined.name).toBe("Post-meeting CRM update");
    expect(refined.origin).toBe("model_refined");
    expect(refined.subtasks).toHaveLength(1);
    expect(refined.subtasks[0]?.title).toBe("Open CRM contact");
    expect(improveTitle("  export   PDF report ")).toBe("Export PDF report");
  });

  it("walks click -> SUBTASK_COMPLETE per subtask and DONE after the final subtask", async () => {
    const provider = new MockVisionAgentProvider();
    const first = await provider.proposeNextAction(nextInput("run_1", 0));
    expect(first.action).toMatchObject({ type: "click", x: 640, y: 400, purpose: "Click the search box", subtaskIndex: 0 });
    expect(first.action?.sourceScreenshot).toEqual({ screenshotId: "shot_1", width: 1280, height: 800 });
    expect(ProposedActionResultSchema.safeParse(first).success).toBe(true);

    const second = await provider.proposeNextAction(nextInput("run_1", 0));
    expect(second).toMatchObject({ action: null, controlToken: "SUBTASK_COMPLETE", subtaskCompleteEvidence: "Contact page visible" });

    const third = await provider.proposeNextAction(nextInput("run_1", 1));
    expect(third.action).toMatchObject({ type: "click", purpose: "Log the activity", subtaskIndex: 1 });
    const fourth = await provider.proposeNextAction(nextInput("run_1", 1));
    expect(fourth.controlToken).toBe("SUBTASK_COMPLETE");
    const fifth = await provider.proposeNextAction(nextInput("run_1", 1));
    expect(fifth.controlToken).toBe("DONE");
    expect(fifth.action?.type).toBe("done");

    const otherRun = await provider.proposeNextAction(nextInput("run_2", 0));
    expect(otherRun.action?.type).toBe("click");
  });

  it("honours resetSession by runId and by sessionId", async () => {
    const provider = new MockVisionAgentProvider();
    await provider.proposeNextAction(nextInput("run_1", 0));
    await provider.resetSession("run_1");
    expect((await provider.proposeNextAction(nextInput("run_1", 0))).action?.type).toBe("click");
    await provider.proposeNextAction(nextInput("run_1", 0));
    await provider.resetSession("session_1");
    expect((await provider.proposeNextAction(nextInput("run_1", 0))).action?.type).toBe("click");
  });

  it("plays a configured script", async () => {
    const provider = new MockVisionAgentProvider({
      script: [[{ action: null, actionSummary: "scripted", rationale: "r", controlToken: "FAIL", parseErrors: ["bad"], latencyMs: 7 }]]
    });
    const result = await provider.proposeNextAction(nextInput("run_1", 0));
    expect(result).toMatchObject({ controlToken: "FAIL", latencyMs: 7, provider: "mock", parseErrors: ["bad"] });
    const fallthrough = await provider.proposeNextAction(nextInput("run_1", 0));
    expect(fallthrough.controlToken).toBe("SUBTASK_COMPLETE");
  });

  it("verifies a step only when the screenshot changed", async () => {
    const provider = new MockVisionAgentProvider();
    const base = { runId: "run_1", expectedResult: "x", completionCriteria: "y" };
    const changed = await provider.verifyStep({ ...base, before: { pngBase64: "A", width: 1, height: 1 }, after: { pngBase64: "B", width: 1, height: 1 } });
    expect(changed).toMatchObject({ passed: true, method: "model_supporting", confidence: 0.6, subtaskComplete: false });
    const same = await provider.verifyStep({ ...base, before: { pngBase64: "A", width: 1, height: 1 }, after: { pngBase64: "A", width: 1, height: 1 } });
    expect(same.passed).toBe(false);
    const noBefore = await provider.verifyStep({ ...base, after: { pngBase64: "A", width: 1, height: 1 } });
    expect(noBefore.passed).toBe(false);
  });
});
