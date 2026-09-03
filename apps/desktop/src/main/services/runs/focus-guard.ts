import type { RunStep } from "@apprentice/schemas";
import { appAllowed, appDisplayName, isApprenticeApp, resolveAppTarget } from "./app-focus.js";
import type { ActiveRun, RunnerHost, StepOutcome } from "./step-runner.js";

/** The only outcomes the focus guard produces: finish the run, or (null) carry on. */
export type FocusOutcome = Extract<StepOutcome, { kind: "finish" }>;

/**
 * Keeps the run's target app frontmost. The Apprentice window is frontmost
 * whenever the user starts a run or answers an approval, so before every
 * capture and before every execution the engine brings the target back,
 * asks the user to switch when they went somewhere else, and only aborts
 * when the frontmost app is still outside the allowlist after they answered.
 */

const DEFAULT_ACTIVATION_WAIT_MS = 1500;
const DEFAULT_ACTIVATION_POLL_MS = 150;

/** Adopts the current subtask's app as the target when it names a different allowed app. */
export function syncTargetWithSubtask(active: ActiveRun): void {
  const subtask = active.skill.subtasks[active.run.currentSubtaskIndex];
  const wanted = resolveAppTarget(active.skill, subtask?.appOrDomain);
  if (wanted !== undefined && wanted !== active.targetBundleId) active.targetBundleId = wanted;
}

async function frontmostBundleId(host: RunnerHost): Promise<string | undefined> {
  return (await host.deps.context.frontmost()).bundleId;
}

function onTarget(active: ActiveRun, frontmost: string | undefined): boolean {
  if (isApprenticeApp(frontmost)) return false;
  if (active.targetBundleId === undefined) return frontmost !== undefined && appAllowed(active.skill, frontmost);
  return frontmost !== undefined && frontmost.toLowerCase() === active.targetBundleId.toLowerCase();
}

function allowedElsewhere(active: ActiveRun, frontmost: string | undefined): boolean {
  return frontmost !== undefined && !isApprenticeApp(frontmost) && appAllowed(active.skill, frontmost);
}

/** Polls the frontmost app until `done` holds, the wait budget is spent, or the run was stopped. */
async function waitForFrontmost(host: RunnerHost, active: ActiveRun, done: (frontmost: string | undefined) => boolean): Promise<string | undefined> {
  const deps = host.deps;
  const pollMs = Math.max(1, deps.activationPollMs ?? DEFAULT_ACTIVATION_POLL_MS);
  const attempts = Math.max(1, Math.ceil((deps.activationWaitMs ?? DEFAULT_ACTIVATION_WAIT_MS) / pollMs));
  let frontmost = await frontmostBundleId(host);
  for (let attempt = 0; attempt < attempts && !done(frontmost) && active.stopRequested === null; attempt += 1) {
    await deps.clock.sleep(pollMs);
    frontmost = await frontmostBundleId(host);
  }
  return frontmost;
}

async function activateTarget(host: RunnerHost, active: ActiveRun, target: string): Promise<string | undefined> {
  try {
    const result = await host.deps.appActivator.activate(target);
    if (!result.activated) host.deps.logger.warn("target app could not be activated", { runId: active.run.id, target });
  } catch (error) {
    host.deps.logger.warn("activateApp failed", { runId: active.run.id, target, error: error instanceof Error ? error.message : String(error) });
  }
  return waitForFrontmost(host, active, (frontmost) => frontmost !== undefined && frontmost.toLowerCase() === target.toLowerCase());
}

/**
 * Brings the target forward when Apprentice (or another app) is in front.
 * Resolves to the frontmost app afterwards; the caller decides what it means.
 */
async function bringTargetForward(host: RunnerHost, active: ActiveRun, frontmost: string | undefined): Promise<string | undefined> {
  const target = active.targetBundleId;
  if (target !== undefined && appAllowed(active.skill, target)) return activateTarget(host, active, target);
  // No known target: give the user a moment to switch away from Apprentice themselves.
  if (isApprenticeApp(frontmost)) return waitForFrontmost(host, active, (current) => allowedElsewhere(active, current));
  return frontmost;
}

/** Accepts the frontmost app when it is the target or another allowed app (which then becomes the target). */
function settle(active: ActiveRun, frontmost: string | undefined): boolean {
  if (onTarget(active, frontmost)) {
    if (active.targetBundleId === undefined) active.targetBundleId = frontmost;
    return true;
  }
  if (allowedElsewhere(active, frontmost)) {
    active.targetBundleId = frontmost;
    return true;
  }
  return false;
}

function switchQuestion(active: ActiveRun): string {
  const target = active.targetBundleId;
  if (target !== undefined) return `Switch to ${appDisplayName(target)} and answer Continue`;
  const apps = active.skill.allowedApps.map(appDisplayName).join(", ");
  return `Switch to one of this skill's allowed apps${apps.length > 0 ? ` (${apps})` : ""} and answer Continue`.slice(0, 500);
}

function interrupted(active: ActiveRun): FocusOutcome {
  return { kind: "finish", status: "interrupted", failureCategory: "user_interrupted", summary: "Stopped while waiting for the user to switch apps", interruptedBy: active.stopRequested?.kind === "user" ? active.stopRequested.by : "ui_stop" };
}

/**
 * Returns null when the run may go on with the target app in front, or the
 * outcome to finish with (interrupted while asking, or aborted by policy).
 */
export async function ensureTargetFrontmost(host: RunnerHost, active: ActiveRun, step: RunStep): Promise<FocusOutcome | null> {
  let frontmost: string | undefined;
  try {
    frontmost = await frontmostBundleId(host);
    if (onTarget(active, frontmost)) {
      settle(active, frontmost);
      return null;
    }
    // Apprentice (the user just clicked in it) or another allowed app: bring the target back.
    if (isApprenticeApp(frontmost) || allowedElsewhere(active, frontmost)) frontmost = await bringTargetForward(host, active, frontmost);
    if (settle(active, frontmost)) return null;
    if (active.stopRequested !== null) return interrupted(active);
    // The user went somewhere outside the allowlist: ask instead of stealing focus or aborting.
    const answer = await host.awaitQuestion(active, step, switchQuestion(active));
    if (answer === null) return interrupted(active);
    frontmost = await frontmostBundleId(host);
    if (!onTarget(active, frontmost)) frontmost = await bringTargetForward(host, active, frontmost);
    if (settle(active, frontmost)) return null;
  } catch (error) {
    return { kind: "finish", status: "failed", failureCategory: "helper_error", summary: `Could not read the frontmost app: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000) };
  }
  return { kind: "finish", status: "aborted_policy", failureCategory: "policy_blocked", summary: `Frontmost app ${frontmost ?? "unknown"} is outside the skill's allowed apps` };
}
