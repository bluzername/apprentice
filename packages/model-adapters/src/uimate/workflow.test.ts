import { describe, expect, it } from "vitest";
import {
  INITIAL_WORKFLOW_POINTER,
  TURN_REMINDER_LINE,
  buildGuidance,
  buildTurnReminder,
  detectSubtaskComplete,
  planFromSkillSubtasks,
  workflowAfterPredict,
  type WorkflowPlan,
  type WorkflowPointerState,
  WORKFLOW_SYSTEM_SECTION
} from "./workflow.js";
import { readGoldenJson } from "../testing/golden.js";

interface GuidanceGolden {
  readonly plan: readonly { title: string; goal: string; completionFlag: string; keySteps: readonly string[] }[];
  readonly guidance: readonly string[];
}

interface DetectCase {
  readonly text: string;
  readonly detected: boolean;
}

interface PointerStep {
  readonly index: number;
  readonly awaitFinish: boolean;
  readonly actions: readonly string[];
}

interface ParseCase {
  readonly name: string;
  readonly response: string;
}

function loadPlan(): WorkflowPlan {
  const golden = readGoldenJson<GuidanceGolden>("guidance.json");
  return { subtasks: golden.plan.map((s) => ({ ...s })) };
}

function responseNamed(name: string): string {
  const cases = readGoldenJson<readonly ParseCase[]>("parse_response_cases.json");
  const found = cases.find((c) => c.name === name);
  if (!found) {
    throw new Error(`missing parse case ${name}`);
  }
  return found.response;
}

describe("buildGuidance (byte parity with build_guidance)", () => {
  it("matches the Python rendering for every pointer position", () => {
    const golden = readGoldenJson<GuidanceGolden>("guidance.json");
    const plan = loadPlan();
    golden.guidance.forEach((expected, index) => {
      expect(buildGuidance(plan, index)).toBe(expected);
    });
  });

  it("renders the markers in the workflow section verbatim", () => {
    expect(WORKFLOW_SYSTEM_SECTION).toContain("(【✅】completed, 【➡️】current, 【 】upcoming)");
    expect(WORKFLOW_SYSTEM_SECTION).toContain("\u2014");
  });

  it("rejects an out-of-range index and an empty plan", () => {
    expect(() => buildGuidance(loadPlan(), 3)).toThrow(RangeError);
    expect(() => planFromSkillSubtasks([])).toThrow(RangeError);
  });
});

describe("buildTurnReminder (deviation: subtask context on every turn)", () => {
  it("names the current subtask, its completion flag and the two legal responses", () => {
    const plan = planFromSkillSubtasks([
      { title: "Open the contact", goal: "Open it", completionCriteria: "The contact page is open", keySteps: [] },
      { title: "Log the activity", goal: "Log it", completionCriteria: "The activity shows in the timeline", keySteps: [] }
    ]);
    const reminder = buildTurnReminder(plan, 1);
    expect(reminder).toBe(
      [
        "<current_subtask_reminder>",
        "index: 1 of 2",
        "intent_summary: Log the activity",
        "subtask_complete_flag: The activity shows in the timeline",
        "</current_subtask_reminder>",
        TURN_REMINDER_LINE
      ].join("\n")
    );
    expect(TURN_REMINDER_LINE).toContain("subtask_complete");
    expect(buildTurnReminder(plan, 0)).toContain("index: 0 of 2");
  });

  it("omits an empty intent summary and rejects an out-of-range index", () => {
    const plan = planFromSkillSubtasks([{ title: "", goal: "G", completionCriteria: "C", keySteps: [] }]);
    expect(buildTurnReminder(plan, 0)).not.toContain("intent_summary");
    expect(() => buildTurnReminder(plan, 1)).toThrow(RangeError);
  });

  it("maps skill subtasks onto the demonstration plan", () => {
    const plan = planFromSkillSubtasks([
      { title: "T", goal: "G", completionCriteria: "C", keySteps: ["k1"] }
    ]);
    expect(plan.subtasks[0]).toEqual({ title: "T", goal: "G", completionFlag: "C", keySteps: ["k1"] });
  });
});

describe("detectSubtaskComplete", () => {
  it("matches the Python patterns on the golden cases", () => {
    const cases = readGoldenJson<readonly DetectCase[]>("detect_subtask_complete_cases.json");
    expect(cases.length).toBeGreaterThan(5);
    for (const c of cases) {
      expect(detectSubtaskComplete(c.text), JSON.stringify(c.text)).toBe(c.detected);
    }
  });
});

describe("workflowAfterPredict (pure DemoWorkflow.after_predict)", () => {
  function replay(events: readonly (readonly [string, readonly string[]])[]): readonly PointerStep[] {
    const plan = loadPlan();
    const out: PointerStep[] = [];
    let state: WorkflowPointerState = INITIAL_WORKFLOW_POINTER;
    for (const [response, actions] of events) {
      const result = workflowAfterPredict(plan, state, response, actions);
      state = { index: result.nextIndex, awaitFinish: result.awaitFinish };
      out.push({ index: state.index, awaitFinish: state.awaitFinish, actions: [...result.actions] });
    }
    return out;
  }

  it("matches the golden pointer transitions", () => {
    const golden = readGoldenJson<Record<string, readonly PointerStep[]>>("workflow_pointer.json");
    const sc = responseNamed("subtask_complete");
    const click = responseNamed("click");
    const clickCode = ["pyautogui.click(1, 1)"];
    expect(replay([[click, clickCode], [sc, ["WAIT"]], [sc, ["WAIT"]], [sc, ["WAIT"]], [click, clickCode], [sc, ["WAIT"]]])).toEqual(golden["completeChain"]);
    expect(replay([[click, ["DONE"]], [click, ["DONE"]], [click, ["DONE"]]])).toEqual(golden["earlyDone"]);
    expect(replay([[sc, ["WAIT"]], [sc, ["WAIT"]], [sc, ["WAIT"]], [click, clickCode], [sc, ["WAIT"]]])).toEqual(golden["resetAwait"]);
  });

  it("flags detection and early-done rewrites without mutating state", () => {
    const plan = loadPlan();
    const state: WorkflowPointerState = { index: 0, awaitFinish: false };
    const result = workflowAfterPredict(plan, state, responseNamed("click"), ["DONE"]);
    expect(result.earlyDoneRewritten).toBe(true);
    expect(result.subtaskCompleteDetected).toBe(false);
    expect(state).toEqual({ index: 0, awaitFinish: false });
  });
});
