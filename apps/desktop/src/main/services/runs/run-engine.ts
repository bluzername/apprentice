import type { ActionPolicyMode, ApprovalRequest, ApprovalScope, Run, RunDetail, RunStep, Skill } from "@apprentice/schemas";
import { ServiceError } from "../errors.js";
import { initialAppTarget } from "./app-focus.js";
import { createRun, createStep, isTerminal, withStatus, isSyntheticEscapeEcho } from "./run-state.js";
import { executeStep, type ActiveRun, type ApprovalResolution, type QuestionAnswer, type RunnerHost, type StepOutcome } from "./step-runner.js";
import type { RunEngineDeps } from "./types.js";

interface PendingApproval {
  readonly request: ApprovalRequest;
  readonly resolve: (resolution: ApprovalResolution) => void;
}

interface PendingQuestion {
  readonly stepId: string;
  readonly question: string;
  readonly resolve: (answer: QuestionAnswer) => void;
}

interface Session {
  readonly active: ActiveRun;
  pendingApproval: PendingApproval | null;
  pendingQuestion: PendingQuestion | null;
  readonly done: Promise<Run>;
  resolveDone: (run: Run) => void;
}

/**
 * Assisted-run state machine. One run at a time; every transition is persisted
 * and emitted; approvals and questions are promises the renderer resolves.
 */
export class RunEngine implements RunnerHost {
  private session: Session | null = null;

  constructor(readonly deps: RunEngineDeps) {}

  isActive(): boolean {
    return this.session !== null;
  }

  activeRunId(): string | null {
    return this.session?.active.run.id ?? null;
  }

  list(limit: number): Run[] {
    return this.deps.storage.current.runs.list(limit);
  }

  get(runId: string): RunDetail {
    const session = this.session?.active.run.id === runId ? this.session : null;
    if (session) return this.detail(session);
    const storage = this.deps.storage.current;
    const run = storage.runs.get(runId);
    if (!run) throw new ServiceError("not_found", `Run ${runId} not found`);
    return { run, steps: storage.runs.steps(runId), pendingApproval: null, pendingQuestion: null };
  }

  /** Resolves when the run reaches a terminal status (smoke test and tests). */
  waitForCompletion(runId: string): Promise<Run> {
    if (this.session?.active.run.id === runId) return this.session.done;
    const run = this.deps.storage.current.runs.get(runId);
    if (!run) return Promise.reject(new ServiceError("not_found", `Run ${runId} not found`));
    return Promise.resolve(run);
  }

  async start(skillId: string, mode?: ActionPolicyMode, variables: Record<string, string> = {}): Promise<Run> {
    if (this.session) throw new ServiceError("run_active", `Run ${this.session.active.run.id} is still active`);
    const skill = this.deps.storage.current.skills.getCurrent(skillId);
    if (!skill) throw new ServiceError("not_found", `Skill ${skillId} not found`);
    const effectiveMode = mode ?? skill.policy.mode;
    if (effectiveMode === "low_risk_auto" && !this.deps.settings.get().experimental.lowRiskAuto) {
      throw new ServiceError("policy_blocked", "low_risk_auto is an experimental mode; enable it in Settings first");
    }
    const run = createRun(skill, effectiveMode, this.deps.model.providerType(), this.deps.model.modelName(), this.deps.clock.now());
    const active: ActiveRun = { run, steps: [], skill, variables, priorActions: [], consecutive: { stale: 0, invalid: 0, verifyFail: 0 }, subtaskVerified: false, stopRequested: null, targetBundleId: undefined };
    let resolveDone: (value: Run) => void = () => undefined;
    const done = new Promise<Run>((resolve) => {
      resolveDone = resolve;
    });
    this.session = { active, pendingApproval: null, pendingQuestion: null, done, resolveDone };
    this.deps.storage.current.runs.save(run);
    await this.deps.hooks?.beforeStart?.(skill, run.id);
    // The user usually starts a run from the Apprentice window, so the frontmost app is rarely the target.
    const frontmost = await this.deps.context.frontmost().catch(() => undefined);
    active.targetBundleId = initialAppTarget(skill, frontmost?.bundleId);
    this.deps.hooks?.onActiveChange?.(true);
    this.deps.analytics.track("run_started", { mode: effectiveMode, subtasks: skill.subtasks.length, source: skill.source }, skill.riskClass);
    active.run = withStatus(run, "running", this.deps.clock.now());
    this.persistRun(active);
    void this.loop(this.session);
    return active.run;
  }

  approve(runId: string, stepId: string, decision: "approved" | "rejected", scope: ApprovalScope = "once"): RunDetail {
    const session = this.requireSession(runId);
    const pending = session.pendingApproval;
    if (!pending || pending.request.stepId !== stepId) throw new ServiceError("no_pending_approval", `Step ${stepId} is not waiting for approval`);
    session.pendingApproval = null;
    pending.resolve({ decision, scope: decision === "approved" && pending.request.canApproveRunLowRisk ? scope : "once" });
    return this.detail(session);
  }

  answer(runId: string, stepId: string, answer: string, confirmSubtask: boolean): RunDetail {
    const session = this.requireSession(runId);
    const pending = session.pendingQuestion;
    if (!pending || pending.stepId !== stepId) throw new ServiceError("no_pending_question", `Step ${stepId} is not waiting for an answer`);
    session.pendingQuestion = null;
    pending.resolve({ answer: answer.slice(0, 500), confirmSubtask });
    return this.detail(session);
  }

  /** Immediate stop from the UI, Escape, or the menu bar. Safe to call repeatedly. */
  async stop(runId: string, by: "user_escape" | "menu_bar" | "ui_stop" = "ui_stop"): Promise<RunDetail> {
    const session = this.session;
    if (!session || session.active.run.id !== runId) return this.get(runId);
    if (by === "user_escape" && isSyntheticEscapeEcho(session.active.lastEscapeExecutedAt, this.deps.clock.now())) {
      this.deps.logger.info("ignoring Escape stop: the run itself just pressed Escape", { runId });
      return this.detail(session);
    }
    session.active.stopRequested = { kind: "user", by };
    await this.deps.emergencyStop?.().catch(() => undefined);
    session.pendingApproval?.resolve({ decision: "interrupted", scope: "once" });
    session.pendingApproval = null;
    session.pendingQuestion?.resolve(null);
    session.pendingQuestion = null;
    return this.detail(session);
  }

  async stopActive(by: "user_escape" | "menu_bar" | "ui_stop"): Promise<void> {
    const id = this.activeRunId();
    if (id !== null) await this.stop(id, by);
  }

  // ---- RunnerHost -----------------------------------------------------------
  awaitApproval(active: ActiveRun, step: RunStep, request: ApprovalRequest): Promise<ApprovalResolution> {
    const session = this.session;
    if (!session || session.active !== active) return Promise.resolve({ decision: "interrupted", scope: "once" });
    if (active.stopRequested) return Promise.resolve({ decision: "interrupted", scope: "once" });
    active.run = withStatus(active.run, "awaiting_approval", this.deps.clock.now());
    this.persistStep(active, step);
    return new Promise<ApprovalResolution>((resolve) => {
      const deadline = Math.max(0, active.run.startedAt + active.skill.timeoutMs - this.deps.clock.now());
      const timer = setTimeout(() => {
        if (session.pendingApproval?.request.stepId === request.stepId) {
          session.pendingApproval = null;
          resolve({ decision: "timed_out", scope: "once" });
        }
      }, deadline);
      timer.unref?.();
      session.pendingApproval = {
        request,
        resolve: (resolution) => {
          clearTimeout(timer);
          active.run = withStatus(active.run, "running", this.deps.clock.now());
          resolve(resolution);
        }
      };
      this.deps.emit("event:approvalRequest", request);
      this.emitDetail(session);
      this.deps.raiseWindow?.(active.run.id);
    });
  }

  awaitQuestion(active: ActiveRun, step: RunStep, question: string): Promise<QuestionAnswer> {
    const session = this.session;
    if (!session || session.active !== active || active.stopRequested) return Promise.resolve(null);
    active.run = withStatus(active.run, "awaiting_user", this.deps.clock.now());
    this.persistStep(active, step);
    return new Promise<QuestionAnswer>((resolve) => {
      session.pendingQuestion = {
        stepId: step.id,
        question,
        resolve: (answer) => {
          active.run = withStatus(active.run, "running", this.deps.clock.now());
          resolve(answer);
        }
      };
      this.emitDetail(session);
      this.deps.raiseWindow?.(active.run.id);
    });
  }

  persistStep(active: ActiveRun, step: RunStep): void {
    const index = active.steps.findIndex((entry) => entry.id === step.id);
    active.steps = index >= 0 ? [...active.steps.slice(0, index), step, ...active.steps.slice(index + 1)] : [...active.steps, step];
    active.run = { ...active.run, metrics: { ...active.run.metrics, steps: active.steps.length } };
    const storage = this.deps.storage.current;
    storage.runs.save(active.run);
    storage.runs.saveStep(step);
    if (this.session?.active === active) this.emitDetail(this.session);
  }

  // ---- internals ------------------------------------------------------------
  private requireSession(runId: string): Session {
    if (!this.session || this.session.active.run.id !== runId) throw new ServiceError("not_active", `Run ${runId} is not active`);
    return this.session;
  }

  private detail(session: Session): RunDetail {
    return {
      run: session.active.run,
      steps: session.active.steps,
      pendingApproval: session.pendingApproval?.request ?? null,
      pendingQuestion: session.pendingQuestion ? { stepId: session.pendingQuestion.stepId, question: session.pendingQuestion.question } : null
    };
  }

  private persistRun(active: ActiveRun): void {
    this.deps.storage.current.runs.save(active.run);
    if (this.session?.active === active) this.emitDetail(this.session);
  }

  private emitDetail(session: Session): void {
    this.deps.emit("event:run", { detail: this.detail(session) });
  }

  private checkStop(active: ActiveRun): StepOutcome | null {
    if (active.stopRequested?.kind === "user") return { kind: "finish", status: "interrupted", failureCategory: "user_interrupted", interruptedBy: active.stopRequested.by, summary: "Stopped by the user" };
    const now = this.deps.clock.now();
    if (now - active.run.startedAt > active.skill.timeoutMs) return { kind: "finish", status: "timed_out", failureCategory: "timeout", interruptedBy: "timeout", summary: "The run exceeded its time limit" };
    if (active.steps.length >= active.skill.maxSteps) return { kind: "finish", status: "failed", failureCategory: "max_steps", summary: `Reached the maximum of ${active.skill.maxSteps} steps` };
    return null;
  }

  private async loop(session: Session): Promise<void> {
    const { active } = session;
    let outcome: StepOutcome = { kind: "continue" };
    try {
      while (outcome.kind === "continue") {
        const stop = this.checkStop(active);
        if (stop) {
          outcome = stop;
          break;
        }
        const step = createStep(active.run, active.steps.length, this.deps.clock.now());
        outcome = await executeStep(this, active, step);
        if (outcome.kind === "continue" && active.stopRequested) outcome = this.checkStop(active) ?? outcome;
      }
    } catch (error) {
      this.deps.logger.error("run loop crashed", { runId: active.run.id, error: error instanceof Error ? error.message : String(error) });
      outcome = { kind: "finish", status: "failed", failureCategory: "unknown", summary: (error instanceof Error ? error.message : String(error)).slice(0, 1000) };
    }
    this.finish(session, outcome);
  }

  private finish(session: Session, outcome: StepOutcome): void {
    if (outcome.kind !== "finish") return;
    const { active } = session;
    const now = this.deps.clock.now();
    if (!isTerminal(active.run.status) || active.run.status !== outcome.status) {
      active.run = withStatus(active.run, outcome.status, now, {
        failureCategory: outcome.failureCategory ?? "none",
        ...(outcome.interruptedBy !== undefined ? { interruptedBy: outcome.interruptedBy } : {}),
        summary: (outcome.summary ?? "").slice(0, 1000)
      });
    }
    session.pendingApproval?.resolve({ decision: "interrupted", scope: "once" });
    session.pendingQuestion?.resolve(null);
    session.pendingApproval = null;
    session.pendingQuestion = null;
    this.deps.storage.current.runs.save(active.run);
    this.session = null;
    this.deps.hooks?.onActiveChange?.(false);
    this.deps.emit("event:run", { detail: { run: active.run, steps: active.steps, pendingApproval: null, pendingQuestion: null } });
    this.trackFinish(active.run, active.skill);
    session.resolveDone(active.run);
  }

  private trackFinish(run: Run, skill: Skill): void {
    const props = { steps: run.metrics.steps, approved: run.metrics.approvedActions, durationMs: (run.endedAt ?? run.startedAt) - run.startedAt, mode: run.mode };
    if (run.status === "completed") this.deps.analytics.track("run_completed", props, skill.riskClass);
    else if (run.status === "interrupted" || run.status === "timed_out") this.deps.analytics.track("run_interrupted", { ...props, by: run.interruptedBy ?? "unknown" }, skill.riskClass);
    else this.deps.analytics.track("run_failed", { ...props, category: run.failureCategory }, skill.riskClass);
  }
}
