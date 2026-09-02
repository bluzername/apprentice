import { CompositeVisionAgentProvider, createProvider, type ImageResizer, type VisionAgentProvider } from "@apprentice/model-adapters";
import type { DraftSkillInput, ModelHealth, ModelStatus, NextActionInput, ProposedActionResult, ProviderType, SkillDraft, StepVerification, VerifyStepInput } from "@apprentice/schemas";
import type { MetricsRecorder } from "@apprentice/core";
import type { Analytics } from "../analytics.js";
import type { Clock } from "../clock.js";
import { ServiceError } from "../errors.js";
import type { Emit } from "../events.js";
import type { HardwareService } from "../hardware.js";
import type { Logger } from "../logger.js";
import type { SettingsStore } from "../settings-store.js";
import type { SecretStore } from "../../security/keys.js";
import type { DraftRefiner } from "../teach/teach-service.js";
import { DeterministicAnalysisProvider } from "./deterministic-analysis-provider.js";
import { InferenceQueue } from "./inference-queue.js";
import type { ModelManifest } from "./manifest.js";
import type { RuntimeManager } from "./runtime-manager.js";

export type ThermalState = "unknown" | "nominal" | "fair" | "serious" | "critical";

/** Power and idle facts; Electron binds powerMonitor, tests inject values. */
export interface PowerProbe {
  onBattery(): boolean;
  thermalState(): ThermalState;
  idleSeconds(): number;
}

export const API_KEY_SECRET_NAME = "model_api_key";
const IDLE_THRESHOLD_S = 60;

export interface ModelManagerDeps {
  readonly settings: SettingsStore;
  readonly secrets: SecretStore;
  readonly runtime: RuntimeManager;
  readonly manifest: ModelManifest;
  readonly hardware: HardwareService;
  readonly metrics: MetricsRecorder;
  readonly analytics: Analytics;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly emit: Emit;
  readonly power: PowerProbe;
  readonly resizer: ImageResizer;
  readonly fetchImpl?: typeof fetch;
  readonly healthIntervalMs?: number;
  readonly mockProvider?: VisionAgentProvider;
}

export interface EndpointRequest {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly requestTimeoutMs?: number;
  readonly imagesToKeep?: number;
}

function isLoopback(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Builds the provider from settings, serializes every model call through one
 * queue, tracks health, and honours power/thermal/idle pause conditions.
 */
export class ModelManager {
  private readonly queue: InferenceQueue;
  private built: { key: string; provider: VisionAgentProvider } | null = null;
  private override: VisionAgentProvider | null = null;
  private lastHealth: ModelHealth | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private screenshotsUsed = 0;
  private lastLatencyMs: number | undefined;

  constructor(private readonly deps: ModelManagerDeps) {
    this.queue = new InferenceQueue({ pauseReason: () => this.pauseReason(), sleep: (ms) => deps.clock.sleep(ms) });
    deps.settings.onChange((next, previous) => {
      if (JSON.stringify(next.model) !== JSON.stringify(previous.model)) this.built = null;
    });
    deps.runtime.onChange(() => {
      this.built = null;
      this.emitStatus();
    });
  }

  start(): void {
    const interval = this.deps.healthIntervalMs ?? 60_000;
    this.healthTimer = setInterval(() => void this.checkHealth().catch(() => undefined), interval);
    this.healthTimer.unref?.();
    void this.checkHealth().catch(() => undefined);
  }

  stop(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  setOverride(provider: VisionAgentProvider | null): void {
    this.override = provider;
    this.lastHealth = null;
  }

  pauseReason(): string | null {
    const model = this.deps.settings.get().model;
    if (model.providerType === "mock") return null;
    const thermal = this.deps.power.thermalState();
    if (thermal === "critical" || thermal === "serious") return `thermal pressure is ${thermal}`;
    if (model.onlyOnPower && this.deps.power.onBattery()) return "running on battery; model work waits for power";
    if (model.onlyWhenIdle && this.deps.power.idleSeconds() < IDLE_THRESHOLD_S) return "waiting until the Mac is idle";
    return null;
  }

  busy(): boolean {
    return this.queue.isBusy();
  }

  unavailable(): boolean {
    return this.deps.settings.get().model.providerType !== "mock" && this.lastHealth !== null && !this.lastHealth.ok;
  }

  private abortableFetch(): typeof fetch {
    const base = this.deps.fetchImpl ?? globalThis.fetch;
    return (input, init) => {
      const queueSignal = this.queue.signal;
      const signal = init?.signal ? AbortSignal.any([init.signal, queueSignal]) : queueSignal;
      return base(input, { ...init, signal });
    };
  }

  private buildKey(): string {
    const model = this.deps.settings.get().model;
    return JSON.stringify({ model, runtime: this.deps.runtime.baseUrl() });
  }

  private resolveBaseUrl(): string | undefined {
    const model = this.deps.settings.get().model;
    if (model.managedRuntime) {
      const managed = this.deps.runtime.baseUrl();
      if (managed) return managed;
    }
    return model.endpoint?.baseUrl;
  }

  private build(providerType: ProviderType, endpoint: EndpointRequest | undefined, apiKey: string | undefined): VisionAgentProvider {
    if (providerType === "mock") return this.deps.mockProvider ?? createProvider({ providerType: "mock" });
    if (!endpoint?.baseUrl) throw new ServiceError("model_not_configured", `${providerType} needs an endpoint base URL`);
    const common = {
      baseUrl: endpoint.baseUrl,
      model: endpoint.model,
      apiKey,
      fetchImpl: this.abortableFetch(),
      imagesToKeep: endpoint.imagesToKeep,
      timeoutMs: endpoint.requestTimeoutMs,
      resizeImage: this.deps.resizer
    };
    if (providerType === "openai_compatible") return createProvider({ providerType, ...common });
    const analysis = new DeterministicAnalysisProvider(() => this.deps.clock.now());
    const action = createProvider({ providerType: "uimate", ...common, model: endpoint.model || this.deps.manifest.model.alias, fallback: analysis });
    return new CompositeVisionAgentProvider({ action, analysis });
  }

  provider(): VisionAgentProvider {
    if (this.override) return this.override;
    const key = this.buildKey();
    if (this.built && this.built.key === key) return this.built.provider;
    const model = this.deps.settings.get().model;
    const baseUrl = this.resolveBaseUrl();
    const endpoint: EndpointRequest | undefined = baseUrl ? { baseUrl, model: model.endpoint?.model ?? this.deps.manifest.model.alias, imagesToKeep: model.endpoint?.imagesToKeep } : undefined;
    const apiKey = model.endpoint?.hasApiKey ? (this.deps.secrets.get(API_KEY_SECRET_NAME) ?? undefined) : undefined;
    const provider = this.build(model.providerType, endpoint, apiKey);
    this.built = { key, provider };
    return provider;
  }

  private async run<T>(label: string, job: (provider: VisionAgentProvider) => Promise<T>): Promise<T> {
    const provider = this.provider();
    const started = performance.now();
    try {
      return await this.queue.enqueue(() => job(provider));
    } finally {
      const elapsed = performance.now() - started;
      this.lastLatencyMs = elapsed;
      this.deps.metrics.record(`model.${label}Ms`, elapsed);
    }
  }

  propose(input: NextActionInput): Promise<ProposedActionResult> {
    this.screenshotsUsed += 1;
    return this.run("propose", (provider) => provider.proposeNextAction(input));
  }

  verify(input: VerifyStepInput): Promise<StepVerification> {
    this.screenshotsUsed += input.before ? 2 : 1;
    return this.run("verify", (provider) => provider.verifyStep(input));
  }

  draftSkill(input: DraftSkillInput): Promise<SkillDraft> {
    return this.run("draft", (provider) => provider.draftSkill(input));
  }

  /** Draft refinement is offered only when a healthy, non-mock analysis provider exists. */
  refiner(): DraftRefiner {
    return {
      refine: async (input) => {
        if (this.override) return null;
        if (this.deps.settings.get().model.providerType === "mock") return null;
        const health = this.lastHealth ?? (await this.checkHealth());
        if (!health.ok || !health.capabilities.structuredOutput) return null;
        const refined = await this.draftSkill(input);
        return refined.origin === "model_refined" ? refined : null;
      }
    };
  }

  resetSession(sessionId: string): Promise<void> {
    return this.provider().resetSession(sessionId);
  }

  async checkHealth(): Promise<ModelHealth> {
    let health: ModelHealth;
    try {
      health = await this.provider().health();
    } catch (error) {
      health = {
        ok: false,
        provider: this.deps.settings.get().model.providerType,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        capabilities: { vision: false, actionPolicy: false, structuredOutput: false },
        checkedAt: this.deps.clock.now()
      };
    }
    const changed = this.lastHealth === null || this.lastHealth.ok !== health.ok;
    this.lastHealth = health;
    this.deps.analytics.track("model_health_checked", { ok: health.ok, provider: health.provider });
    this.deps.emit("event:modelHealth", health);
    if (changed) this.emitStatus();
    return health;
  }

  private emitStatus(): void {
    void this.status()
      .then((status) => this.deps.emit("event:model", status))
      .catch((error: unknown) => this.deps.logger.warn("model status emit failed", { error: error instanceof Error ? error.message : String(error) }));
  }

  async status(): Promise<ModelStatus> {
    const model = this.deps.settings.get().model;
    const hardware = await this.deps.hardware.info();
    const recommendation = this.deps.manifest.model.memoryRecommendation;
    const memoryRecommendation = `${recommendation.recommendedUnifiedMemoryGb} GB unified memory recommended (${recommendation.minimumUnifiedMemoryGb} GB minimum); this Mac has ${hardware.memoryGb} GB`;
    const baseUrl = this.resolveBaseUrl();
    const runtimeRunning = model.managedRuntime && this.deps.runtime.isRunning();
    const location: ModelStatus["location"] =
      this.override !== null || model.providerType === "mock" ? "none" : runtimeRunning ? "local_managed" : baseUrl && isLoopback(baseUrl) ? "local_external" : "remote";
    const queue = this.queue.stats();
    const pauseReason = this.pauseReason();
    return {
      providerType: model.providerType,
      model: model.providerType === "mock" ? "mock" : (model.endpoint?.model ?? this.deps.manifest.model.alias),
      location,
      health: this.lastHealth,
      memoryRecommendation: memoryRecommendation.slice(0, 200),
      runtime: this.deps.runtime.state(),
      queue: { pending: queue.pending, active: queue.active, peak: queue.peak },
      lastLatencyMs: this.lastLatencyMs !== undefined ? Math.round(this.lastLatencyMs) : undefined,
      screenshotsUsed: this.screenshotsUsed,
      paused: pauseReason !== null,
      pauseReason: pauseReason ?? undefined
    };
  }

  async testConnection(config: { providerType: ProviderType } & EndpointRequest): Promise<ModelHealth> {
    const provider = this.build(config.providerType, config, config.apiKey);
    return provider.health();
  }

  async configure(request: { providerType: ProviderType; endpoint?: EndpointRequest; managedRuntime: boolean }): Promise<ModelStatus> {
    const previous = this.deps.settings.get().model;
    if (request.endpoint?.apiKey !== undefined && request.endpoint.apiKey.length > 0) this.deps.secrets.set(API_KEY_SECRET_NAME, request.endpoint.apiKey);
    const hasApiKey = request.endpoint?.apiKey !== undefined && request.endpoint.apiKey.length > 0 ? true : (previous.endpoint?.hasApiKey ?? false) && this.deps.secrets.has(API_KEY_SECRET_NAME);
    this.deps.settings.update({
      model: {
        ...previous,
        providerType: request.providerType,
        managedRuntime: request.managedRuntime,
        endpoint: request.endpoint ? { baseUrl: request.endpoint.baseUrl, model: request.endpoint.model, hasApiKey, imagesToKeep: request.endpoint.imagesToKeep ?? 2 } : previous.endpoint
      }
    });
    this.built = null;
    this.lastHealth = null;
    this.deps.analytics.track("model_configured", { provider: request.providerType, managedRuntime: request.managedRuntime });
    await this.checkHealth();
    return this.status();
  }

  async runtimeAction(action: "installRuntime" | "installModel" | "start" | "stop" | "restart" | "cancelDownload", confirmed: boolean): Promise<ModelStatus> {
    const runtime = this.deps.runtime;
    switch (action) {
      case "installRuntime":
        await runtime.installRuntime();
        break;
      case "installModel":
        await runtime.installModel(confirmed);
        break;
      case "start":
        await runtime.start();
        break;
      case "stop":
        await runtime.stop();
        break;
      case "restart":
        await runtime.restart();
        break;
      case "cancelDownload":
        runtime.cancelDownload();
        break;
    }
    this.built = null;
    return this.status();
  }

  /** Cancels queued work, aborts in-flight requests, and stops the managed runtime. */
  async stopAll(): Promise<ModelStatus> {
    const cancelled = this.queue.cancelAll();
    this.deps.logger.info("model work stopped", { cancelled });
    await this.deps.runtime.stop();
    this.built = null;
    return this.status();
  }
}
