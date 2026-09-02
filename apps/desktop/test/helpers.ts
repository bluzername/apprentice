import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActivityEvent, ApprovalRequest, RunDetail } from "@apprentice/schemas";
import { loadScenarioFixture, type ScenarioName } from "@apprentice/test-fixtures";
import { createIpcHandlers } from "../src/main/ipc/handlers.js";
import { createFakeProtector } from "../src/main/security/keys.js";
import { createAppContext, type AppContext } from "../src/main/services/app-context.js";
import { composeServices, type CompositionAdapters, type Services } from "../src/main/services/composition.js";
import { createFixtureSource, resolveFixturesDir } from "../src/main/services/demo/fixture-source.js";
import type { TemplateTarget } from "../src/main/services/demo/simulator.js";
import { FakeHelperClient } from "../src/main/services/helper/fake-helper-client.js";
import { nodePngResizer } from "../src/main/services/images/png-resize.js";
import { silentLogger } from "../src/main/services/logger.js";
import { FixtureScreenSource } from "../src/main/services/observation/screen-source.js";
import { createGrantedPermissionSystem } from "../src/main/services/permissions.js";

export const TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(TEST_DIR, "..", "..", "..");
export const FIXTURES_DIR = resolveFixturesDir({ startDir: TEST_DIR });
export const fixtures = createFixtureSource(FIXTURES_DIR);

export function tempDir(prefix = "apprentice-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function fixtureTargets(): Record<string, TemplateTarget> {
  return Object.fromEntries(fixtures.readManifest().screenshots.map((entry) => [entry.name, { label: entry.target.label, x: entry.target.x, y: entry.target.y }]));
}

export function makeContext(dir = tempDir()): AppContext {
  return createAppContext({ dataDir: dir, protector: createFakeProtector(), logger: silentLogger, logToConsole: false });
}

let portCursor = 48400;
/** Distinct loopback port ranges per test file so suites can run in parallel workers. */
export function nextPortRange(): { start: number; end: number } {
  const start = portCursor + Math.floor(Math.random() * 400);
  portCursor = start + 12;
  return { start, end: start + 10 };
}

export function composeTestServices(overrides: Partial<CompositionAdapters> = {}): Services {
  return composeServices({
    dataDir: tempDir(),
    protector: createFakeProtector(),
    helper: new FakeHelperClient({ fixtureDelayScale: 0 }),
    screenSource: new FixtureScreenSource({ readPng: (name) => fixtures.readScreenshotPng(name), initial: "genericBlank" }),
    permissionSystem: createGrantedPermissionSystem(),
    power: { onBattery: () => false, thermalState: () => "nominal", idleSeconds: () => 0 },
    resizer: nodePngResizer,
    fixturesDir: FIXTURES_DIR,
    logger: silentLogger,
    logToConsole: false,
    settleMs: 0,
    loopbackPortRange: nextPortRange(),
    ...overrides
  });
}

/** Approves every approval request and confirms every question through the IPC handler path. */
export function autoApprove(services: Services, options: { decision?: "approved" | "rejected"; confirm?: boolean } = {}): () => void {
  const handlers = createIpcHandlers(services);
  const ctx = { senderId: 0 };
  return services.hub.subscribe((name, payload) => {
    if (name === "event:approvalRequest") {
      const request = payload as ApprovalRequest;
      queueMicrotask(() => {
        try {
          void handlers["runs:approve"]({ runId: request.runId, stepId: request.stepId, decision: options.decision ?? "approved", scope: "once" }, ctx);
        } catch {
          // already resolved
        }
      });
    }
    if (name === "event:run") {
      const detail = (payload as { detail: RunDetail }).detail;
      if (detail.pendingQuestion && options.confirm !== false) {
        const question = detail.pendingQuestion;
        queueMicrotask(() => {
          try {
            void handlers["runs:answer"]({ runId: detail.run.id, stepId: question.stepId, answer: "yes", confirmSubtask: true }, ctx);
          } catch {
            // already answered
          }
        });
      }
    }
  });
}

/** Loads a fixture occurrence and re-homes it into `sessionId` starting at `startTs`. */
export function scenarioEvents(scenario: ScenarioName, occurrence: number, sessionId: string, startTs: number, seqStart = 0): ActivityEvent[] {
  const fixture = loadScenarioFixture(scenario, occurrence);
  const first = fixture.events[0];
  const delta = first ? startTs - first.ts : 0;
  return fixture.events.map((event, index) => ({ ...event, id: `${sessionId}-e${seqStart + index}`, seq: seqStart + index, sessionId, ts: event.ts + delta }));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(predicate: () => boolean, timeoutMs = 5000, stepMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor: condition not met in time");
    await sleep(stepMs);
  }
}
