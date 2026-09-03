import type { RunStep } from "@apprentice/schemas";
import type { ScreenCapture } from "../observation/screen-source.js";
import { appDisplayName, isApprenticeApp } from "./app-focus.js";
import { ensureTargetFrontmost, type FocusOutcome } from "./focus-guard.js";
import { takeSnapshot, type ScreenSnapshot } from "./snapshot.js";
import type { ActiveRun, RunnerHost } from "./step-runner.js";

/**
 * A run may only look at, and act on, a window of its target app. The target
 * can be frontmost with no window at all (the user closed the document); the
 * screen source then returns the whole display, which typically shows the
 * Apprentice dashboard. Such a capture never reaches the model or the
 * approval panel: the user is asked to open a window, and the run aborts
 * when the next capture still is not a target window.
 */

/** Why `capture` cannot stand in for the target app's window, or null when it can. */
export function windowMismatch(active: ActiveRun, capture: ScreenCapture): string | null {
  if (capture.isDisplayFallback) return "the frontmost app has no window to capture";
  if (isApprenticeApp(capture.bundleId)) return "the captured window belongs to Apprentice";
  const target = active.targetBundleId;
  if (capture.bundleId !== undefined && target !== undefined && capture.bundleId.toLowerCase() !== target.toLowerCase()) {
    return `the captured window belongs to ${capture.bundleId}`;
  }
  return null;
}

function targetName(active: ActiveRun): string {
  return active.targetBundleId !== undefined ? appDisplayName(active.targetBundleId) : "the target app";
}

export function windowQuestion(active: ActiveRun): string {
  return `Open a window in ${targetName(active)} and answer Continue`.slice(0, 500);
}

export type WindowRecovery = { readonly snapshot: ScreenSnapshot } | { readonly outcome: FocusOutcome } | { readonly advance: true };

/**
 * Asks the user to open a window in the target app, brings the target back to
 * the front, captures again, and aborts by policy when that capture still is
 * not a window of the target.
 */
export async function recoverTargetWindow(host: RunnerHost, active: ActiveRun, step: RunStep): Promise<WindowRecovery> {
  const deps = host.deps;
  const answer = await host.awaitQuestion(active, step, windowQuestion(active));
  // The user marked the subtask complete while the question was open: the caller advances instead of recovering.
  if (answer === null && active.advanceRequested) return { advance: true };
  if (answer === null) {
    const by = active.stopRequested?.kind === "user" ? active.stopRequested.by : "ui_stop";
    return { outcome: { kind: "finish", status: "interrupted", failureCategory: "user_interrupted", summary: "Stopped while waiting for the user to open a window", interruptedBy: by } };
  }
  const focus = await ensureTargetFrontmost(host, active, step);
  if (focus) return { outcome: focus };
  let snapshot: ScreenSnapshot;
  try {
    snapshot = await takeSnapshot(deps, { previous: active.lastSnapshot, store: true, now: deps.clock.now() });
  } catch (error) {
    return { outcome: { kind: "finish", status: "failed", failureCategory: "helper_error", summary: `Capture failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000) } };
  }
  const mismatch = windowMismatch(active, snapshot.capture);
  if (mismatch === null) return { snapshot };
  return { outcome: { kind: "finish", status: "aborted_policy", failureCategory: "policy_blocked", summary: `No window in ${targetName(active)} to act on: ${mismatch}`.slice(0, 1000) } };
}
