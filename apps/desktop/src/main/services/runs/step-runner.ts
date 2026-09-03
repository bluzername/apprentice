import { applyPolicy, classifyRisk, detectSensitiveContext, geometryMatches, isDomainAllowed, isStaleScreen, resolveTarget, toExecutableAction, validateProposedAction } from "@apprentice/core";
import type { ApprovalRequest, ApprovalResult, ExecutableAction, FailureCategory, ProposedAction, ProposedActionResult, RiskResult, Run, RunStatus, RunStep, Skill } from "@apprentice/schemas";
import { mintApprovalToken } from "../helper/approval-token.js";
import { InferenceCancelledError } from "../model/inference-queue.js";
import { appAllowed } from "./app-focus.js";
import { ensureTargetFrontmost, syncTargetWithSubtask } from "./focus-guard.js";
import { addModelLatency, bumpMetrics, failStep, stepWithTiming } from "./run-state.js";
import { takeSnapshot, type ScreenSnapshot } from "./snapshot.js";
import { subtaskSatisfied, userConfirmedVerification, verifyDeterministic } from "./verification.js";
import type { RunEngineDeps, StopReason } from "./types.js";

export interface PriorAction {
  readonly stepIndex: number;
  readonly summary: string;
}

/** Mutable per-run holder; the Run and RunStep values inside are replaced, never mutated. */
export interface ActiveRun {
  run: Run;
  steps: RunStep[];
  readonly skill: Skill;
  readonly variables: Record<string, string>;
  priorActions: PriorAction[];
  consecutive: { stale: number; invalid: number; verifyFail: number };
  subtaskVerified: boolean;
  lastSnapshot?: ScreenSnapshot;
  stopRequested: StopReason | null;
  /** Bundle id of the app the run acts on; re-activated before every capture and execution. */
  targetBundleId: string | undefined;
}

export type StepOutcome = { readonly kind: "continue" } | { readonly kind: "finish"; readonly status: RunStatus; readonly failureCategory?: FailureCategory; readonly interruptedBy?: Run["interruptedBy"]; readonly summary?: string };

export type ApprovalResolution = { readonly decision: "approved" | "rejected" | "timed_out" | "interrupted"; readonly scope: "once" | "run_low_risk" };
export type QuestionAnswer = { readonly answer: string; readonly confirmSubtask: boolean } | null;

export interface RunnerHost {
  readonly deps: RunEngineDeps;
  awaitApproval(active: ActiveRun, step: RunStep, request: ApprovalRequest): Promise<ApprovalResolution>;
  awaitQuestion(active: ActiveRun, step: RunStep, question: string): Promise<QuestionAnswer>;
  persistStep(active: ActiveRun, step: RunStep): void;
}

const MAX_CONSECUTIVE_STALE = 2;
const MAX_CONSECUTIVE_INVALID = 2;
const MAX_CONSECUTIVE_VERIFY_FAIL = 3;
const NEAR_TARGET_PX = 60;
const DEFAULT_SETTLE_MS = 600;
const DEFAULT_DOM_TIMEOUT_MS = 3000;

function finish(status: RunStatus, failureCategory?: FailureCategory, summary?: string, interruptedBy?: Run["interruptedBy"]): StepOutcome {
  return { kind: "finish", status, failureCategory, summary, interruptedBy };
}

function domainAllowed(skill: Skill, domain: string | undefined): boolean {
  if (skill.allowedDomains.length === 0 || domain === undefined) return true;
  return isDomainAllowed(domain, skill.allowedDomains, []);
}

function hasPoint(action: ProposedAction): action is Extract<ProposedAction, { x: number; y: number }> {
  return action.type === "click" || action.type === "double_click" || action.type === "move" || action.type === "scroll";
}

function nearTargetText(snapshot: ScreenSnapshot, point: { x: number; y: number }): string {
  return snapshot.ocrBlocks
    .filter((block) => Math.hypot(block.x + block.width / 2 - point.x, block.y + block.height / 2 - point.y) <= NEAR_TARGET_PX)
    .map((block) => block.text)
    .join(" ");
}

function proposalInput(active: ActiveRun, snapshot: ScreenSnapshot, sessionId: string) {
  return {
    runId: active.run.id,
    sessionId,
    instruction: `${active.skill.name}: ${active.skill.description}`.slice(0, 2000),
    skill: { name: active.skill.name, subtasks: active.skill.subtasks.map((subtask) => ({ title: subtask.title, goal: subtask.goal, completionCriteria: subtask.completionCriteria, keySteps: [...subtask.keySteps] })) },
    currentSubtaskIndex: active.run.currentSubtaskIndex,
    priorActions: active.priorActions.slice(-200),
    screenshot: { id: snapshot.screenshotId, pngBase64: snapshot.resized.png.toString("base64"), width: snapshot.resized.width, height: snapshot.resized.height },
    platform: "macos" as const,
    variables: active.variables
  };
}

/** Advances to the next subtask; finishes the run when the last one was just verified. */
async function advanceSubtask(host: RunnerHost, active: ActiveRun): Promise<StepOutcome> {
  const next = active.run.currentSubtaskIndex + 1;
  active.subtaskVerified = false;
  if (next >= active.skill.subtasks.length) return finish("completed", "none", "All subtasks verified");
  active.run = { ...active.run, currentSubtaskIndex: next };
  await host.deps.model.resetSession(active.run.id).catch(() => undefined);
  host.deps.hooks?.onSubtaskAdvance?.(active.run.id, next);
  return { kind: "continue" };
}

async function handleSubtaskComplete(host: RunnerHost, active: ActiveRun, step: RunStep, snapshot: ScreenSnapshot): Promise<StepOutcome> {
  const subtask = active.skill.subtasks[active.run.currentSubtaskIndex]!;
  const check = await subtaskSatisfied(snapshot, subtask.completionPredicates, host.deps.dom, host.deps.domQueryTimeoutMs ?? DEFAULT_DOM_TIMEOUT_MS);
  if (check.subtaskComplete || active.subtaskVerified) {
    host.persistStep(active, { ...step, verification: check.subtaskComplete ? check : { ...check, passed: true, subtaskComplete: true, evidence: "Verified by a previous step" } });
    return advanceSubtask(host, active);
  }
  const question = `The model reports subtask "${subtask.title}" as complete, but no completion check passed. Is it complete?`.slice(0, 500);
  host.persistStep(active, { ...step, verification: check });
  const answer = await host.awaitQuestion(active, step, question);
  if (answer === null) return finish("interrupted", "user_interrupted", "Stopped while waiting for the user", active.stopRequested?.kind === "user" ? active.stopRequested.by : "ui_stop");
  if (answer.confirmSubtask) {
    host.persistStep(active, { ...step, verification: userConfirmedVerification(subtask.title) });
    active.run = bumpMetrics(active.run, { corrections: active.run.metrics.corrections + 1 });
    return advanceSubtask(host, active);
  }
  active.priorActions = [...active.priorActions, { stepIndex: step.index, summary: `User says subtask "${subtask.title}" is not complete: ${answer.answer}`.slice(0, 300) }];
  active.run = bumpMetrics(active.run, { corrections: active.run.metrics.corrections + 1 });
  return { kind: "continue" };
}

async function handleControl(host: RunnerHost, active: ActiveRun, step: RunStep, result: ProposedActionResult, snapshot: ScreenSnapshot): Promise<StepOutcome> {
  const token = result.controlToken ?? (result.action?.type === "done" ? "DONE" : result.action?.type === "fail" ? "FAIL" : undefined);
  if (token === "WAIT") {
    host.persistStep(active, step);
    await host.deps.clock.sleep(1000);
    return { kind: "continue" };
  }
  if (token === "FAIL") {
    host.persistStep(active, failStep(step, "unknown"));
    return finish("failed", "unknown", (result.action?.type === "fail" ? result.action.reason : result.actionSummary).slice(0, 1000));
  }
  if (token === "SUBTASK_COMPLETE" || token === "DONE") return handleSubtaskComplete(host, active, step, snapshot);
  if (result.action?.type === "ask_user") {
    host.persistStep(active, step);
    const answer = await host.awaitQuestion(active, step, result.action.question);
    if (answer === null) return finish("interrupted", "user_interrupted", "Stopped while waiting for the user", active.stopRequested?.kind === "user" ? active.stopRequested.by : "ui_stop");
    active.priorActions = [...active.priorActions, { stepIndex: step.index, summary: `User answered: ${answer.answer}`.slice(0, 300) }];
    if (answer.confirmSubtask) {
      host.persistStep(active, { ...step, verification: userConfirmedVerification(active.skill.subtasks[active.run.currentSubtaskIndex]!.title) });
      return advanceSubtask(host, active);
    }
    return { kind: "continue" };
  }
  active.consecutive.invalid += 1;
  host.persistStep(active, failStep(step, "invalid_action", result.parseErrors.join("; ").slice(0, 300) || "Model output could not be parsed into a supported action"));
  if (active.consecutive.invalid >= MAX_CONSECUTIVE_INVALID) return finish("failed", "invalid_action", `Model output rejected: ${result.parseErrors.join("; ")}`.slice(0, 1000));
  return { kind: "continue" };
}

interface Prepared {
  readonly fresh: ScreenSnapshot;
  readonly risk: RiskResult;
  readonly validation: RunStep["validation"];
  readonly targetLabel?: string;
}

type PrepareResult = { readonly ok: true; readonly prepared: Prepared } | { readonly ok: false; readonly outcome: StepOutcome; readonly category: FailureCategory };

/** Fresh capture, stale/geometry check, target resolution, risk classification, policy. */
async function prepare(host: RunnerHost, active: ActiveRun, step: RunStep, action: ProposedAction, snapshot: ScreenSnapshot): Promise<PrepareResult> {
  const deps = host.deps;
  const focus = await ensureTargetFrontmost(host, active, step);
  if (focus) return { ok: false, outcome: focus, category: focus.failureCategory ?? "unknown" };
  const now = deps.clock.now();
  const fresh = await takeSnapshot(deps, { previous: snapshot, now });
  const stale = isStaleScreen({ capturedAt: snapshot.capture.capturedAt, now, beforeHash: snapshot.hash, afterHash: fresh.hash });
  const geometry = geometryMatches({ bounds: snapshot.capture.bounds, displayScale: snapshot.capture.displayScale, displayId: snapshot.capture.displayId }, { bounds: fresh.capture.bounds, displayScale: fresh.capture.displayScale, displayId: fresh.capture.displayId });
  if (stale.stale || !geometry) {
    active.consecutive.stale += 1;
    const reasons = [...stale.reasons, ...(geometry ? [] : ["window geometry changed"])];
    const outcome = active.consecutive.stale >= MAX_CONSECUTIVE_STALE ? finish("failed", "stale_screen", `Screen changed before the action could run: ${reasons.join(", ")}`.slice(0, 1000)) : { kind: "continue" as const };
    return { ok: false, outcome, category: "stale_screen" };
  }
  active.consecutive.stale = 0;
  let validation = validateProposedAction(action, { screenshotWidth: snapshot.resized.width, screenshotHeight: snapshot.resized.height, subtaskCount: active.skill.subtasks.length });
  let targetLabel: string | undefined;
  let axRole: string | undefined;
  let ocrNearTarget: string | undefined;
  if (hasPoint(action)) {
    const display = toExecutableAction(action, fresh.transform);
    const axElement = display.type === "click" || display.type === "double_click" || display.type === "move" || display.type === "scroll" ? await deps.ax.elementAt(display.x, display.y).catch(() => null) : null;
    const resolved = resolveTarget({ point: { x: action.x, y: action.y }, ocrBlocks: fresh.ocrBlocks, axElement, transform: fresh.transform });
    targetLabel = resolved.label;
    axRole = resolved.role ?? axElement?.role;
    ocrNearTarget = nearTargetText(fresh, { x: action.x, y: action.y });
    validation = { ...validation, resolvedTarget: { source: resolved.source, label: resolved.label, role: resolved.role }, targetDriftPx: resolved.distancePx };
    if (resolved.ambiguous) validation = { ...validation, ok: false, errors: [...validation.errors, `ambiguous target: ${resolved.candidates.join(" | ")}`.slice(0, 256)] };
  }
  const sensitive = detectSensitiveContext({ windowTitle: fresh.context.windowTitle, bundleId: fresh.context.bundleId, domain: fresh.context.domain, secureFieldFocused: fresh.context.isSecureInput, axRole, ocrText: ocrNearTarget });
  const baseRisk = classifyRisk({ action, targetLabel, axRole, ocrNearTarget, bundleId: fresh.context.bundleId, domain: fresh.context.domain, sensitive, skillRiskClass: active.skill.riskClass });
  const settings = deps.settings.get();
  const policy = { ...active.skill.policy, mode: active.run.mode };
  const approvals = active.run.mode === "approval_every_step" ? { lowRiskRunApproval: false, navigationRunApproval: false } : { lowRiskRunApproval: active.run.lowRiskRunApproval, navigationRunApproval: active.run.navigationRunApproval };
  const risk = applyPolicy(baseRisk, action.type, policy, approvals, settings.experimental.lowRiskAuto);
  return { ok: true, prepared: { fresh, risk, validation, targetLabel } };
}

function isOutcome<T extends object>(value: T | StepOutcome): value is StepOutcome {
  return "kind" in value;
}

/**
 * Only an approved (or policy-auto) action reaches the helper. The approval
 * token is minted here, from the exact executable action, under the helper's
 * session secret; the helper recomputes it and refuses anything else.
 */
async function execute(host: RunnerHost, active: ActiveRun, action: ProposedAction, fresh: ScreenSnapshot, approval: ApprovalResult): Promise<{ executed: ExecutableAction; executeMs: number } | StepOutcome> {
  if (approval.decision !== "approved" && approval.decision !== "auto") return finish("failed", "policy_blocked", "Refusing to execute an action that was not approved");
  const secret = host.deps.approvalSecret();
  if (secret === null) return finish("failed", "helper_error", "The helper session has no approval secret; the action cannot be authorized");
  const executable = toExecutableAction(action, fresh.transform);
  const token = mintApprovalToken(secret, executable);
  const started = performance.now();
  try {
    const result = await host.deps.actuator().perform(executable, token);
    if (!result.performed) return finish("failed", "helper_error", "The helper did not perform the approved action");
  } catch (error) {
    return finish("failed", "helper_error", `Helper error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000));
  }
  return { executed: executable, executeMs: performance.now() - started };
}

/** The ten-step loop body for one step. */
export async function executeStep(host: RunnerHost, active: ActiveRun, step: RunStep): Promise<StepOutcome> {
  const deps = host.deps;
  syncTargetWithSubtask(active);
  const focus = await ensureTargetFrontmost(host, active, step);
  if (focus) {
    host.persistStep(active, failStep(step, focus.failureCategory ?? "unknown"));
    return focus;
  }
  const captureStart = performance.now();
  let snapshot: ScreenSnapshot;
  try {
    snapshot = await takeSnapshot(deps, { previous: active.lastSnapshot, store: true, now: deps.clock.now() });
  } catch (error) {
    host.persistStep(active, failStep(step, "helper_error"));
    return finish("failed", "helper_error", `Capture failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000));
  }
  active.lastSnapshot = snapshot;
  let current = stepWithTiming({ ...step, screenshotRef: snapshot.screenshotId }, { captureMs: performance.now() - captureStart });
  if (!appAllowed(active.skill, snapshot.context.bundleId)) return finish("aborted_policy", "policy_blocked", `Frontmost app ${snapshot.context.bundleId ?? "unknown"} is outside the skill's allowed apps`);
  if (!domainAllowed(active.skill, snapshot.context.domain)) return finish("aborted_policy", "policy_blocked", `Domain ${snapshot.context.domain ?? "unknown"} is outside the skill's allowed domains`);
  const contextSensitive = detectSensitiveContext({ windowTitle: snapshot.context.windowTitle, bundleId: snapshot.context.bundleId, domain: snapshot.context.domain, secureFieldFocused: snapshot.context.isSecureInput });
  if (contextSensitive.sensitive) {
    host.persistStep(active, failStep(current, "sensitive_context"));
    return finish("aborted_sensitive", "sensitive_context", `Sensitive context: ${contextSensitive.reasons.join(", ")}`.slice(0, 1000));
  }
  const proposeStart = performance.now();
  let result: ProposedActionResult;
  try {
    result = await deps.model.propose(proposalInput(active, snapshot, deps.sessionId));
  } catch (error) {
    if (error instanceof InferenceCancelledError) return finish("interrupted", "user_interrupted", "Model work was stopped", "model");
    host.persistStep(active, failStep(current, "model_unavailable"));
    return finish("failed", "model_unavailable", `Model call failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000));
  }
  const proposeMs = performance.now() - proposeStart;
  deps.metrics.record("run.proposeMs", proposeMs);
  active.run = addModelLatency(active.run, result.latencyMs > 0 ? result.latencyMs : proposeMs, 1);
  current = stepWithTiming({ ...current, proposed: result.action, actionSummary: result.actionSummary.slice(0, 300), rationale: result.rationale.slice(0, 500), controlToken: result.controlToken }, { proposeMs });
  const action = result.action;
  if (action === null || action.type === "done" || action.type === "fail" || action.type === "ask_user" || result.controlToken !== undefined) return handleControl(host, active, current, result, snapshot);
  active.consecutive.invalid = 0;
  const prepareResult = await prepare(host, active, current, action, snapshot);
  if (!prepareResult.ok) {
    host.persistStep(active, failStep(current, prepareResult.category));
    return prepareResult.outcome;
  }
  const { prepared } = prepareResult;
  current = { ...current, validation: prepared.validation, risk: prepared.risk };
  if (!prepared.validation?.ok) {
    active.consecutive.invalid += 1;
    const ambiguous = prepared.validation?.errors.some((error) => error.startsWith("ambiguous target"));
    host.persistStep(active, failStep(current, ambiguous ? "target_ambiguous" : "invalid_action"));
    if (active.consecutive.invalid >= MAX_CONSECUTIVE_INVALID) return finish("failed", ambiguous ? "target_ambiguous" : "invalid_action", `Action rejected: ${prepared.validation?.errors.join("; ")}`.slice(0, 1000));
    return { kind: "continue" };
  }
  if (prepared.risk.decision === "abort") {
    host.persistStep(active, failStep(current, "sensitive_context"));
    await deps.emergencyStop?.();
    return finish("aborted_sensitive", "sensitive_context", `Sensitive context: ${prepared.risk.reasons.join(", ")}`.slice(0, 1000));
  }
  if (prepared.risk.decision === "unsupported") {
    host.persistStep(active, failStep(current, "policy_blocked"));
    return finish("aborted_policy", "policy_blocked", `Unsupported in the alpha: ${prepared.risk.riskClass} (${prepared.risk.reasons.join(", ")})`.slice(0, 1000));
  }
  let approval: ApprovalResult;
  if (prepared.risk.decision === "auto") {
    approval = { decision: "auto", scope: "run_low_risk", ts: deps.clock.now() };
  } else {
    const target = hasPoint(action) ? { x: action.x, y: action.y, label: prepared.targetLabel } : null;
    const request: ApprovalRequest = {
      runId: active.run.id,
      stepId: current.id,
      stepIndex: current.index,
      subtaskIndex: current.subtaskIndex,
      subtaskTitle: active.skill.subtasks[current.subtaskIndex]?.title ?? "",
      proposed: action,
      risk: prepared.risk,
      screenshotPngBase64: snapshot.resized.png.toString("base64"),
      screenshotWidth: snapshot.resized.width,
      screenshotHeight: snapshot.resized.height,
      target,
      actionSummary: current.actionSummary,
      rationale: current.rationale,
      canApproveRunLowRisk: active.run.mode === "guide" && active.skill.policy.allowLowRiskRunApproval && prepared.risk.riskClass === "read_only",
      requestedAt: deps.clock.now()
    };
    const waitStart = performance.now();
    const resolution = await host.awaitApproval(active, current, request);
    current = stepWithTiming(current, { approvalWaitMs: performance.now() - waitStart });
    approval = { decision: resolution.decision, scope: resolution.scope, ts: deps.clock.now() };
    if (resolution.decision !== "approved") {
      const rejected = resolution.decision === "rejected";
      host.persistStep(active, { ...current, approval, failureCategory: rejected ? "user_rejected" : resolution.decision === "timed_out" ? "timeout" : "user_interrupted", userInterrupted: resolution.decision === "interrupted" });
      if (rejected) {
        active.run = bumpMetrics(active.run, { rejectedActions: active.run.metrics.rejectedActions + 1 });
        deps.analytics.track("action_rejected", { actionType: action.type, mode: active.run.mode }, prepared.risk.riskClass);
        return finish("failed", "user_rejected", "The user rejected the proposed action");
      }
      if (resolution.decision === "timed_out") return finish("timed_out", "timeout", "Approval timed out", "timeout");
      return finish("interrupted", "user_interrupted", "Stopped while waiting for approval", active.stopRequested?.kind === "user" ? active.stopRequested.by : "ui_stop");
    }
    if (resolution.scope === "run_low_risk" && active.run.mode === "guide") {
      active.run = { ...active.run, lowRiskRunApproval: true, navigationRunApproval: active.skill.policy.allowNavigationRunApproval };
    }
    deps.analytics.track("action_approved", { actionType: action.type, mode: active.run.mode, scope: resolution.scope }, prepared.risk.riskClass);
  }
  active.run = bumpMetrics(active.run, { approvedActions: active.run.metrics.approvedActions + 1 });
  current = { ...current, approval };
  if (active.run.mode === "suggest_only") {
    host.persistStep(active, current);
    active.priorActions = [...active.priorActions, { stepIndex: current.index, summary: `Suggested (not executed): ${current.actionSummary}`.slice(0, 300) }];
    return { kind: "continue" };
  }
  // The approval was clicked in the Apprentice window; put the target app back in front before acting.
  const refocus = await ensureTargetFrontmost(host, active, current);
  if (refocus) {
    host.persistStep(active, failStep(current, refocus.failureCategory ?? "unknown"));
    return refocus;
  }
  const executionOutcome = await execute(host, active, action, prepared.fresh, approval);
  if (isOutcome(executionOutcome)) {
    host.persistStep(active, failStep(current, "helper_error"));
    return executionOutcome;
  }
  current = stepWithTiming({ ...current, executed: executionOutcome.executed }, { executeMs: executionOutcome.executeMs });
  deps.metrics.record("run.executeMs", executionOutcome.executeMs);
  await deps.clock.sleep(deps.settleMs ?? DEFAULT_SETTLE_MS);
  const verifyStart = performance.now();
  // Always OCR the after-capture: a small typed value can leave the perceptual hash unchanged.
  const after = await takeSnapshot(deps, { now: deps.clock.now() });
  const subtask = active.skill.subtasks[active.run.currentSubtaskIndex]!;
  const verified = await verifyDeterministic({ before: prepared.fresh, after, expectedResult: action.expectedResult, predicates: subtask.completionPredicates, dom: deps.dom, domTimeoutMs: deps.domQueryTimeoutMs ?? DEFAULT_DOM_TIMEOUT_MS });
  let verification = verified.verification;
  if (!verification.passed) {
    try {
      const supporting = await deps.model.verify({ runId: active.run.id, expectedResult: action.expectedResult, completionCriteria: subtask.completionCriteria, before: { pngBase64: prepared.fresh.resized.png.toString("base64"), width: prepared.fresh.resized.width, height: prepared.fresh.resized.height }, after: { pngBase64: after.resized.png.toString("base64"), width: after.resized.width, height: after.resized.height } });
      active.run = addModelLatency(active.run, 0, 2);
      verification = { ...verification, evidence: `${verification.evidence} | model (supporting only): ${supporting.evidence}`.slice(0, 500) };
    } catch {
      // Supporting evidence is optional; the deterministic result stands.
    }
  }
  active.lastSnapshot = after;
  const verifyMs = performance.now() - verifyStart;
  deps.metrics.record("run.verifyMs", verifyMs);
  current = stepWithTiming({ ...current, verification, beforeStateHash: verified.beforeHash, afterStateHash: verified.afterHash }, { verifyMs });
  deps.metrics.record("run.stepMs", current.timing.totalMs);
  host.persistStep(active, current);
  active.priorActions = [...active.priorActions, { stepIndex: current.index, summary: current.actionSummary }];
  active.consecutive.verifyFail = verification.passed ? 0 : active.consecutive.verifyFail + 1;
  if (active.consecutive.verifyFail >= MAX_CONSECUTIVE_VERIFY_FAIL) return finish("failed", "verification_failed", "Three consecutive actions produced no verifiable change");
  if (verification.subtaskComplete) {
    active.subtaskVerified = true;
    return advanceSubtask(host, active);
  }
  return { kind: "continue" };
}
