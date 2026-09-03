import { describe, expect, it } from "vitest";
import { skillFromDraft, type CoreSkillDraft } from "@apprentice/core";
import { MockVisionAgentProvider, uimate, type VisionAgentProvider } from "@apprentice/model-adapters";
import { APP_BUNDLE_ID, type ApprovalRequest, type OcrBlock, type RunDetail, type Skill } from "@apprentice/schemas";
import { demoSkillTemplates, type ScenarioName } from "@apprentice/test-fixtures";
import { systemClock } from "../src/main/services/clock.js";
import { buildDemoScript } from "../src/main/services/demo/script-builder.js";
import { DemoActuator, DemoScreenSimulator } from "../src/main/services/demo/simulator.js";
import type { Emit } from "../src/main/services/events.js";
import { FakeHelperClient } from "../src/main/services/helper/fake-helper-client.js";
import { nodePngResizer } from "../src/main/services/images/png-resize.js";
import { silentLogger } from "../src/main/services/logger.js";
import type { ScreenSource } from "../src/main/services/observation/screen-source.js";
import { RunEngine } from "../src/main/services/runs/run-engine.js";
import type { AppActivator, OcrSource, RunContextSource } from "../src/main/services/runs/types.js";
import { fixtureTargets, fixtures, makeContext } from "./helpers.js";

const ORIGINAL = { width: 1440, height: 900 };
const RESIZED = uimate.processImageDims(ORIGINAL.width, ORIGINAL.height);

function templateSkill(scenario: ScenarioName, mode: Skill["policy"]["mode"] = "guide"): Skill {
  const template = demoSkillTemplates[scenario] as unknown as CoreSkillDraft;
  return skillFromDraft(template, { source: "demo", evidence: { episodeIds: [] }, mode });
}

type Verdict = "approve" | "reject" | "stop";

interface HarnessOptions {
  readonly scenario?: ScenarioName;
  readonly mode?: Skill["policy"]["mode"];
  readonly provider?: VisionAgentProvider;
  readonly ocr?: OcrSource;
  readonly context?: RunContextSource;
  readonly screen?: (simulator: DemoScreenSimulator) => ScreenSource;
  readonly onApproval?: (request: ApprovalRequest) => Verdict;
  /** Frontmost app and activation come from this fake helper instead of the simulator. */
  readonly helper?: FakeHelperClient;
  /** Called before a "Switch to ... and answer Continue" question is answered. */
  readonly onSwitchQuestion?: () => void;
}

function harness(options: HarnessOptions = {}) {
  const context = makeContext();
  const storage = context.storage;
  const scenario = options.scenario ?? "postMeetingFollowup";
  const skill = storage.current.skills.save(templateSkill(scenario, options.mode ?? "guide"));
  const targets = fixtureTargets();
  const simulator = new DemoScreenSimulator({ readPng: (name) => fixtures.readScreenshotPng(name), targets });
  const script = buildDemoScript(skill, { original: ORIGINAL, resized: RESIZED, targets }, scenario);
  simulator.loadTimeline(script.timeline);
  const provider = options.provider ?? new MockVisionAgentProvider({ script: script.script });
  const actuator = new DemoActuator(simulator);
  const approvals: ApprovalRequest[] = [];
  const questions: string[] = [];
  const raised: string[] = [];
  const helper = options.helper;
  const helperContext: RunContextSource | undefined = helper
    ? {
        frontmost: async () => {
          const ctx = await helper.frontmostContext();
          return { ...simulator.context(), bundleId: ctx.app.bundleId, appName: ctx.app.name };
        }
      }
    : undefined;
  const appActivator: AppActivator = helper ? { activate: (bundleId) => helper.activateApp(bundleId) } : { activate: async () => ({ activated: true }) };
  const emit: Emit = (name, payload) => {
    if (name === "event:approvalRequest") {
      const request = payload as ApprovalRequest;
      approvals.push(request);
      const verdict = options.onApproval?.(request) ?? "approve";
      queueMicrotask(() => {
        try {
          if (verdict === "stop") void engine.stop(request.runId, "ui_stop");
          else engine.approve(request.runId, request.stepId, verdict === "approve" ? "approved" : "rejected");
        } catch {
          // stale
        }
      });
    }
    if (name === "event:run") {
      const detail = (payload as { detail: RunDetail }).detail;
      if (detail.pendingQuestion) {
        const question = detail.pendingQuestion;
        questions.push(question.question);
        const switching = question.question.startsWith("Switch to ");
        queueMicrotask(() => {
          try {
            if (switching) options.onSwitchQuestion?.();
            engine.answer(detail.run.id, question.stepId, switching ? "Continue" : "yes", !switching);
          } catch {
            // answered
          }
        });
      }
    }
  };
  const engine: RunEngine = new RunEngine({
    storage,
    settings: context.settings,
    sessionId: context.sessionId,
    screenSource: options.screen ? options.screen(simulator) : simulator,
    actuator: () => actuator,
    approvalSecret: () => "ab".repeat(32),
    context: options.context ?? helperContext ?? { frontmost: async () => simulator.context() },
    appActivator,
    raiseWindow: (runId) => raised.push(runId),
    activationWaitMs: 30,
    activationPollMs: 5,
    ocr: options.ocr ?? { ocr: async (_png, width, height) => simulator.ocrBlocks(width, height) },
    ax: { elementAt: async () => null },
    dom: { query: async (marker) => ({ marker, present: simulator.state().domMarkers.includes(marker) }) },
    model: { propose: (input) => provider.proposeNextAction(input), verify: (input) => provider.verifyStep(input), resetSession: (id) => provider.resetSession(id), providerType: () => "mock", modelName: () => "mock" },
    resizer: nodePngResizer,
    emit,
    analytics: context.analytics,
    metrics: context.metrics,
    clock: systemClock,
    logger: silentLogger,
    hooks: { onSubtaskAdvance: (_runId, index) => simulator.advanceToSubtask(index) },
    settleMs: 0,
    domQueryTimeoutMs: 50
  });
  const run = async (mode?: Skill["policy"]["mode"]) => {
    const started = await engine.start(skill.id, mode ?? options.mode);
    const finished = await engine.waitForCompletion(started.id);
    return { run: finished, steps: storage.current.runs.steps(started.id) };
  };
  return { engine, simulator, approvals, questions, raised, storage, skill, context, targets, run };
}

const UNRELATED_APP = "com.example.Unrelated";
const CHROME = "com.google.Chrome";

/** Fake helper whose frontmost app is a mutable value; `activateApp` switches it only when `activationWorks`. */
function focusHelper(initial: string, activationWorks: boolean) {
  const state = { frontmost: initial };
  const helper = new FakeHelperClient({
    frontmost: () => ({ app: { bundleId: state.frontmost, name: state.frontmost.split(".").pop() ?? state.frontmost, pid: 7 }, isSecureInput: false, isFullscreen: false, displayScale: 1 }),
    activate: (bundleId) => {
      if (activationWorks) state.frontmost = bundleId;
      return { activated: activationWorks, pid: activationWorks ? 8 : undefined };
    }
  });
  void helper.start();
  return { helper, state };
}

function labelOcr(targetTemplate: string, text: string, targets: ReturnType<typeof fixtureTargets>): OcrSource {
  const target = targets[targetTemplate]!;
  return {
    ocr: async (_png, width, height) => {
      const block: OcrBlock = { text, x: (target.x * width) / ORIGINAL.width - 40, y: (target.y * height) / ORIGINAL.height - 10, width: 80, height: 20, confidence: 0.9 };
      return [block];
    }
  };
}

describe("run engine", () => {
  it("completes a guided mock run over the demo simulator with risk, approval, and verification on every executed step", async () => {
    const h = harness();
    const { run, steps } = await h.run();
    expect(run.status).toBe("completed");
    expect(run.currentSubtaskIndex).toBe(h.skill.subtasks.length - 1);
    const executed = steps.filter((step) => step.executed !== null);
    expect(executed.length).toBeGreaterThanOrEqual(5);
    for (const step of executed) {
      expect(step.risk).not.toBeNull();
      expect(step.approval?.decision).toBe("approved");
      expect(step.verification).not.toBeNull();
      expect(step.validation?.ok).toBe(true);
      expect(Number.isInteger(step.timing.totalMs)).toBe(true);
    }
    expect(steps.filter((step) => step.verification?.subtaskComplete === true).length).toBe(h.skill.subtasks.length);
    expect(run.metrics.approvedActions).toBe(executed.length);
    expect(run.metrics.steps).toBe(steps.length);
    expect(h.approvals[0]?.screenshotPngBase64.length).toBeGreaterThan(100);
    expect(h.approvals.some((request) => request.proposed.type === "type_text")).toBe(true);
    expect(h.simulator.performed.length).toBe(executed.length);
    expect(h.storage.current.screenshots.count()).toBeGreaterThan(0);
    expect(h.context.storage.current.productEvents.countByName("run_completed")).toBe(1);
    expect(JSON.stringify(steps)).not.toContain("<think>");
  }, 30_000);

  it("stops with user_rejected when the first proposal is rejected", async () => {
    const h = harness({ onApproval: () => "reject" });
    const { run, steps } = await h.run();
    expect(run.status).toBe("failed");
    expect(run.failureCategory).toBe("user_rejected");
    expect(steps[0]?.approval?.decision).toBe("rejected");
    expect(run.metrics.rejectedActions).toBe(1);
    expect(h.simulator.performed).toHaveLength(0);
    expect(h.context.storage.current.productEvents.countByName("action_rejected")).toBe(1);
  });

  it("stop() interrupts a run that is waiting for approval", async () => {
    const h = harness({ onApproval: () => "stop" });
    const { run } = await h.run();
    expect(run.status).toBe("interrupted");
    expect(run.interruptedBy).toBe("ui_stop");
    expect(run.failureCategory).toBe("user_interrupted");
    expect(h.engine.isActive()).toBe(false);
    expect(h.context.storage.current.productEvents.countByName("run_interrupted")).toBe(1);
  });

  it("classifies a destructive-looking target as approve_strong", async () => {
    const targets = fixtureTargets();
    const h = harness({ scenario: "candidateReview", ocr: labelOcr("atsCandidate", "Delete contact", targets), onApproval: () => "stop" });
    const { run } = await h.run();
    expect(h.approvals[0]?.risk.riskClass).toBe("destructive");
    expect(h.approvals[0]?.risk.decision).toBe("approve_strong");
    expect(h.approvals[0]?.target?.label).toBe("Delete contact");
    expect(run.status).toBe("interrupted");
  });

  it("aborts as unsupported policy on a financial target without executing", async () => {
    const targets = fixtureTargets();
    const h = harness({ scenario: "candidateReview", ocr: labelOcr("atsCandidate", "Pay now", targets) });
    const { run, steps } = await h.run();
    expect(run.status).toBe("aborted_policy");
    expect(run.failureCategory).toBe("policy_blocked");
    expect(steps[0]?.risk?.riskClass).toBe("financial_or_access");
    expect(h.approvals).toHaveLength(0);
    expect(h.simulator.performed).toHaveLength(0);
  });

  it("aborts on a sensitive context before proposing", async () => {
    const h = harness({ context: { frontmost: async () => ({ bundleId: "com.google.Chrome", windowTitle: "Sign in to your account", isSecureInput: false }) } });
    const { run } = await h.run();
    expect(run.status).toBe("aborted_sensitive");
    expect(run.failureCategory).toBe("sensitive_context");
    expect(h.approvals).toHaveLength(0);
  });

  it("refuses a stale screen when the display changes between proposal and execution", async () => {
    const h = harness({
      scenario: "candidateReview",
      screen: (simulator) => {
        let captures = 0;
        return {
          captureFrontmost: async () => {
            captures += 1;
            simulator.setTemplate(captures % 2 === 0 ? "notesPage" : "atsCandidate");
            return simulator.captureFrontmost();
          }
        };
      }
    });
    const { run, steps } = await h.run();
    expect(run.status).toBe("failed");
    expect(run.failureCategory).toBe("stale_screen");
    expect(steps.length).toBe(2);
    expect(steps.every((step) => step.failureCategory === "stale_screen")).toBe(true);
    expect(h.approvals).toHaveLength(0);
    expect(h.simulator.performed).toHaveLength(0);
  });

  it("rejects shell-like model output as invalid_action", async () => {
    const shellLike: VisionAgentProvider = {
      health: async () => ({ ok: true, provider: "mock", capabilities: { vision: true, actionPolicy: true, structuredOutput: true }, checkedAt: Date.now() }),
      analyzeEpisode: () => Promise.reject(new Error("unused")),
      draftSkill: () => Promise.reject(new Error("unused")),
      proposeNextAction: async () => ({ action: null, actionSummary: "run shell", rationale: "", parseErrors: ["unsupported tool call: bash(rm -rf ~)"], latencyMs: 1, provider: "mock" }),
      verifyStep: async () => ({ passed: false, subtaskComplete: false, method: "none", evidence: "", confidence: 0 }),
      resetSession: async () => undefined
    };
    const h = harness({ provider: shellLike });
    const { run, steps } = await h.run();
    expect(run.status).toBe("failed");
    expect(run.failureCategory).toBe("invalid_action");
    expect(steps.every((step) => step.failureCategory === "invalid_action")).toBe(true);
    expect(h.approvals).toHaveLength(0);
    expect(h.simulator.performed).toHaveLength(0);
  });

  it("suggest_only shows proposals but never executes", async () => {
    const h = harness({ mode: "suggest_only" });
    const { run, steps } = await h.run("suggest_only");
    expect(h.approvals.length).toBeGreaterThan(0);
    expect(h.simulator.performed).toHaveLength(0);
    expect(steps.every((step) => step.executed === null)).toBe(true);
    expect(["completed", "failed"]).toContain(run.status);
  }, 30_000);
});

describe("run engine target app focus", () => {
  it("activates the target app when Apprentice is frontmost at start and again after every approval click", async () => {
    const { helper, state } = focusHelper(APP_BUNDLE_ID, true);
    const h = harness({
      helper,
      onApproval: () => {
        state.frontmost = APP_BUNDLE_ID;
        return "approve";
      }
    });
    const { run, steps } = await h.run();
    expect(run.status).toBe("completed");
    expect(helper.activations[0]).toBe(CHROME);
    expect(helper.activations.every((bundleId) => bundleId === CHROME)).toBe(true);
    expect(helper.activations.length).toBeGreaterThanOrEqual(h.approvals.length + 1);
    expect(h.questions).toHaveLength(0);
    expect(steps.some((step) => step.failureCategory === "policy_blocked")).toBe(false);
    expect(h.simulator.performed.length).toBe(steps.filter((step) => step.executed !== null).length);
  }, 30_000);

  it("asks the user to switch when an unrelated app is frontmost and resumes once they did", async () => {
    const { helper, state } = focusHelper(UNRELATED_APP, false);
    const h = harness({
      helper,
      onSwitchQuestion: () => {
        state.frontmost = CHROME;
      }
    });
    const { run } = await h.run();
    expect(h.questions[0]).toBe("Switch to Google Chrome and answer Continue");
    expect(helper.activations).toHaveLength(0);
    expect(run.status).toBe("completed");
    expect(h.raised).toContain(run.id);
    expect(h.context.storage.current.productEvents.countByName("run_completed")).toBe(1);
  }, 30_000);

  it("aborts by policy only when the app is still not allowed after the user answered", async () => {
    const { helper } = focusHelper(UNRELATED_APP, false);
    const h = harness({ helper });
    const { run, steps } = await h.run();
    expect(h.questions).toEqual(["Switch to Google Chrome and answer Continue"]);
    expect(helper.activations).toEqual([CHROME]);
    expect(run.status).toBe("aborted_policy");
    expect(run.failureCategory).toBe("policy_blocked");
    expect(run.summary).toContain(UNRELATED_APP);
    expect(steps[0]?.failureCategory).toBe("policy_blocked");
    expect(h.approvals).toHaveLength(0);
    expect(h.simulator.performed).toHaveLength(0);
  });

  it("switches the target when a subtask names another allowed app", async () => {
    const { helper } = focusHelper(APP_BUNDLE_ID, true);
    const h = harness({ helper, scenario: "invoiceProcessing" });
    const { run } = await h.run();
    expect(run.status).toBe("completed");
    const order = [...new Set(helper.activations)];
    expect(order).toEqual([CHROME, "com.apple.Preview", "com.apple.finder"]);
    expect(h.questions).toHaveLength(0);
  }, 30_000);

  it("raises the Apprentice window for every approval request", async () => {
    const h = harness();
    const { run } = await h.run();
    expect(run.status).toBe("completed");
    expect(h.approvals.length).toBeGreaterThan(0);
    expect(h.raised.length).toBeGreaterThanOrEqual(h.approvals.length);
    expect(h.raised.every((id) => id === run.id)).toBe(true);
  }, 30_000);
});
