import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { HELPER_EXECUTABLE_NAME, HELPER_PROTOCOL_VERSION, HelperMessageSchema, type HelperCommand, type HelperResponse } from "@apprentice/schemas";
import { HelperClientBase } from "./base-client.js";
import { HelperError, type HelperConnectionState, type HelperRequestOptions, type HelperStateSnapshot, type StartObservationParams } from "./types.js";
import { silentLogger, type Logger } from "../logger.js";

export interface ProcessHelperClientOptions {
  readonly executablePath: string;
  readonly args?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly logPath: string;
  readonly logger?: Logger;
  readonly requestTimeoutMs?: number;
  readonly readyTimeoutMs?: number;
  readonly restartBackoffMs?: number;
  readonly maxRestarts?: number;
  readonly stopGraceMs?: number;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
  readonly cmd: HelperCommand;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_MAX_RESTARTS = 5;
const DEFAULT_STOP_GRACE_MS = 3000;

/** Resolves the bundled helper binary: env override, packaged resources, or the dev resources folder. */
export function resolveHelperExecutable(options: { resourcesPath?: string; devResourcesDir: string; env?: NodeJS.ProcessEnv }): string {
  const env = options.env ?? process.env;
  const override = env.APPRENTICE_HELPER_PATH?.trim();
  if (override) return override;
  if (options.resourcesPath) return join(options.resourcesPath, "helper", HELPER_EXECUTABLE_NAME);
  return join(options.devResourcesDir, "helper", HELPER_EXECUTABLE_NAME);
}

/**
 * Spawns the native helper and speaks JSON Lines with it. Requests carry ids and
 * timeouts; events stream to listeners; stderr goes to logs/helper.log; crashes
 * restart the process with exponential backoff up to `maxRestarts`.
 */
export class ProcessHelperClient extends HelperClientBase {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private requestCounter = 0;
  private state: HelperConnectionState = "stopped";
  private restartCount = 0;
  private consecutiveFailures = 0;
  private stopping = false;
  private readyWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private restartTimer: NodeJS.Timeout | null = null;
  private lastObservation: StartObservationParams | null = null;
  private observing = false;
  private lastMessage: string | undefined;
  private readonly logger: Logger;

  constructor(private readonly options: ProcessHelperClientOptions) {
    super();
    this.logger = options.logger ?? silentLogger;
  }

  get connected(): boolean {
    return this.state === "connected";
  }

  get restarts(): number {
    return this.restartCount;
  }

  get available(): boolean {
    return existsSync(this.options.executablePath);
  }

  snapshot(): HelperStateSnapshot {
    return { state: this.state, connected: this.connected, restarts: this.restartCount, message: this.lastMessage };
  }

  async start(): Promise<void> {
    if (!this.available) {
      this.setState("failed", `helper binary not found at ${this.options.executablePath}`);
      throw new HelperError("not_available", `Helper binary not found at ${this.options.executablePath}`);
    }
    this.stopping = false;
    if (this.state === "connected") return;
    this.spawnProcess();
    await this.waitReady();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    if (!child) {
      this.setState("stopped");
      return;
    }
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      this.writeLine({ id: this.nextId(), v: HELPER_PROTOCOL_VERSION, cmd: "shutdown" });
    } catch {
      // The pipe may already be closed; fall through to signals.
    }
    child.stdin.end();
    const grace = this.options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
    const timer = setTimeout(() => child.kill("SIGKILL"), grace);
    timer.unref?.();
    await exited;
    clearTimeout(timer);
    this.child = null;
    this.setState("stopped");
  }

  override startObservation(params: StartObservationParams = {}): Promise<unknown> {
    this.lastObservation = params;
    this.observing = true;
    return super.startObservation(params);
  }

  override stopObservation(): Promise<unknown> {
    this.observing = false;
    this.lastObservation = null;
    return super.stopObservation();
  }

  /** Fast path: written ahead of the queue; the helper handles it on its reader thread. */
  override emergencyStop(clear = false): Promise<{ stopped: boolean }> {
    return super.emergencyStop(clear);
  }

  request(cmd: HelperCommand, params?: Record<string, unknown>, options: HelperRequestOptions = {}): Promise<unknown> {
    if (!this.child || this.state !== "connected") {
      return Promise.reject(new HelperError("not_available", `Helper is ${this.state}; cannot run ${cmd}`));
    }
    const id = this.nextId();
    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HelperError("internal", `Helper request ${cmd} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, cmd });
      try {
        this.writeLine({ id, v: HELPER_PROTOCOL_VERSION, cmd, ...(params ? { params } : {}) });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new HelperError("internal", `Cannot write to helper: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  }

  private nextId(): string {
    this.requestCounter += 1;
    return `r${this.requestCounter}`;
  }

  private writeLine(message: Record<string, unknown>): void {
    if (!this.child) throw new Error("helper process is not running");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private setState(state: HelperConnectionState, message?: string): void {
    this.state = state;
    this.lastMessage = message;
    this.dispatchState();
  }

  private spawnProcess(): void {
    if (this.state !== "restarting") this.setState("starting");
    mkdirSync(dirname(this.options.logPath), { recursive: true, mode: 0o700 });
    const child = spawn(this.options.executablePath, [...(this.options.args ?? [])], {
      env: { ...process.env, ...(this.options.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false
    });
    this.child = child;
    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk: Buffer) => this.appendLog(chunk.toString("utf8")));
    child.on("error", (error) => {
      this.logger.error("helper spawn error", { error: error.message });
      this.lastMessage = error.message;
    });
    child.once("exit", (code, signal) => this.handleExit(code, signal));
    const readyTimer = setTimeout(() => {
      if (this.state !== "connected" && this.child === child) {
        this.pingForReadiness();
      }
    }, Math.min(this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS, 1500));
    readyTimer.unref?.();
  }

  private pingForReadiness(): void {
    // Some helper builds may not emit helperReady before the first request; a ping settles it.
    if (!this.child || this.state === "connected") return;
    const previous = this.state;
    this.state = "connected";
    this.ping()
      .then(() => this.markReady())
      .catch(() => {
        if (this.state === "connected") this.state = previous;
      });
  }

  private markReady(): void {
    this.consecutiveFailures = 0;
    this.setState("connected");
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const waiter of waiters) waiter.resolve();
    if (this.observing && this.lastObservation) {
      super.startObservation(this.lastObservation).catch((error: unknown) => {
        this.logger.warn("could not resume observation after helper restart", { error: error instanceof Error ? error.message : String(error) });
      });
    }
  }

  private waitReady(): Promise<void> {
    if (this.state === "connected") return Promise.resolve();
    if (this.state === "failed") return Promise.reject(new HelperError("not_available", this.lastMessage ?? "helper failed"));
    const timeoutMs = this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((entry) => entry.resolve !== resolve);
        reject(new HelperError("internal", `Helper did not become ready within ${timeoutMs} ms`));
      }, timeoutMs);
      timer.unref?.();
      this.readyWaiters = [
        ...this.readyWaiters,
        {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          }
        }
      ];
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      this.logger.warn("helper emitted a non-JSON line", { length: trimmed.length });
      return;
    }
    const parsed = HelperMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn("helper emitted an invalid protocol message", { issues: parsed.error.issues.length });
      return;
    }
    const message = parsed.data;
    if (message.type === "event") {
      if (message.event === "helperReady") this.markReady();
      if (message.event === "observationState" && message.data["completed"] === true) this.observing = this.observing && false;
      this.dispatchEvent(message);
      return;
    }
    this.settle(message);
  }

  private settle(response: HelperResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new HelperError(response.error?.code ?? "internal", response.error?.message ?? `Helper ${pending.cmd} failed`));
  }

  private appendLog(text: string): void {
    try {
      appendFileSync(this.options.logPath, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600 });
    } catch {
      // Logging must never take the helper down.
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    const failure = new HelperError("not_available", `Helper exited (code ${String(code)}, signal ${String(signal)})`);
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(failure);
    }
    this.pending.clear();
    if (this.stopping) {
      this.setState("stopped");
      return;
    }
    this.consecutiveFailures += 1;
    const maxRestarts = this.options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    if (this.consecutiveFailures > maxRestarts) {
      this.setState("failed", `Helper crashed ${this.consecutiveFailures} times; giving up`);
      const waiters = this.readyWaiters;
      this.readyWaiters = [];
      for (const waiter of waiters) waiter.reject(new HelperError("not_available", this.lastMessage ?? "helper failed"));
      return;
    }
    this.restartCount += 1;
    const delay = (this.options.restartBackoffMs ?? DEFAULT_BACKOFF_MS) * 2 ** (this.consecutiveFailures - 1);
    this.logger.warn("helper exited; restarting", { code, signal, delayMs: delay, restarts: this.restartCount });
    this.setState("restarting", `Helper exited; restart ${this.restartCount} in ${delay} ms`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopping) this.spawnProcess();
    }, delay);
    this.restartTimer.unref?.();
  }
}
