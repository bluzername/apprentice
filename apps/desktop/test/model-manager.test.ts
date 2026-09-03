import { describe, expect, it } from "vitest";
import { systemClock } from "../src/main/services/clock.js";
import { createRecordingEmitter } from "../src/main/services/events.js";
import { HardwareService } from "../src/main/services/hardware.js";
import { nodePngResizer } from "../src/main/services/images/png-resize.js";
import { toImageResizer } from "../src/main/services/images/png-resize.js";
import { silentLogger } from "../src/main/services/logger.js";
import { MODEL_MANIFEST } from "../src/main/services/model/manifest.js";
import { ModelManager } from "../src/main/services/model/model-manager.js";
import { RuntimeManager } from "../src/main/services/model/runtime-manager.js";
import { chatReply, countImagesInBody, createFakeFetch, modelsReply, routeByPath } from "../../../packages/model-adapters/src/testing/fake-fetch.js";
import { makeContext } from "./helpers.js";

const CLICK_REPLY = "<action>\nClick the button.\n</action>\n\n<tool_call>\n<function=computer_use>\n<parameter=action>\nleft_click\n</parameter>\n<parameter=coordinate>\n[500, 500]\n</parameter>\n</function>\n</tool_call>";

function setup(options: { fetchImpl?: typeof fetch; runtime?: RuntimeManager } = {}) {
  const context = makeContext();
  const recorder = createRecordingEmitter();
  const runtime = options.runtime ?? new RuntimeManager({ paths: context.paths, manifest: MODEL_MANIFEST, clock: systemClock, logger: silentLogger });
  const manager = new ModelManager({
    fetchImpl: options.fetchImpl,
    settings: context.settings,
    secrets: context.secrets,
    runtime,
    manifest: MODEL_MANIFEST,
    hardware: new HardwareService(context.paths.root),
    metrics: context.metrics,
    analytics: context.analytics,
    clock: systemClock,
    logger: silentLogger,
    emit: recorder.emit,
    power: { onBattery: () => false, thermalState: () => "nominal", idleSeconds: () => 0 },
    resizer: toImageResizer(nodePngResizer),
    healthIntervalMs: 60_000
  });
  return { context, recorder, runtime, manager };
}

/** A managed runtime that reports running on a loopback port without spawning anything. */
function runningRuntimeStub(baseUrl: string, options: { running?: boolean; starts?: number[] } = {}): RuntimeManager {
  let running = options.running ?? true;
  const state = () => ({ runtimeInstalled: true, modelInstalled: true, processState: running ? ("running" as const) : ("stopped" as const), port: running ? 8000 : undefined });
  const stub = {
    onChange: () => () => undefined,
    baseUrl: () => (running ? baseUrl : null),
    isRunning: () => running,
    state,
    start: () => {
      running = true;
      options.starts?.push(Date.now());
      return Promise.resolve(state());
    },
    restart: () => Promise.resolve(state()),
    stop: () => {
      running = false;
      return Promise.resolve(state());
    }
  };
  return stub as unknown as RuntimeManager;
}

function proposal(turn: number) {
  return {
    runId: "run_images",
    sessionId: "session_images",
    instruction: "File the invoice",
    skill: { name: "File the invoice", subtasks: [{ title: "Open the PDF", goal: "Open the PDF", completionCriteria: "Preview shows the PDF", keySteps: [] }] },
    currentSubtaskIndex: 0,
    priorActions: [],
    screenshot: { id: `shot_${turn}`, pngBase64: "QUJD", width: 1280, height: 800 },
    platform: "macos" as const,
    variables: {}
  };
}

describe("model manager", () => {
  it("switches from the mock provider to the managed UI-Mate provider when the local runtime is started", async () => {
    const baseUrl = "http://127.0.0.1:8000/v1";
    const fake = createFakeFetch(routeByPath({ models: () => modelsReply(["UI_Mate"]), chat: () => chatReply(CLICK_REPLY) }));
    const { manager, context } = setup({ fetchImpl: fake.fetchImpl, runtime: runningRuntimeStub(baseUrl) });
    expect(context.settings.get().model.providerType).toBe("mock");
    const status = await manager.runtimeAction("start", true);
    expect(context.settings.get().model).toMatchObject({ providerType: "uimate", managedRuntime: true });
    expect(status.providerType).toBe("uimate");
    expect(status.location).toBe("local_managed");
    expect(status.health?.ok).toBe(true);
    const result = await manager.propose(proposal(0));
    expect(result.provider).toBe("uimate");
  });

  it("starts the managed runtime at launch when the user chose it", async () => {
    const baseUrl = "http://127.0.0.1:8000/v1";
    const fake = createFakeFetch(routeByPath({ models: () => modelsReply(["UI_Mate"]), chat: () => chatReply(CLICK_REPLY) }));
    const starts: number[] = [];
    const { manager, context } = setup({ fetchImpl: fake.fetchImpl, runtime: runningRuntimeStub(baseUrl, { running: false, starts }) });
    context.settings.update({ model: { ...context.settings.get().model, providerType: "uimate", managedRuntime: true } });
    manager.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(starts).toHaveLength(1);
    const status = await manager.status();
    expect(status.location).toBe("local_managed");
    expect(status.health?.ok).toBe(true);
    manager.stop();
  });

  it("does not start the managed runtime at launch for the mock provider", async () => {
    const starts: number[] = [];
    const { manager } = setup({ runtime: runningRuntimeStub("http://127.0.0.1:8000/v1", { running: false, starts }) });
    manager.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(starts).toHaveLength(0);
    manager.stop();
  });

  it("leaves the provider alone when the runtime is stopped", async () => {
    const baseUrl = "http://127.0.0.1:8000/v1";
    const fake = createFakeFetch(routeByPath({ models: () => modelsReply(["UI_Mate"]), chat: () => chatReply(CLICK_REPLY) }));
    const { manager, context } = setup({ fetchImpl: fake.fetchImpl, runtime: runningRuntimeStub(baseUrl) });
    await manager.runtimeAction("start", true);
    await manager.runtimeAction("stop", true);
    expect(context.settings.get().model).toMatchObject({ providerType: "uimate", managedRuntime: true });
  });

  it("keeps only the manifest's imagesToKeep screenshots in the managed runtime's prompt", async () => {
    const baseUrl = "http://127.0.0.1:8000/v1";
    const fake = createFakeFetch(routeByPath({ models: () => modelsReply(["UI_Mate"]), chat: () => chatReply(CLICK_REPLY) }));
    const { manager, context } = setup({ fetchImpl: fake.fetchImpl, runtime: runningRuntimeStub(baseUrl) });
    context.settings.update({ model: { ...context.settings.get().model, providerType: "uimate", managedRuntime: true } });
    expect(MODEL_MANIFEST.model.imagesToKeep).toBe(8);
    for (let turn = 0; turn < 10; turn += 1) await manager.propose(proposal(turn));
    const chats = fake.requests.filter((request) => request.url.endsWith("chat/completions"));
    expect(chats.length).toBe(10);
    expect(countImagesInBody(chats[0]!.body)).toBe(1);
    expect((chats[0]!.body as { max_tokens?: number }).max_tokens).toBe(MODEL_MANIFEST.model.maxTokens);
    expect(MODEL_MANIFEST.model.maxTokens).toBe(2048);
    expect(countImagesInBody(chats[7]!.body)).toBe(8);
    expect(countImagesInBody(chats[9]!.body)).toBe(MODEL_MANIFEST.model.imagesToKeep);
  });

  it("drives the managed runtime with the manifest's sampling values", async () => {
    const baseUrl = "http://127.0.0.1:8000/v1";
    const fake = createFakeFetch(routeByPath({ models: () => modelsReply(["UI_Mate"]), chat: () => chatReply(CLICK_REPLY) }));
    const { manager, context } = setup({ fetchImpl: fake.fetchImpl, runtime: runningRuntimeStub(baseUrl) });
    context.settings.update({ model: { ...context.settings.get().model, providerType: "uimate", managedRuntime: true } });
    await manager.propose(proposal(0));
    const chat = fake.requests.find((request) => request.url.endsWith("chat/completions"));
    expect(chat?.body).toMatchObject({
      temperature: MODEL_MANIFEST.model.sampling.temperature,
      top_p: MODEL_MANIFEST.model.sampling.topP,
      chat_template_kwargs: { enable_thinking: MODEL_MANIFEST.model.sampling.enableThinking }
    });
    expect(MODEL_MANIFEST.model.sampling.temperature).toBe(0.2);
    expect(MODEL_MANIFEST.model.sampling.topP).toBe(0.95);
    expect(MODEL_MANIFEST.model.sampling.enableThinking).toBe(false);
  });

  it("skips the analysis round trip when only the deterministic stand-in is configured", async () => {
    const baseUrl = "http://127.0.0.1:8000/v1";
    const fake = createFakeFetch(routeByPath({ models: () => modelsReply(["UI_Mate"]), chat: () => chatReply(CLICK_REPLY) }));
    const { manager, context } = setup({ fetchImpl: fake.fetchImpl, runtime: runningRuntimeStub(baseUrl) });
    context.settings.update({ model: { ...context.settings.get().model, providerType: "uimate", managedRuntime: true } });
    expect(manager.analysisIsDeterministic()).toBe(true);
    expect(manager.supportsVerification()).toBe(false);

    const before = fake.requests.length;
    const draft = {
      name: "File the invoice",
      description: "",
      goal: "",
      trigger: "An invoice PDF arrives",
      subtasks: [{ title: "Open the PDF", goal: "Open the PDF", completionCriteria: "Preview shows the PDF", keySteps: [] }],
      variables: [],
      successCriteria: [],
      riskNotes: [],
      allowedApps: [],
      allowedDomains: [],
      origin: "deterministic" as const,
      confidence: 0.5
    };
    const refined = await manager.refiner().refine({ deterministicDraft: draft, redactedSummary: "", actionTokens: [], screenshots: [] });
    expect(refined).toBeNull();
    // No HTTP call at all: not the draft request, and not the health probe it used to trigger.
    expect(fake.requests.length).toBe(before);
  });

  it("reports the mock provider as verification-capable", async () => {
    const { manager } = setup();
    expect(manager.analysisIsDeterministic()).toBe(false);
    await manager.checkHealth();
    expect(manager.supportsVerification()).toBe(true);
  });

  it("emits health and status while running", async () => {
    const { manager, recorder } = setup();
    manager.start();
    await manager.checkHealth();
    expect(recorder.of("event:modelHealth").length).toBeGreaterThanOrEqual(1);
    expect(recorder.of("event:modelHealth")[0]?.ok).toBe(true);
    manager.stop();
  });

  it("emits nothing after stop(), even when a late health check or runtime change arrives", async () => {
    const { manager, recorder, runtime } = setup();
    manager.start();
    await manager.checkHealth();
    manager.stop();
    const before = recorder.events.length;
    await manager.checkHealth();
    await runtime.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(manager.isStopped).toBe(true);
    expect(recorder.events.length).toBe(before);
  });
});
