/**
 * Opt-in latency and resource benchmark against a real OpenAI-compatible
 * endpoint (normally the managed llama-server with UI-Mate-9B).
 *
 *   RUN_LOCAL_MODEL_BENCH=1 pnpm --filter @apprentice/model-adapters bench:local-model
 *
 * Environment:
 *   APPRENTICE_MODEL_BASE_URL   default http://127.0.0.1:8000/v1
 *   APPRENTICE_MODEL_NAME       default UI_Mate
 *   APPRENTICE_BENCH_IMAGES     comma-separated PNG paths (default: one synthetic 1280x800 image)
 *   APPRENTICE_BENCH_TURNS      proposals per scenario in one run session (default 2)
 *   APPRENTICE_BENCH_IMAGES_TO_KEEP  screenshots kept in the prompt history (default 2, the desktop app's managed-runtime value)
 *   APPRENTICE_BENCH_OUT        JSON report path (default: none)
 *   APPRENTICE_BENCH_LABEL      free-text label stored in the report (context size, quant, ...)
 *
 * Each turn sends a slightly different screenshot (a small marker square is
 * painted at a turn-specific position) so llama-server cannot reuse image
 * tokens across turns, which is what a real run looks like.
 *
 * Every scenario goes through the real UIMateProvider (official prompt, history
 * collapsing, parser), so the numbers describe exactly what the desktop app
 * pays per step. llama-server's non-standard `timings` and `usage` fields are
 * captured from the raw reply; wall time is measured around the provider call.
 * Memory is sampled from the llama-server process (RSS) and from the GPU
 * accelerator's "In use system memory" counter while a scenario runs.
 */
import { execFile } from "node:child_process";
import { PNG } from "pngjs";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { ProviderTypeSchema } from "@apprentice/schemas";
import { createProvider } from "../src/providers/factory.js";
import { readPngDimensions } from "../src/providers/image.js";
import { makeSyntheticPngBase64 } from "../src/testing/png.js";
import { processImageDims } from "../src/uimate/resize.js";

const execFileAsync = promisify(execFile);

const ENABLED = process.env["RUN_LOCAL_MODEL_BENCH"] === "1";
const BASE_URL = process.env["APPRENTICE_MODEL_BASE_URL"] ?? "http://127.0.0.1:8000/v1";
const MODEL = process.env["APPRENTICE_MODEL_NAME"] ?? "UI_Mate";
const PROVIDER = ProviderTypeSchema.catch("uimate").parse(process.env["APPRENTICE_MODEL_PROVIDER"] ?? "uimate");
const TURNS = Math.max(1, Number(process.env["APPRENTICE_BENCH_TURNS"] ?? "2"));
const IMAGES_TO_KEEP = Math.max(1, Number(process.env["APPRENTICE_BENCH_IMAGES_TO_KEEP"] ?? "2"));
const OUT = process.env["APPRENTICE_BENCH_OUT"];
const LABEL = process.env["APPRENTICE_BENCH_LABEL"] ?? "";
const IMAGES = (process.env["APPRENTICE_BENCH_IMAGES"] ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
const SAMPLE_INTERVAL_MS = 500;

interface RawTimings {
  readonly prompt_n?: number;
  readonly prompt_ms?: number;
  readonly prompt_per_second?: number;
  readonly predicted_n?: number;
  readonly predicted_ms?: number;
  readonly predicted_per_second?: number;
  readonly cache_n?: number;
}

interface RawUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
}

interface CallRecord {
  readonly turn: number;
  readonly wallMs: number;
  readonly providerLatencyMs?: number;
  readonly usage?: RawUsage;
  readonly timings?: RawTimings;
  readonly httpStatus?: number;
  readonly action?: string;
  readonly controlToken?: string;
  readonly actionSummary?: string;
  readonly parseErrors?: readonly string[];
  readonly error?: string;
}

interface MemorySample {
  readonly rssBytes: number;
  readonly gpuInUseBytes: number;
}

interface ScenarioRecord {
  readonly name: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly modelWidth: number;
  readonly modelHeight: number;
  readonly estimatedImageTokens: number;
  readonly calls: readonly CallRecord[];
  readonly memoryBefore: MemorySample;
  readonly memoryPeak: MemorySample;
}

const scenarios: ScenarioRecord[] = [];

async function llamaServerPid(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", "llama-server"]);
    const pid = Number(stdout.trim().split("\n")[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function gpuInUseBytes(): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ioreg", ["-r", "-d", "1", "-c", "IOAccelerator"]);
    const match = /"In use system memory"=(\d+)/.exec(stdout);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

async function sampleMemory(pid: number | null): Promise<MemorySample> {
  let rssBytes = 0;
  if (pid !== null) {
    try {
      const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", String(pid)]);
      rssBytes = Number(stdout.trim()) * 1024;
    } catch {
      rssBytes = 0;
    }
  }
  return { rssBytes, gpuInUseBytes: await gpuInUseBytes() };
}

function maxSample(a: MemorySample, b: MemorySample): MemorySample {
  return { rssBytes: Math.max(a.rssBytes, b.rssBytes), gpuInUseBytes: Math.max(a.gpuInUseBytes, b.gpuInUseBytes) };
}

function startSampler(pid: number | null): { stop: () => Promise<MemorySample> } {
  let peak: MemorySample = { rssBytes: 0, gpuInUseBytes: 0 };
  let running = true;
  const loop = (async () => {
    while (running) {
      peak = maxSample(peak, await sampleMemory(pid));
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS));
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
      return maxSample(peak, await sampleMemory(pid));
    }
  };
}

interface Captured {
  usage?: RawUsage;
  timings?: RawTimings;
  status?: number;
}

/** Wraps global fetch so the raw llama-server reply fields are visible next to the provider result. */
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

const SKILL = {
  name: "File an invoice",
  subtasks: [
    { title: "Open the invoice PDF", goal: "Open the invoice PDF from the Finder window in Preview", completionCriteria: "Preview shows the invoice", keySteps: ["Double-click the PDF in Finder"] },
    { title: "Read the total", goal: "Find the total amount on the invoice", completionCriteria: "The total amount is visible", keySteps: ["Scroll to the total line"] },
    { title: "Record the invoice", goal: "Append a line with vendor and total to the ledger in TextEdit and save", completionCriteria: "The ledger contains the new line and is saved", keySteps: ["Switch to TextEdit", "Type the line", "Press cmd+s"] }
  ]
};

/** Paint a 48 px marker at a turn-specific spot so each turn's image tokens differ. */
function varyImage(image: { pngBase64: string; width: number; height: number }, turn: number): { pngBase64: string; width: number; height: number } {
  const png = PNG.sync.read(Buffer.from(image.pngBase64, "base64"));
  const size = 48;
  const x0 = Math.min(png.width - size, (turn * 64) % png.width);
  const y0 = Math.min(png.height - size, 8 + turn * 8);
  for (let y = y0; y < y0 + size; y += 1) {
    for (let x = x0; x < x0 + size; x += 1) {
      const offset = (png.width * y + x) * 4;
      png.data[offset] = 220;
      png.data[offset + 1] = 40 + turn * 30;
      png.data[offset + 2] = 40;
      png.data[offset + 3] = 255;
    }
  }
  return { pngBase64: PNG.sync.write(png).toString("base64"), width: png.width, height: png.height };
}

function loadImage(path: string): { pngBase64: string; width: number; height: number } {
  const png = readFileSync(path);
  const dims = readPngDimensions(png);
  if (!dims) throw new Error(`${path} is not a PNG`);
  return { pngBase64: png.toString("base64"), width: dims.width, height: dims.height };
}

function syntheticImage(): { pngBase64: string; width: number; height: number } {
  return { pngBase64: makeSyntheticPngBase64({ width: 1280, height: 800, background: [210, 210, 210], rect: { x: 520, y: 340, w: 240, h: 120, color: [30, 90, 220] } }), width: 1280, height: 800 };
}

async function runScenario(name: string, image: { pngBase64: string; width: number; height: number }): Promise<ScenarioRecord> {
  const sink: Captured[] = [];
  const provider = createProvider({ providerType: PROVIDER, baseUrl: BASE_URL, model: MODEL, fetchImpl: capturingFetch(sink), timeoutMs: 600000, imagesToKeep: IMAGES_TO_KEEP });
  const pid = await llamaServerPid();
  const memoryBefore = await sampleMemory(pid);
  const sampler = startSampler(pid);
  const calls: CallRecord[] = [];
  const runId = `bench_${name.replace(/[^a-z0-9]/gi, "_")}`;
  for (let turn = 0; turn < TURNS; turn += 1) {
    const before = sink.length;
    const started = performance.now();
    try {
      const result = await provider.proposeNextAction({
        runId,
        sessionId: "bench_session",
        instruction: "File an invoice: open the PDF, read the total, record it in the ledger",
        skill: SKILL,
        currentSubtaskIndex: 0,
        priorActions: calls.map((call, index) => ({ stepIndex: index, summary: call.actionSummary ?? "previous step" })),
        screenshot: { id: `bench_${turn}`, ...varyImage(image, turn) },
        platform: "macos",
        variables: {}
      });
      const raw = sink[sink.length - 1];
      calls.push({
        turn,
        wallMs: Math.round(performance.now() - started),
        providerLatencyMs: Math.round(result.latencyMs),
        usage: sink.length > before ? raw?.usage : undefined,
        timings: sink.length > before ? raw?.timings : undefined,
        httpStatus: raw?.status,
        action: result.action?.type ?? "none",
        controlToken: result.controlToken,
        actionSummary: result.actionSummary,
        parseErrors: result.parseErrors
      });
    } catch (error) {
      const raw = sink[sink.length - 1];
      calls.push({ turn, wallMs: Math.round(performance.now() - started), httpStatus: raw?.status, error: error instanceof Error ? error.message.slice(0, 500) : String(error) });
    }
  }
  const memoryPeak = await sampler.stop();
  await provider.resetSession(runId);
  const model = processImageDims(image.width, image.height);
  return {
    name,
    imageWidth: image.width,
    imageHeight: image.height,
    modelWidth: model.width,
    modelHeight: model.height,
    estimatedImageTokens: Math.round((model.width / 32) * (model.height / 32)),
    calls,
    memoryBefore,
    memoryPeak
  };
}

function gb(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function summarize(record: ScenarioRecord): string {
  const rows = record.calls.map((call) => {
    const t = call.timings;
    const prompt = t?.prompt_n !== undefined ? `${t.prompt_n} tok / ${Math.round(t.prompt_ms ?? 0)} ms (${Math.round(t.prompt_per_second ?? 0)} tok/s)` : "n/a";
    const gen = t?.predicted_n !== undefined ? `${t.predicted_n} tok / ${Math.round(t.predicted_ms ?? 0)} ms (${(t.predicted_per_second ?? 0).toFixed(1)} tok/s)` : "n/a";
    const outcome = call.error ? `ERROR ${call.error.slice(0, 120)}` : `${call.action}${call.controlToken ? ` [${call.controlToken}]` : ""}${call.parseErrors?.length ? ` parseErrors=${call.parseErrors.length}` : ""}`;
    return `  turn ${call.turn}: wall ${call.wallMs} ms | prompt ${prompt} | cached ${t?.cache_n ?? "n/a"} | gen ${gen} | usage ${call.usage?.prompt_tokens ?? "?"}+${call.usage?.completion_tokens ?? "?"} | ${outcome}`;
  });
  return [
    `${record.name}: ${record.imageWidth}x${record.imageHeight} -> model ${record.modelWidth}x${record.modelHeight} (~${record.estimatedImageTokens} image tokens)`,
    `  llama-server RSS before ${gb(record.memoryBefore.rssBytes)}, peak ${gb(record.memoryPeak.rssBytes)}; GPU in-use before ${gb(record.memoryBefore.gpuInUseBytes)}, peak ${gb(record.memoryPeak.gpuInUseBytes)}`,
    ...rows
  ].join("\n");
}

describe("local model benchmark", () => {
  if (!ENABLED) {
    it.skip("skipped: set RUN_LOCAL_MODEL_BENCH=1", () => undefined);
    return;
  }

  it("health", async () => {
    const provider = createProvider({ providerType: PROVIDER, baseUrl: BASE_URL, model: MODEL });
    const health = await provider.health();
    console.log("health:", JSON.stringify(health));
    expect(health.ok, health.message).toBe(true);
  });

  const inputs = IMAGES.length > 0 ? IMAGES.map((path) => ({ name: basename(path), load: () => loadImage(path) })) : [{ name: "synthetic-1280x800", load: syntheticImage }];
  for (const input of inputs) {
    it(`scenario ${input.name}`, async () => {
      const record = await runScenario(input.name, input.load());
      scenarios.push(record);
      console.log(summarize(record));
      expect(record.calls.length).toBe(TURNS);
    });
  }

  afterAll(() => {
    if (!OUT) return;
    const report = { generatedAt: new Date().toISOString(), baseUrl: BASE_URL, model: MODEL, provider: PROVIDER, label: LABEL, turns: TURNS, imagesToKeep: IMAGES_TO_KEEP, scenarios };
    writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report written to ${OUT}`);
  });
});
