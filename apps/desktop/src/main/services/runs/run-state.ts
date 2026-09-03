import { newId } from "@apprentice/core";
import type { ExecutableAction, ActionPolicyMode, FailureCategory, Run, RunStatus, RunStep, Skill } from "@apprentice/schemas";

/** Pure builders and updaters; every function returns a new object. */
export function createRun(skill: Skill, mode: ActionPolicyMode, provider: string, model: string | undefined, now: number): Run {
  return {
    id: newId("run"),
    skillId: skill.id,
    skillVersion: skill.version,
    skillName: skill.name.slice(0, 120),
    mode,
    status: "pending",
    currentSubtaskIndex: 0,
    subtaskCount: skill.subtasks.length,
    startedAt: now,
    failureCategory: "none",
    provider: provider.slice(0, 64),
    model: model?.slice(0, 128),
    metrics: { steps: 0, approvedActions: 0, rejectedActions: 0, corrections: 0, modelLatencyMsTotal: 0, modelLatencyMsMax: 0, screenshotsUsed: 0 },
    lowRiskRunApproval: false,
    navigationRunApproval: false,
    summary: ""
  };
}

export function createStep(run: Run, index: number, now: number): RunStep {
  return {
    id: newId("step"),
    runId: run.id,
    index,
    subtaskIndex: run.currentSubtaskIndex,
    ts: now,
    proposed: null,
    actionSummary: "",
    rationale: "",
    validation: null,
    risk: null,
    approval: null,
    executed: null,
    verification: null,
    timing: { captureMs: 0, proposeMs: 0, approvalWaitMs: 0, executeMs: 0, verifyMs: 0, totalMs: 0 },
    failureCategory: "none",
    userInterrupted: false
  };
}

export function withStatus(run: Run, status: RunStatus, now: number, extra: Partial<Pick<Run, "failureCategory" | "interruptedBy" | "summary">> = {}): Run {
  const terminal = status !== "running" && status !== "awaiting_approval" && status !== "awaiting_user" && status !== "pending";
  return { ...run, status, ...(terminal ? { endedAt: now } : {}), ...extra };
}

export function isTerminal(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "interrupted" || status === "timed_out" || status === "aborted_policy" || status === "aborted_sensitive";
}

export function bumpMetrics(run: Run, patch: Partial<Run["metrics"]>): Run {
  return { ...run, metrics: { ...run.metrics, ...patch } };
}

export function addModelLatency(run: Run, latencyMs: number, screenshots: number): Run {
  const rounded = Math.round(latencyMs);
  return bumpMetrics(run, {
    modelLatencyMsTotal: run.metrics.modelLatencyMsTotal + rounded,
    modelLatencyMsMax: Math.max(run.metrics.modelLatencyMsMax, rounded),
    screenshotsUsed: run.metrics.screenshotsUsed + screenshots
  });
}

export function failStep(step: RunStep, category: FailureCategory, summary?: string): RunStep {
  return { ...step, failureCategory: category, ...(summary !== undefined ? { actionSummary: summary.slice(0, 300) } : {}) };
}

export function stepWithTiming(step: RunStep, patch: Partial<RunStep["timing"]>): RunStep {
  const rounded = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, Math.max(0, Math.round(value ?? 0))])) as Partial<RunStep["timing"]>;
  const timing = { ...step.timing, ...rounded };
  const totalMs = timing.captureMs + timing.proposeMs + timing.approvalWaitMs + timing.executeMs + timing.verifyMs;
  return { ...step, timing: { ...timing, totalMs: Math.round(totalMs) } };
}

/** Window after the helper posts an Escape during which a global Escape stop is treated as the echo of that key. */
export const SYNTHETIC_ESCAPE_GRACE_MS = 1500;

export function usesEscapeKey(action: ExecutableAction): boolean {
  return (action.type === "press_key" || action.type === "hotkey") && action.key === "escape";
}

/** True when a "user pressed Escape" stop arrives within the grace window of an Escape the run itself executed. */
export function isSyntheticEscapeEcho(lastEscapeExecutedAt: number | undefined, now: number): boolean {
  if (lastEscapeExecutedAt === undefined) return false;
  const elapsed = now - lastEscapeExecutedAt;
  return elapsed >= 0 && elapsed <= SYNTHETIC_ESCAPE_GRACE_MS;
}
