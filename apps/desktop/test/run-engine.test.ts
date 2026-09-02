import { describe, expect, it } from "vitest";
import { skillFromDraft, type CoreSkillDraft } from "@apprentice/core";
import { MockVisionAgentProvider, uimate, type VisionAgentProvider } from "@apprentice/model-adapters";
import type { ApprovalRequest, OcrBlock, RunDetail, Skill } from "@apprentice/schemas";
import { demoSkillTemplates, type ScenarioName } from "@apprentice/test-fixtures";
import { systemClock } from "../src/main/services/clock.js";
import { buildDemoScript } from "../src/main/services/demo/script-builder.js";
import { DemoActuator, DemoScreenSimulator } from "../src/main/services/demo/simulator.js";
import type { Emit } from "../src/main/services/events.js";
import { nodePngResizer } from "../src/main/services/images/png-resize.js";
import { silentLogger } from "../src/main/services/logger.js";
import type { ScreenSource } from "../src/main/services/observation/screen-source.js";
import { RunEngine } from "../src/main/services/runs/run-engine.js";
import type { OcrSource, RunContextSource } from "../src/main/services/runs/types.js";
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
        queueMicrotask(() => {
          try {
            engine.answer(detail.run.id, question.stepId, "yes", true);
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
    context: options.context ?? { frontmost: async () => simulator.context() },
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
  return { engine, simulator, approvals, storage, skill, context, targets, run };
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
