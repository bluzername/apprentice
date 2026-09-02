import type { LearningState, MenuBarStatus } from "@apprentice/schemas";
import type { Analytics, AnalyticsProps } from "../analytics.js";
import type { Clock } from "../clock.js";
import type { Emit } from "../events.js";
import type { Logger } from "../logger.js";
import type { SettingsStore } from "../settings-store.js";

export interface ObservationController {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ModelActivityProbe {
  busy(): boolean;
  unavailable(): boolean;
}

export interface LearningSnapshot {
  readonly state: LearningState;
  readonly menuBarStatus: MenuBarStatus;
  readonly pausedUntil?: number;
}

export interface LearningStateDeps {
  readonly settings: SettingsStore;
  readonly emit: Emit;
  readonly analytics: Analytics;
  readonly clock: Clock;
  readonly observation: ObservationController;
  readonly model: ModelActivityProbe;
  readonly logger: Logger;
}

/**
 * Learning / paused / private / stopped state machine. Only "learning" captures;
 * every other state stops helper observation so the app does near-zero work.
 */
export class LearningStateService {
  private resumeTimer: NodeJS.Timeout | null = null;
  private listeners: ReadonlyArray<(snapshot: LearningSnapshot) => void> = [];

  constructor(private readonly deps: LearningStateDeps) {}

  state(): LearningState {
    return this.deps.settings.get().learning.state;
  }

  pausedUntil(): number | undefined {
    return this.deps.settings.get().learning.pausedUntil;
  }

  isCapturing(): boolean {
    return this.state() === "learning";
  }

  menuBarStatus(): MenuBarStatus {
    const state = this.state();
    if (state !== "learning") return state;
    if (this.deps.model.unavailable()) return "model_unavailable";
    if (this.deps.model.busy()) return "processing_locally";
    return "learning";
  }

  snapshot(): LearningSnapshot {
    const pausedUntil = this.pausedUntil();
    return { state: this.state(), menuBarStatus: this.menuBarStatus(), ...(pausedUntil !== undefined ? { pausedUntil } : {}) };
  }

  onChange(listener: (snapshot: LearningSnapshot) => void): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  /** Applies the persisted state at startup (resumes expired pauses). */
  async restore(): Promise<LearningSnapshot> {
    const { state, pausedUntil } = this.deps.settings.get().learning;
    if (state === "paused" && pausedUntil !== undefined && pausedUntil <= this.deps.clock.now()) {
      return this.setState("learning");
    }
    if (state === "paused" && pausedUntil !== undefined) this.scheduleResume(pausedUntil);
    if (state === "learning") await this.startObservation();
    return this.snapshot();
  }

  async setState(state: LearningState, pauseMinutes?: number): Promise<LearningSnapshot> {
    this.clearResumeTimer();
    const now = this.deps.clock.now();
    const pausedUntil = state === "paused" && pauseMinutes !== undefined ? now + pauseMinutes * 60_000 : undefined;
    this.deps.settings.update({ learning: pausedUntil !== undefined ? { state, pausedUntil } : { state } });
    if (state === "learning") await this.startObservation();
    else await this.stopObservation();
    if (pausedUntil !== undefined) this.scheduleResume(pausedUntil);
    this.track(state, pauseMinutes);
    const snapshot = this.snapshot();
    this.deps.emit("event:learning", snapshot);
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  /** Re-emits the derived menu bar status (model activity changed). */
  refresh(): void {
    const snapshot = this.snapshot();
    this.deps.emit("event:learning", snapshot);
    for (const listener of this.listeners) listener(snapshot);
  }

  async shutdown(): Promise<void> {
    this.clearResumeTimer();
    await this.stopObservation();
  }

  private track(state: LearningState, pauseMinutes: number | undefined): void {
    const props: AnalyticsProps = pauseMinutes !== undefined ? { pauseMinutes } : {};
    if (state === "learning") this.deps.analytics.track("learning_started", props);
    else if (state === "paused") this.deps.analytics.track("learning_paused", props);
    else if (state === "private") this.deps.analytics.track("learning_private", props);
    else this.deps.analytics.track("learning_stopped", props);
  }

  private scheduleResume(pausedUntil: number): void {
    const delay = Math.max(0, pausedUntil - this.deps.clock.now());
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      void this.setState("learning").catch((error: unknown) => {
        this.deps.logger.error("automatic resume failed", { error: error instanceof Error ? error.message : String(error) });
      });
    }, delay);
    this.resumeTimer.unref?.();
  }

  private clearResumeTimer(): void {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  private async startObservation(): Promise<void> {
    try {
      await this.deps.observation.start();
    } catch (error) {
      this.deps.logger.error("observation start failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async stopObservation(): Promise<void> {
    try {
      await this.deps.observation.stop();
    } catch (error) {
      this.deps.logger.error("observation stop failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
