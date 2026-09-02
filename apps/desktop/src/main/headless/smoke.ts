import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { ApprovalRequest, RunDetail } from "@apprentice/schemas";
import { createIpcHandlers } from "../ipc/handlers.js";
import type { KeyProtector } from "../security/keys.js";
import { composeServices } from "../services/composition.js";
import { createFixtureSource } from "../services/demo/fixture-source.js";
import { FakeHelperClient } from "../services/helper/fake-helper-client.js";
import { nodePngResizer } from "../services/images/png-resize.js";
import { createLogger } from "../services/logger.js";
import { FixtureScreenSource } from "../services/observation/screen-source.js";
import { createGrantedPermissionSystem } from "../services/permissions.js";

const execFileAsync = promisify(execFile);

export interface SmokeOptions {
  readonly dataDir: string;
  readonly fixturesDir: string;
  readonly protector: KeyProtector;
  readonly helperBinaryPath?: string;
  readonly timeoutMs?: number;
}

export type SmokeResult =
  | { readonly ok: true; readonly candidates: number; readonly skillId: string; readonly runStatus: string; readonly steps: number; readonly bundle: string; readonly helperSelfTest: boolean }
  | { readonly ok: false; readonly error: string };

async function helperSelfTest(path: string | undefined): Promise<boolean> {
  if (!path || !existsSync(path)) return false;
  try {
    const { stdout } = await execFileAsync(path, ["--self-test"], { timeout: 15_000 });
    return stdout.includes('"ok":true');
  } catch {
    return false;
  }
}

/** Headless end-to-end: demo data, candidate, skill, guided mock run with auto-approval, feedback, export, retention. */
export async function runSmokeTest(options: SmokeOptions): Promise<SmokeResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const fixtures = createFixtureSource(options.fixturesDir);
  const logger = createLogger({ console: false, filePath: `${options.dataDir}/logs/smoke.log` });
  const services = composeServices({
    dataDir: options.dataDir,
    protector: options.protector,
    helper: new FakeHelperClient({ fixtureDelayScale: 0 }),
    screenSource: new FixtureScreenSource({ readPng: (name) => fixtures.readScreenshotPng(name), initial: "genericBlank" }),
    permissionSystem: createGrantedPermissionSystem(),
    power: { onBattery: () => false, thermalState: () => "nominal", idleSeconds: () => 0 },
    resizer: nodePngResizer,
    fixturesDir: options.fixturesDir,
    logger,
    logToConsole: false,
    settleMs: 0
  });
  const handlers = createIpcHandlers(services);
  const ctx = { senderId: 0 };
  const unsubscribe = services.hub.subscribe((name, payload) => {
    if (name === "event:approvalRequest") {
      const request = payload as ApprovalRequest;
      queueMicrotask(() => {
        try {
          handlers["runs:approve"]({ runId: request.runId, stepId: request.stepId, decision: "approved", scope: "once" }, ctx);
        } catch {
          // The run may already have moved on; the engine reports the real state.
        }
      });
    }
    if (name === "event:run") {
      const detail = (payload as { detail: RunDetail }).detail;
      if (detail.pendingQuestion) {
        const question = detail.pendingQuestion;
        queueMicrotask(() => {
          try {
            handlers["runs:answer"]({ runId: detail.run.id, stepId: question.stepId, answer: "confirmed by smoke test", confirmSubtask: true }, ctx);
          } catch {
            // Already answered.
          }
        });
      }
    }
  });
  const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`smoke test exceeded ${timeoutMs} ms`)), timeoutMs).unref?.());
  try {
    const result = await Promise.race([
      (async (): Promise<SmokeResult> => {
        const selfTest = await helperSelfTest(options.helperBinaryPath);
        await services.start();
        await handlers["demo:load"]({ days: 2 }, ctx);
        const candidates = await handlers["candidates:list"]({ includeSuppressed: false }, ctx);
        if (candidates.length < 1) throw new Error("demo load produced no active candidate");
        const first = candidates[0]!;
        const acted = await handlers["candidates:act"]({ id: first.id, action: "edit_and_save" }, ctx);
        if (!acted.skill) throw new Error("candidate conversion produced no skill");
        const run = await handlers["runs:start"]({ skillId: acted.skill.id, mode: "guide", variables: {} }, ctx);
        const finished = await services.runEngine.waitForCompletion(run.id);
        if (finished.status !== "completed") throw new Error(`run ended with status ${finished.status} (${finished.failureCategory}): ${finished.summary}`);
        const detail = await handlers["runs:get"]({ id: run.id }, ctx);
        await handlers["feedback:submit"]({ contextType: "run", contextId: run.id, answers: { kind: "run", outcomeAchieved: "yes", corrections: 0, estimatedTimeSavedMinutes: 5, trustRating: 4, wouldUseAgain: true, failureCategory: "none" } }, ctx);
        const bundle = await handlers["feedback:export"]({ includeRunId: run.id, screenshotIds: [] }, ctx);
        await handlers["privacy:retentionRun"](undefined, ctx);
        return { ok: true, candidates: candidates.length, skillId: acted.skill.id, runStatus: finished.status, steps: detail.steps.length, bundle: bundle.path, helperSelfTest: selfTest };
      })(),
      deadline
    ]);
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    unsubscribe();
    await services.shutdown().catch(() => undefined);
  }
}
