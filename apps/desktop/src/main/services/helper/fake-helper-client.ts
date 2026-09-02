import {
  HELPER_PROTOCOL_VERSION,
  type CaptureResult,
  type ExecutableAction,
  type FrontmostContextResult,
  type HelperCommand,
  type HelperEvent,
  type OcrImageResult,
  type PermissionStatusResult
} from "@apprentice/schemas";
import { HelperClientBase } from "./base-client.js";
import { fixtureLineToEvent, readFixtureLines, type FixtureLine } from "./fixture-lines.js";
import { HelperError, type HelperRequestOptions, type HelperStateSnapshot, type StartObservationParams } from "./types.js";

export type FakeResponder = (params: Record<string, unknown> | undefined) => unknown | Promise<unknown>;

export interface FakeHelperClientOptions {
  readonly responses?: Partial<Record<HelperCommand, FakeResponder>>;
  /** Events replayed by startObservation when no fixturePath is given. */
  readonly events?: readonly FixtureLine[];
  /** Multiplier applied to fixture delays (0 makes replays instant). */
  readonly fixtureDelayScale?: number;
  readonly permissions?: PermissionStatusResult;
  readonly frontmost?: () => FrontmostContextResult;
  readonly capture?: () => CaptureResult;
  readonly ocr?: (pngBase64: string) => OcrImageResult;
  readonly now?: () => number;
}

export interface RecordedAction {
  readonly action: ExecutableAction;
  readonly approvalToken: string;
}

const DEFAULT_FRONTMOST: FrontmostContextResult = {
  app: { bundleId: "com.google.Chrome", name: "Google Chrome", pid: 4242 },
  window: { id: 1, title: "Demo window", bounds: { x: 0, y: 0, width: 1440, height: 900 } },
  isSecureInput: false,
  isFullscreen: false,
  displayId: "display-1",
  displayScale: 1
};

/** In-process helper for tests, demo mode, smoke, and e2e. Scripted responses; fixture-driven events. */
export class FakeHelperClient extends HelperClientBase {
  readonly requests: Array<{ cmd: HelperCommand; params?: Record<string, unknown> }> = [];
  readonly actions: RecordedAction[] = [];
  private running = false;
  private stopped = false;
  private observing = false;
  private seq = 0;
  private replayToken = 0;
  private restartCount = 0;

  constructor(private readonly options: FakeHelperClientOptions = {}) {
    super();
  }

  get connected(): boolean {
    return this.running;
  }

  get restarts(): number {
    return this.restartCount;
  }

  get available(): boolean {
    return true;
  }

  get emergencyStopped(): boolean {
    return this.stopped;
  }

  snapshot(): HelperStateSnapshot {
    return { state: this.running ? "connected" : "stopped", connected: this.running, restarts: this.restartCount, message: "fake helper" };
  }

  async start(): Promise<void> {
    this.running = true;
    this.dispatchState();
    this.emit("helperReady", { helperVersion: "fake", protocolVersion: HELPER_PROTOCOL_VERSION, pid: process.pid });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.observing = false;
    this.replayToken += 1;
    this.dispatchState();
  }

  /** Simulates a crash and recovery so services can be tested against restarts. */
  simulateRestart(): void {
    this.restartCount += 1;
    this.dispatchState();
  }

  /** Injects one event as if the helper streamed it. */
  emit(event: HelperEvent["event"], data: Record<string, unknown> = {}): HelperEvent {
    this.seq += 1;
    const message: HelperEvent = { type: "event", v: HELPER_PROTOCOL_VERSION, event, ts: (this.options.now ?? Date.now)(), seq: this.seq, data };
    this.dispatchEvent(message);
    return message;
  }

  /** Replays fixture lines with (scaled) delays; resolves when the replay finished or was cancelled. */
  async replay(lines: readonly FixtureLine[]): Promise<void> {
    this.replayToken += 1;
    const token = this.replayToken;
    const scale = this.options.fixtureDelayScale ?? 1;
    for (const line of lines) {
      if (token !== this.replayToken) return;
      const delay = Math.round(line.delayMs * scale);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      if (token !== this.replayToken) return;
      this.seq += 1;
      this.dispatchEvent(fixtureLineToEvent(line, this.seq, (this.options.now ?? Date.now)()));
    }
  }

  override async startObservation(params: StartObservationParams = {}): Promise<unknown> {
    this.requests.push({ cmd: "startObservation", params: { ...params } });
    this.observing = true;
    this.emit("observationState", { observing: true, fixture: params.fixturePath !== undefined });
    const lines = params.fixturePath ? readFixtureLines(params.fixturePath) : (this.options.events ?? []);
    void this.replay(lines).then(() => {
      if (this.observing) this.emit("observationState", { observing: true, fixture: true, completed: true });
    });
    return { observing: true, fixture: params.fixturePath !== undefined };
  }

  override async stopObservation(): Promise<unknown> {
    this.requests.push({ cmd: "stopObservation" });
    this.observing = false;
    this.replayToken += 1;
    return { observing: false, fixture: false };
  }

  async request(cmd: HelperCommand, params?: Record<string, unknown>, _options?: HelperRequestOptions): Promise<unknown> {
    this.requests.push({ cmd, params });
    if (!this.running) throw new HelperError("not_available", "fake helper is not running");
    const custom = this.options.responses?.[cmd];
    if (custom) return custom(params);
    switch (cmd) {
      case "ping":
        return { pong: true, ts: Date.now(), stopped: this.stopped };
      case "capabilities":
        return {
          helperVersion: "fake",
          protocolVersion: HELPER_PROTOCOL_VERSION,
          arch: "arm64",
          macosVersion: "26.0",
          features: { accessibility: true, screenCaptureKit: true, cgEvents: true, visionOcr: true, fixtureStream: true }
        };
      case "permissionStatus":
      case "requestAccessibilityPermission":
      case "requestScreenRecordingPermission":
        return this.options.permissions ?? { accessibility: "granted", screenRecording: "granted", inputMonitoring: "granted" };
      case "frontmostContext":
        return this.options.frontmost ? this.options.frontmost() : DEFAULT_FRONTMOST;
      case "captureFrontmostWindow":
        if (this.options.capture) return this.options.capture();
        throw new HelperError("capture_failed", "fake helper has no capture source");
      case "ocrImage": {
        const png = typeof params?.["pngBase64"] === "string" ? params["pngBase64"] : "";
        if (this.options.ocr) return this.options.ocr(png);
        return { width: 1, height: 1, blocks: [] };
      }
      case "focusedElement":
        return { element: null, bundleId: DEFAULT_FRONTMOST.app.bundleId };
      case "accessibilityContextAtPoint":
        return { element: null, ancestors: [], bundleId: DEFAULT_FRONTMOST.app.bundleId };
      case "performAction": {
        if (this.stopped) throw new HelperError("emergency_stopped", "emergency stop is set");
        const action = params?.["action"] as ExecutableAction;
        const approvalToken = String(params?.["approvalToken"] ?? "");
        if (approvalToken.length < 8) throw new HelperError("action_rejected", "approval token missing");
        this.actions.push({ action, approvalToken });
        return { performed: true, durationMs: 1 };
      }
      case "emergencyStop":
        this.stopped = params?.["clear"] === true ? false : true;
        return { stopped: this.stopped };
      case "shutdown":
        return { shuttingDown: true };
      default:
        throw new HelperError("unknown_command", `fake helper cannot handle ${cmd}`);
    }
  }
}
