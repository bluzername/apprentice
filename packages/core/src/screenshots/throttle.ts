import type { ScreenshotReason } from "@apprentice/schemas";

export const DEFAULT_CAPTURE_INTERVAL_MS = 5000;

/** Reasons that may bypass the sparse-capture interval. */
const BYPASS_REASONS: ReadonlySet<ScreenshotReason> = new Set(["teach_marker", "run_step"]);
/** Reasons that never bypass the interval. */
const NEVER_BYPASS_REASONS: ReadonlySet<ScreenshotReason> = new Set(["interval"]);

export interface CaptureDecision {
  readonly allowed: boolean;
  readonly reason: "bypass" | "interval_ok" | "throttled";
  readonly waitMs: number;
}

export interface CaptureThrottleOptions {
  readonly now: () => number;
  readonly minIntervalMs?: number;
}

/** Enforces at most one capture per interval outside a run; teach markers and run steps bypass. */
export class CaptureThrottle {
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private lastCaptureTs: number | null = null;

  constructor(options: CaptureThrottleOptions) {
    if (options.minIntervalMs !== undefined && options.minIntervalMs <= 0) {
      throw new Error("CaptureThrottle: minIntervalMs must be positive");
    }
    this.now = options.now;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_CAPTURE_INTERVAL_MS;
  }

  decide(reason: ScreenshotReason): CaptureDecision {
    const current = this.now();
    if (BYPASS_REASONS.has(reason)) return { allowed: true, reason: "bypass", waitMs: 0 };
    if (this.lastCaptureTs === null) return { allowed: true, reason: "interval_ok", waitMs: 0 };
    const elapsed = current - this.lastCaptureTs;
    if (elapsed >= this.minIntervalMs) return { allowed: true, reason: "interval_ok", waitMs: 0 };
    const waitMs = this.minIntervalMs - elapsed;
    return { allowed: false, reason: "throttled", waitMs: NEVER_BYPASS_REASONS.has(reason) ? waitMs : waitMs };
  }

  /** Decides and, when allowed, records the capture timestamp. */
  request(reason: ScreenshotReason): CaptureDecision {
    const decision = this.decide(reason);
    if (decision.allowed) this.lastCaptureTs = this.now();
    return decision;
  }

  reset(): void {
    this.lastCaptureTs = null;
  }
}
