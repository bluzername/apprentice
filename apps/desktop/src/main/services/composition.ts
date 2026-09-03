import { normalizeAppName } from "@apprentice/core";
import type { ExecutableAction, Overview } from "@apprentice/schemas";
import { createAppContext, type AppContext } from "./app-context.js";
import { ActivityService } from "./activity.js";
import { APP_VERSION } from "./app-version.js";
import { systemClock, type Clock } from "./clock.js";
import { CandidateActions } from "./discovery/candidate-actions.js";
import { DiscoveryScheduler } from "./discovery/scheduler.js";
import { DemoService } from "./demo/demo-service.js";
import { createFixtureSource } from "./demo/fixture-source.js";
import { EmitHub } from "./emit-hub.js";
import { FeedbackService } from "./feedback/feedback-service.js";
import { HardwareService, type HardwareProbe } from "./hardware.js";
import type { HelperClient } from "./helper/types.js";
import { toImageResizer, type PngResizer } from "./images/png-resize.js";
import { LearningStateService } from "./learning/learning-state.js";
import type { Logger } from "./logger.js";
import { LoopbackServer } from "./loopback/server.js";
import { MODEL_MANIFEST } from "./model/manifest.js";
import { ModelManager, type PowerProbe } from "./model/model-manager.js";
import { RuntimeManager } from "./model/runtime-manager.js";
import { CaptureService } from "./observation/capture-service.js";
import { ObservationPipeline } from "./observation/pipeline.js";
import type { ScreenSource } from "./observation/screen-source.js";
import { buildOverview } from "./overview.js";
import { PermissionsService, type PermissionSystem } from "./permissions.js";
import { PrivacyService } from "./privacy/privacy-service.js";
import { RunEngine } from "./runs/run-engine.js";
import type { Actuator, AppActivator, AxSource, DomStateSource, OcrSource, RunContextSource } from "./runs/types.js";
import type { KeyProtector } from "../security/keys.js";
import { SkillService } from "./skills/skill-service.js";
import { Switchable } from "./switchable.js";
import { TeachService } from "./teach/teach-service.js";

export interface ShellAdapter {
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  showItemInFolder(path: string): void;
}

export const noopShell: ShellAdapter = { openExternal: async () => undefined, openPath: async () => undefined, showItemInFolder: () => undefined };

export interface CompositionAdapters {
  readonly protector: KeyProtector;
  readonly helper: HelperClient;
  readonly screenSource: ScreenSource;
  readonly permissionSystem: PermissionSystem;
  readonly power: PowerProbe;
  readonly resizer: PngResizer;
  readonly fixturesDir: string;
  readonly shell?: ShellAdapter;
  readonly hardwareProbe?: HardwareProbe;
  readonly dataDir?: string;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly logToConsole?: boolean;
  readonly helperFixturePath?: string;
  readonly fetchImpl?: typeof fetch;
  readonly loopbackPortRange?: { start: number; end: number };
  readonly settleMs?: number;
}

export interface Services {
  readonly context: AppContext;
  readonly hub: EmitHub;
  readonly hardware: HardwareService;
  readonly helper: HelperClient;
  readonly permissions: PermissionsService;
  readonly learning: LearningStateService;
  readonly capture: CaptureService;
  readonly pipeline: ObservationPipeline;
  readonly scheduler: DiscoveryScheduler;
  readonly candidates: CandidateActions;
  readonly teach: TeachService;
  readonly skills: SkillService;
  readonly runEngine: RunEngine;
  readonly runtime: RuntimeManager;
  readonly model: ModelManager;
  readonly loopback: LoopbackServer;
  readonly feedback: FeedbackService;
  readonly privacy: PrivacyService;
  readonly demo: DemoService;
  readonly activity: ActivityService;
  readonly shell: ShellAdapter;
  readonly securePauses: () => number;
  overview(): Promise<Overview>;
  onRunActiveChange(listener: (active: boolean) => void): () => void;
  /** Fired when a run needs the user (approval or question); the Electron layer raises the window on that run. */
  onRunAttention(listener: (runId: string) => void): () => void;
  /** Called before and after every helper execution with the exact executable action. */
  onRunExecution(listener: (action: ExecutableAction, phase: "before" | "after") => Promise<void> | void): () => void;
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

const BROWSER_BUNDLE_RE = /chrome|browser|brave|edge|safari|firefox|chromium/i;

/** Builds every service with injected adapters; no Electron import anywhere below this line. */
export function composeServices(adapters: CompositionAdapters): Services {
  const context = createAppContext({ dataDir: adapters.dataDir, protector: adapters.protector, clock: adapters.clock ?? systemClock, logger: adapters.logger, logToConsole: adapters.logToConsole });
  const { logger, clock, metrics, analytics, settings, storage } = context;
  const hub = new EmitHub();
  const emit = hub.emit;
  const helper = adapters.helper;
  const hardware = new HardwareService(context.paths.root, adapters.hardwareProbe);
  const shell = adapters.shell ?? noopShell;
  const runActiveListeners: Array<(active: boolean) => void> = [];
  const runExecutionListeners: Array<(action: ExecutableAction, phase: "before" | "after") => Promise<void> | void> = [];
  const runAttentionListeners: Array<(runId: string) => void> = [];

  const screenSource = new Switchable<ScreenSource>(adapters.screenSource);
  const actuator = new Switchable<Actuator>({ perform: (action, token) => helper.performAction(action, token) });
  const appActivator = new Switchable<AppActivator>({ activate: (bundleId) => helper.activateApp(bundleId) });
  const ocr = new Switchable<OcrSource>({ ocr: async (png) => (await helper.ocrImage(png.toString("base64"))).blocks });
  const ax = new Switchable<AxSource>({
    elementAt: async (x, y) => {
      const hit = await helper.accessibilityContextAtPoint(x, y);
      return { element: hit.element, bundleId: hit.bundleId.length > 0 ? hit.bundleId : undefined };
    }
  });

  let securePauses = 0;
  helper.onEvent((event) => {
    if (event.event === "secureFieldFocused") securePauses += 1;
  });

  const permissions = new PermissionsService({ helper, system: adapters.permissionSystem, analytics, logger: logger.child("permissions") });
  const capture = new CaptureService({ storage, screenSource: { captureFrontmost: () => screenSource.current.captureFrontmost() }, ocr: (png) => helper.ocrImage(png), resizer: adapters.resizer, metrics, clock, logger: logger.child("capture"), sessionId: context.sessionId });

  const pipeline: ObservationPipeline = new ObservationPipeline({ storage, settings, helper, capture, sessionId: context.sessionId, emit, clock, logger: logger.child("pipeline"), isCapturing: () => learning.isCapturing(), fixturePath: adapters.helperFixturePath });
  const learning: LearningStateService = new LearningStateService({
    settings,
    emit,
    analytics,
    clock,
    logger: logger.child("learning"),
    observation: { start: () => pipeline.start(), stop: () => pipeline.stop() },
    model: { busy: () => model.busy(), unavailable: () => model.unavailable() }
  });
  // The menu bar and header derive "model unavailable" from the last health check; re-derive whenever it changes.
  hub.subscribe((name) => {
    if (name === "event:modelHealth") learning.refresh();
  });
  const scheduler = new DiscoveryScheduler({ storage, emit, analytics, clock, logger: logger.child("discovery") });
  pipeline.onStored(() => scheduler.schedule());

  const runtime = new RuntimeManager({ paths: context.paths, manifest: MODEL_MANIFEST, clock, logger: logger.child("runtime"), fetchImpl: adapters.fetchImpl });
  const model: ModelManager = new ModelManager({ settings, secrets: context.secrets, runtime, manifest: MODEL_MANIFEST, hardware, metrics, analytics, clock, logger: logger.child("model"), emit, power: adapters.power, resizer: toImageResizer(adapters.resizer), fetchImpl: adapters.fetchImpl });

  const teach = new TeachService({ storage, settings, analytics, clock, logger: logger.child("teach"), refiner: model.refiner() });
  const skills = new SkillService({ storage, analytics, clock });

  const loopback: LoopbackServer = new LoopbackServer({ storage, settings, ingest: (events) => pipeline.ingestExtensionBatch(events), learningState: () => learning.state(), runActive: () => runEngine.isActive(), emit, clock, logger: logger.child("loopback"), portRange: adapters.loopbackPortRange });
  const dom: Switchable<DomStateSource> = new Switchable<DomStateSource>({ query: (marker, timeoutMs) => loopback.queryDomState(marker, timeoutMs) });
  const runContext = new Switchable<RunContextSource>({
    frontmost: async () => {
      const ctx = await helper.frontmostContext();
      const nav = pipeline.latestNavigation();
      const isBrowser = BROWSER_BUNDLE_RE.test(ctx.app.bundleId) || BROWSER_BUNDLE_RE.test(normalizeAppName(ctx.app.bundleId, ctx.app.name));
      return { bundleId: ctx.app.bundleId, appName: ctx.app.name, windowTitle: ctx.window?.title, isSecureInput: ctx.isSecureInput, domain: isBrowser ? nav?.domain : undefined, path: isBrowser ? nav?.path : undefined };
    }
  });

  const runEngine: RunEngine = new RunEngine({
    storage,
    settings,
    sessionId: context.sessionId,
    screenSource: { captureFrontmost: () => screenSource.current.captureFrontmost() },
    actuator: () => actuator.current,
    approvalSecret: () => helper.approvalSecret,
    context: { frontmost: () => runContext.current.frontmost() },
    appActivator: { activate: (bundleId) => appActivator.current.activate(bundleId) },
    raiseWindow: (runId) => runAttentionListeners.forEach((listener) => listener(runId)),
    ocr: { ocr: (png, w, h) => ocr.current.ocr(png, w, h) },
    ax: { elementAt: (x, y) => ax.current.elementAt(x, y) },
    dom: { query: (marker, timeoutMs) => dom.current.query(marker, timeoutMs) },
    model: { propose: (input) => model.propose(input), verify: (input) => model.verify(input), resetSession: (id) => model.resetSession(id), providerType: () => settings.get().model.providerType, modelName: () => (settings.get().model.providerType === "mock" ? "mock" : settings.get().model.endpoint?.model), supportsVerification: () => model.supportsVerification() },
    resizer: adapters.resizer,
    emit,
    analytics,
    metrics,
    clock,
    logger: logger.child("runs"),
    emergencyStop: async () => {
      if (helper.connected && !settings.get().demoMode) await helper.emergencyStop(true);
    },
    hooks: {
      beforeStart: (skill) => demo.prepareRun(skill),
      onActiveChange: (active) => runActiveListeners.forEach((listener) => listener(active)),
      onSubtaskAdvance: (_runId, index) => demo.advanceSubtask(index),
      beforeExecute: async (action) => {
        for (const listener of runExecutionListeners) await listener(action, "before");
      },
      afterExecute: async (action) => {
        for (const listener of runExecutionListeners) await listener(action, "after");
      }
    },
    settleMs: adapters.settleMs
  });
  const candidates = new CandidateActions({ storage, analytics, clock, startRun: (skillId) => runEngine.start(skillId, "guide") });
  const feedback = new FeedbackService({ storage, settings, analytics, clock, logger: logger.child("feedback"), metrics, exportsDir: context.paths.exports, appVersion: APP_VERSION, hardware: () => hardware.info(), modelStatus: () => model.status(), helperRestarts: () => helper.restarts, fetchImpl: adapters.fetchImpl });
  const demo: DemoService = new DemoService({
    storage,
    settings,
    fixtures: createFixtureSource(adapters.fixturesDir),
    scheduler,
    analytics,
    clock,
    logger: logger.child("demo"),
    screenSource,
    actuator,
    appActivator,
    context: runContext,
    ocr,
    ax,
    dom,
    setProviderOverride: (provider) => model.setOverride(provider),
    realSources: { screen: adapters.screenSource, actuator: actuator.current, appActivator: appActivator.current, context: runContext.current, ocr: ocr.current, ax: ax.current, dom: dom.current }
  });
  const privacy = new PrivacyService({
    context,
    analytics,
    clock,
    logger: logger.child("privacy"),
    quiesce: async () => {
      await runEngine.stopActive("ui_stop");
      await pipeline.stop();
      await model.stopAll();
    },
    afterReset: async () => {
      scheduler.runNow();
      demo.reset();
    },
    securePauseCount: () => securePauses,
    retentionExcludedSessions: () => demo.sessionIds()
  });
  const activity = new ActivityService(storage);

  return {
    context,
    hub,
    hardware,
    helper,
    permissions,
    learning,
    capture,
    pipeline,
    scheduler,
    candidates,
    teach,
    skills,
    runEngine,
    runtime,
    model,
    loopback,
    feedback,
    privacy,
    demo,
    activity,
    shell,
    securePauses: () => securePauses,
    overview: () =>
      buildOverview({
        storage,
        learning: () => learning.snapshot(),
        modelStatus: () => model.status(),
        permissions: () => permissions.status(),
        demoMode: () => settings.get().demoMode,
        helperConnected: () => helper.connected,
        extensionPaired: () => loopback.status().paired,
        pendingPulseDay: () => feedback.pendingPulse()
      }),
    onRunActiveChange: (listener) => {
      runActiveListeners.push(listener);
      return () => {
        const index = runActiveListeners.indexOf(listener);
        if (index >= 0) runActiveListeners.splice(index, 1);
      };
    },
    onRunExecution: (listener) => {
      runExecutionListeners.push(listener);
      return () => {
        const index = runExecutionListeners.indexOf(listener);
        if (index >= 0) runExecutionListeners.splice(index, 1);
      };
    },
    onRunAttention: (listener) => {
      runAttentionListeners.push(listener);
      return () => {
        const index = runAttentionListeners.indexOf(listener);
        if (index >= 0) runAttentionListeners.splice(index, 1);
      };
    },
    start: async () => {
      const current = settings.get();
      if (current.feedback.firstRunTs === undefined) settings.update({ feedback: { ...current.feedback, firstRunTs: clock.now() } });
      try {
        await helper.start();
      } catch (error) {
        logger.warn("helper unavailable; continuing in degraded mode", { error: error instanceof Error ? error.message : String(error) });
      }
      helper.onState((snapshot) => {
        emit("event:helper", { connected: snapshot.connected, restarts: snapshot.restarts, message: snapshot.message });
        if (snapshot.state === "restarting") analytics.track("helper_restarted", { restarts: snapshot.restarts });
      });
      demo.restore();
      await learning.restore();
      scheduler.start();
      model.start();
      privacy.start();
      try {
        await loopback.start();
      } catch (error) {
        logger.error("loopback server failed to start", { error: error instanceof Error ? error.message : String(error) });
      }
      analytics.track("app_launched", { demoMode: settings.get().demoMode, onboardingCompleted: settings.get().onboardingCompleted });
    },
    shutdown: async () => {
      scheduler.stop();
      privacy.stop();
      model.stop();
      await runEngine.stopActive("ui_stop");
      await learning.shutdown();
      await pipeline.shutdown();
      await runtime.stop();
      await loopback.stop();
      await helper.stop();
      storage.current.close();
    }
  };
}
