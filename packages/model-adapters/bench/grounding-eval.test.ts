/**
 * Opt-in GUI-grounding accuracy benchmark against a real OpenAI-compatible
 * endpoint (normally the managed llama-server with UI-Mate-9B).
 *
 *   RUN_GROUNDING_EVAL=1 pnpm bench:grounding
 *
 * Every case is a real macOS window screenshot plus one natural instruction,
 * with a ground-truth rectangle taken from the accessibility tree. Build the
 * manifest first:
 *
 *   node scripts/make-grounding-cases.mjs --out dist/grounding-cases
 *
 * Environment:
 *   APPRENTICE_GROUNDING_CASES     manifest path (default dist/grounding-cases/cases.json)
 *   APPRENTICE_GROUNDING_OUT       JSON report path (default: none)
 *   APPRENTICE_GROUNDING_TOLERANCE hit tolerance in manifest pixels (default 6)
 *   APPRENTICE_GROUNDING_LIMIT     evaluate only the first N cases
 *   APPRENTICE_GROUNDING_APPS      comma-separated app filter
 *   APPRENTICE_GROUNDING_LABEL     free-text label stored in the report
 *   APPRENTICE_MODEL_BASE_URL      default http://127.0.0.1:8000/v1
 *   APPRENTICE_MODEL_NAME          default UI_Mate
 *   APPRENTICE_MODEL_PROVIDER      default uimate
 *
 * Each case is an independent single-subtask run: the session is reset before
 * and after, so no case sees another case's history and the score measures
 * one-shot grounding. The screenshot goes through the real provider (official
 * prompt, parser, coordinate handling), and llama-server's `usage` and
 * `timings` fields are captured from the raw reply through a fetch wrapper, the
 * same technique as bench/local-model-bench.test.ts.
 *
 * APPRENTICE_GROUNDING_TEMPERATURE and APPRENTICE_GROUNDING_THINKING ("1" or "0")
 * are passed through createProvider; unset keeps the provider defaults
 * (temperature 1.0, thinking on).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ProviderTypeSchema, type ProposedAction } from "@apprentice/schemas";
import { createProvider } from "../src/providers/factory.js";
import { readPngDimensions } from "../src/providers/image.js";
import type { VisionAgentProvider } from "../src/providers/types.js";
import {
  GroundingManifestSchema,
  aggregate,
  formatOutcomesMarkdown,
  formatSummaryMarkdown,
  scoreCase,
  type GroundingCase,
  type GroundingOutcome,
  type GroundingProposal
} from "./grounding-score.js";

const ENABLED = process.env["RUN_GROUNDING_EVAL"] === "1";
const BASE_URL = process.env["APPRENTICE_MODEL_BASE_URL"] ?? "http://127.0.0.1:8000/v1";
const MODEL = process.env["APPRENTICE_MODEL_NAME"] ?? "UI_Mate";
const PROVIDER = ProviderTypeSchema.catch("uimate").parse(process.env["APPRENTICE_MODEL_PROVIDER"] ?? "uimate");
const CASES_PATH = process.env["APPRENTICE_GROUNDING_CASES"] ?? "dist/grounding-cases/cases.json";
const OUT = process.env["APPRENTICE_GROUNDING_OUT"];
const LABEL = process.env["APPRENTICE_GROUNDING_LABEL"] ?? "";
const TOLERANCE = Number(process.env["APPRENTICE_GROUNDING_TOLERANCE"] ?? "6");
const LIMIT = Number(process.env["APPRENTICE_GROUNDING_LIMIT"] ?? "0");
const APPS = (process.env["APPRENTICE_GROUNDING_APPS"] ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
const THINKING = process.env["APPRENTICE_GROUNDING_THINKING"];
const REQUEST_TIMEOUT_MS = 600000;

interface RawUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
}

interface RawTimings {
  readonly prompt_n?: number;
  readonly prompt_ms?: number;
  readonly predicted_n?: number;
  readonly predicted_ms?: number;
  readonly cache_n?: number;
}

interface Captured {
  usage?: RawUsage;
  timings?: RawTimings;
  status?: number;
}

/** Wraps global fetch so the raw llama-server reply fields sit next to the result. */
function capturingFetch(sink: Captured[]): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (String(input).endsWith("chat/completions")) {
      const entry: Captured = { status: response.status };
      sink.push(entry);
      try {
        const body = (await response.clone().json()) as { usage?: RawUsage; timings?: RawTimings };
        entry.usage = body.usage;
        entry.timings = body.timings;
      } catch {
        // Non-JSON replies are reported through the provider's own error.
      }
    }
    return response;
  };
}

/** Sampling temperature for the run; unset keeps the provider default (the official 1.0). */
const TEMPERATURE = process.env["APPRENTICE_GROUNDING_TEMPERATURE"] === undefined ? undefined : Number(process.env["APPRENTICE_GROUNDING_TEMPERATURE"]);

function buildProvider(sink: Captured[]): VisionAgentProvider {
  const shared = { baseUrl: BASE_URL, model: MODEL, fetchImpl: capturingFetch(sink), timeoutMs: REQUEST_TIMEOUT_MS, imagesToKeep: 1 };
  if (TEMPERATURE !== undefined && (!Number.isFinite(TEMPERATURE) || TEMPERATURE < 0)) {
    throw new Error(`APPRENTICE_GROUNDING_TEMPERATURE must be a non-negative number, got ${String(process.env["APPRENTICE_GROUNDING_TEMPERATURE"])}`);
  }
  return createProvider({
    providerType: PROVIDER,
    ...shared,
    temperature: TEMPERATURE,
    enableThinking: THINKING === undefined ? undefined : THINKING === "1"
  });
}

/**
 * The package scripts run from packages/model-adapters, so a relative manifest
 * path is tried there first and then at the repository root.
 */
function resolveManifestPath(): string {
  if (isAbsolute(CASES_PATH)) {
    return CASES_PATH;
  }
  const fromCwd = resolve(process.cwd(), CASES_PATH);
  if (existsSync(fromCwd)) {
    return fromCwd;
  }
  const fromRepoRoot = resolve(process.cwd(), "..", "..", CASES_PATH);
  return existsSync(fromRepoRoot) ? fromRepoRoot : fromCwd;
}

function loadCases(): readonly GroundingCase[] {
  const manifestPath = resolveManifestPath();
  const manifest = GroundingManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const baseDir = dirname(manifestPath);
  const selected = APPS.length === 0 ? manifest.cases : manifest.cases.filter((entry) => APPS.includes(entry.app));
  const limited = LIMIT > 0 ? selected.slice(0, LIMIT) : selected;
  return limited.map((entry) => ({ ...entry, image: isAbsolute(entry.image) ? entry.image : resolve(baseDir, entry.image) }));
}

/** One subtask whose goal is exactly the instruction under test. */
function skillFor(testCase: GroundingCase): { name: string; subtasks: { title: string; goal: string; completionCriteria: string; keySteps: string[] }[] } {
  return {
    name: `Grounding probe (${testCase.app})`,
    subtasks: [
      {
        title: testCase.instruction.slice(0, 120),
        goal: testCase.instruction,
        completionCriteria: `The target of "${testCase.instruction}" has been acted on`.slice(0, 500),
        keySteps: [testCase.instruction.slice(0, 300)]
      }
    ]
  };
}

function proposalFrom(action: ProposedAction | null): GroundingProposal | null {
  if (action === null) {
    return null;
  }
  const source = { sourceWidth: action.sourceScreenshot.width, sourceHeight: action.sourceScreenshot.height };
  if (action.type === "click" || action.type === "double_click" || action.type === "move" || action.type === "scroll") {
    return { type: action.type, x: action.x, y: action.y, ...source };
  }
  return { type: action.type, ...source };
}

const outcomes: GroundingOutcome[] = [];

async function evaluateCase(testCase: GroundingCase): Promise<GroundingOutcome> {
  const sink: Captured[] = [];
  const provider = buildProvider(sink);
  const runId = `grounding_${testCase.id.replace(/[^a-z0-9]/gi, "_")}`;
  const png = readFileSync(testCase.image);
  const dims = readPngDimensions(png);
  if (!dims) {
    throw new Error(`${testCase.image} is not a PNG`);
  }
  if (dims.width !== testCase.imageWidth || dims.height !== testCase.imageHeight) {
    throw new Error(`${testCase.image} is ${dims.width}x${dims.height}, manifest says ${testCase.imageWidth}x${testCase.imageHeight}`);
  }
  const base = {
    id: testCase.id,
    app: testCase.app,
    role: testCase.role,
    label: testCase.label,
    instruction: testCase.instruction,
    expectedAction: testCase.expectedAction
  };
  const started = performance.now();
  try {
    const result = await provider.proposeNextAction({
      runId,
      sessionId: runId,
      instruction: testCase.instruction,
      skill: skillFor(testCase),
      currentSubtaskIndex: 0,
      priorActions: [],
      screenshot: { id: `shot_${testCase.id.replace(/[^a-z0-9]/gi, "_")}`, pngBase64: png.toString("base64"), width: dims.width, height: dims.height },
      platform: "macos",
      variables: {}
    });
    const latencyMs = performance.now() - started;
    const raw = sink[sink.length - 1];
    const score = scoreOne(testCase, result.action);
    return {
      ...base,
      ...score,
      parsed: result.action !== null,
      latencyMs,
      ...(raw?.usage?.prompt_tokens !== undefined ? { promptTokens: raw.usage.prompt_tokens } : {}),
      ...(raw?.usage?.completion_tokens !== undefined ? { completionTokens: raw.usage.completion_tokens } : {}),
      ...(result.parseErrors.length > 0 ? { parseErrors: result.parseErrors } : {})
    };
  } catch (error) {
    return {
      ...base,
      actionType: null,
      actionTypeMatches: false,
      hit: false,
      parsed: false,
      point: null,
      mappedPoint: null,
      distancePx: null,
      latencyMs: performance.now() - started,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error)
    };
  } finally {
    await provider.resetSession(runId);
  }
}

function scoreOne(testCase: GroundingCase, action: ProposedAction | null): Pick<GroundingOutcome, "hit" | "actionType" | "actionTypeMatches" | "point" | "mappedPoint" | "distancePx"> {
  const tolerance = Number.isFinite(TOLERANCE) && TOLERANCE >= 0 ? TOLERANCE : 0;
  const { hit, actionType, actionTypeMatches, point, mappedPoint, distancePx } = scoreCase(testCase, proposalFrom(action), tolerance);
  return { hit, actionType, actionTypeMatches, point, mappedPoint, distancePx };
}

describe("UI-Mate GUI grounding accuracy", () => {
  if (!ENABLED) {
    it.skip("skipped: set RUN_GROUNDING_EVAL=1", () => undefined);
    return;
  }

  const cases = loadCases();

  it("health", async () => {
    const provider = createProvider({ providerType: PROVIDER, baseUrl: BASE_URL, model: MODEL });
    const health = await provider.health();
    console.log("health:", JSON.stringify(health));
    expect(health.ok, health.message).toBe(true);
  });

  for (const testCase of cases) {
    it(`${testCase.id} ${testCase.instruction}`, async () => {
      const outcome = await evaluateCase(testCase);
      outcomes.push(outcome);
      const point = outcome.mappedPoint ? `${Math.round(outcome.mappedPoint.x)},${Math.round(outcome.mappedPoint.y)}` : "none";
      console.log(
        `${outcome.id}: ${outcome.hit ? "HIT " : "MISS"} action=${outcome.actionType ?? "none"} point=${point} rect=${testCase.rect.x},${testCase.rect.y},${testCase.rect.width},${testCase.rect.height} dist=${outcome.distancePx === null ? "n/a" : Math.round(outcome.distancePx)} ${Math.round(outcome.latencyMs)} ms${outcome.error ? ` error=${outcome.error}` : ""}`
      );
      expect(outcome.latencyMs).toBeGreaterThan(0);
    });
  }

  afterAll(() => {
    if (outcomes.length === 0) {
      return;
    }
    const summary = aggregate(outcomes);
    console.log(`\n${formatSummaryMarkdown(summary)}\n\n${formatOutcomesMarkdown(outcomes)}`);
    if (!OUT) {
      return;
    }
    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      model: MODEL,
      provider: PROVIDER,
      label: LABEL,
      casesPath: CASES_PATH,
      tolerancePx: TOLERANCE,
      thinking: THINKING ?? "provider default",
      temperature: TEMPERATURE ?? "provider default",
      summary,
      outcomes
    };
    writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report written to ${OUT}`);
  });
});
