import { describe, expect, it } from "vitest";
import type { RunStep, Skill } from "@apprentice/schemas";
import { ensureTargetFrontmost, syncTargetWithSubtask } from "../src/main/services/runs/focus-guard.js";
import type { ActiveRun, RunnerHost } from "../src/main/services/runs/step-runner.js";
import { silentLogger } from "../src/main/services/logger.js";

const APPRENTICE = "com.apprentice.alpha";
const FINDER = "com.apple.finder";
const PREVIEW = "com.apple.Preview";

function skill(): Skill {
  return {
    allowedApps: ["finder", "preview", "textedit"],
    subtasks: [
      { appOrDomain: "finder", title: "Open the PDF" },
      { appOrDomain: "preview", title: "Close the PDF" }
    ]
  } as unknown as Skill;
}

function active(subtaskIndex = 0): ActiveRun {
  return { run: { id: "run_focus", currentSubtaskIndex: subtaskIndex }, skill: skill(), stopRequested: null, targetBundleId: undefined } as unknown as ActiveRun;
}

/** A frontmost app that only changes when activateApp is called. */
function host(initialFrontmost: string): { host: RunnerHost; activations: string[]; setFrontmost: (bundleId: string) => void } {
  let frontmost = initialFrontmost;
  const activations: string[] = [];
  const deps = {
    context: { frontmost: async () => ({ bundleId: frontmost }) },
    appActivator: {
      activate: async (bundleId: string) => {
        activations.push(bundleId);
        frontmost = bundleId;
        return { activated: true };
      }
    },
    clock: { now: () => Date.now(), sleep: async () => undefined },
    logger: silentLogger,
    activationWaitMs: 10,
    activationPollMs: 5
  };
  const runnerHost = {
    deps,
    awaitQuestion: async () => null,
    awaitApproval: async () => ({ decision: "interrupted" as const, scope: "once" as const }),
    persistStep: () => undefined
  } as unknown as RunnerHost;
  return { host: runnerHost, activations, setFrontmost: (bundleId) => { frontmost = bundleId; } };
}

const step = { id: "step_1", index: 0 } as unknown as RunStep;

describe("focus guard", () => {
  it("activates the subtask's app the first time a subtask runs", async () => {
    const run = active(0);
    const h = host(APPRENTICE);
    syncTargetWithSubtask(run);
    expect(await ensureTargetFrontmost(h.host, run, step)).toBeNull();
    expect(h.activations).toEqual([FINDER]);
    expect(run.targetBundleId).toBe(FINDER);
  });

  it("follows an allowed app that came to the front within the same subtask instead of re-activating the subtask app", async () => {
    // The approved double-click in Finder opened Preview; the model must see Preview, not Finder again.
    const run = active(0);
    const h = host(APPRENTICE);
    syncTargetWithSubtask(run);
    await ensureTargetFrontmost(h.host, run, step);
    h.setFrontmost(PREVIEW);
    syncTargetWithSubtask(run);
    expect(await ensureTargetFrontmost(h.host, run, step)).toBeNull();
    expect(h.activations).toEqual([FINDER]);
    expect(run.targetBundleId).toBe(PREVIEW);
  });

  it("brings the adopted app back after the user approved in the Apprentice window", async () => {
    const run = active(0);
    const h = host(APPRENTICE);
    syncTargetWithSubtask(run);
    await ensureTargetFrontmost(h.host, run, step);
    h.setFrontmost(PREVIEW);
    syncTargetWithSubtask(run);
    await ensureTargetFrontmost(h.host, run, step);
    h.setFrontmost(APPRENTICE);
    syncTargetWithSubtask(run);
    expect(await ensureTargetFrontmost(h.host, run, step)).toBeNull();
    expect(h.activations).toEqual([FINDER, PREVIEW]);
  });

  it("re-pins to the next subtask's app when the subtask advances", async () => {
    const run = active(0);
    const h = host(APPRENTICE);
    syncTargetWithSubtask(run);
    await ensureTargetFrontmost(h.host, run, step);
    run.run = { ...run.run, currentSubtaskIndex: 1 };
    syncTargetWithSubtask(run);
    expect(await ensureTargetFrontmost(h.host, run, step)).toBeNull();
    expect(h.activations).toEqual([FINDER, PREVIEW]);
    expect(run.targetBundleId).toBe(PREVIEW);
  });
});
