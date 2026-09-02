/**
 * In-memory event batch queue. Flushes every QUEUE_FLUSH_INTERVAL_MS or when
 * QUEUE_MAX_BATCH events are pending, backs off exponentially on failure, and
 * never retries after a 401 (the pairing is cleared instead).
 */
import type { ExtensionEvent } from "@apprentice/schemas";
import {
  QUEUE_BASE_BACKOFF_MS,
  QUEUE_FLUSH_INTERVAL_MS,
  QUEUE_MAX_BACKOFF_MS,
  QUEUE_MAX_BATCH,
  QUEUE_MAX_PENDING
} from "../shared/constants.js";
import { isLoopbackError } from "./errors.js";

export interface QueueSendResult {
  readonly accepted: number;
  readonly dropped: number;
}

export interface QueueOptions {
  readonly send: (events: readonly ExtensionEvent[]) => Promise<QueueSendResult>;
  readonly isPaired: () => boolean;
  readonly onUnauthorized: () => void | Promise<void>;
  readonly onFlushed?: (result: QueueSendResult) => void;
  readonly onFailure?: (error: unknown, attempt: number) => void;
  readonly onDropped?: (count: number, reason: "unpaired" | "overflow") => void;
  readonly flushIntervalMs?: number;
  readonly maxBatch?: number;
  readonly maxPending?: number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
}

export interface EventQueue {
  enqueue(event: ExtensionEvent): void;
  flush(): Promise<void>;
  size(): number;
  failures(): number;
  dispose(): void;
}

export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 16));
  return Math.min(maxMs, baseMs * 2 ** exponent);
}

export function createEventQueue(options: QueueOptions): EventQueue {
  const flushIntervalMs = options.flushIntervalMs ?? QUEUE_FLUSH_INTERVAL_MS;
  const maxBatch = options.maxBatch ?? QUEUE_MAX_BATCH;
  const maxPending = options.maxPending ?? QUEUE_MAX_PENDING;
  const baseBackoffMs = options.baseBackoffMs ?? QUEUE_BASE_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? QUEUE_MAX_BACKOFF_MS;

  let pending: readonly ExtensionEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let consecutiveFailures = 0;
  let blockedUntil = 0;
  let disposed = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (delayMs: number): void => {
    if (disposed || timer !== null) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
  };

  const flush = async (): Promise<void> => {
    if (inFlight !== null) {
      return inFlight;
    }
    if (disposed || pending.length === 0) {
      return;
    }
    if (!options.isPaired()) {
      const dropped = pending.length;
      pending = [];
      options.onDropped?.(dropped, "unpaired");
      return;
    }
    const now = Date.now();
    if (now < blockedUntil) {
      schedule(blockedUntil - now);
      return;
    }
    const batch = pending.slice(0, maxBatch);
    inFlight = (async () => {
      try {
        const result = await options.send(batch);
        pending = pending.slice(batch.length);
        consecutiveFailures = 0;
        blockedUntil = 0;
        options.onFlushed?.(result);
      } catch (error) {
        if (isLoopbackError(error) && error.kind === "unauthorized") {
          const dropped = pending.length;
          pending = [];
          consecutiveFailures = 0;
          options.onFailure?.(error, 0);
          options.onDropped?.(dropped, "unpaired");
          await options.onUnauthorized();
          return;
        }
        consecutiveFailures += 1;
        const retryAfter = isLoopbackError(error) ? error.retryAfterMs : undefined;
        const delay = Math.max(retryAfter ?? 0, backoffDelay(consecutiveFailures, baseBackoffMs, maxBackoffMs));
        blockedUntil = Date.now() + delay;
        options.onFailure?.(error, consecutiveFailures);
      }
    })().finally(() => {
      inFlight = null;
    });
    await inFlight;
    if (pending.length > 0) {
      const wait = Math.max(0, blockedUntil - Date.now());
      schedule(wait > 0 ? wait : pending.length >= maxBatch ? 0 : flushIntervalMs);
    }
  };

  return {
    enqueue(event) {
      if (disposed) {
        return;
      }
      if (!options.isPaired()) {
        options.onDropped?.(1, "unpaired");
        return;
      }
      if (pending.length >= maxPending) {
        pending = pending.slice(pending.length - maxPending + 1);
        options.onDropped?.(1, "overflow");
      }
      pending = [...pending, event];
      if (pending.length >= maxBatch && Date.now() >= blockedUntil) {
        clearTimer();
        void flush();
        return;
      }
      schedule(Math.max(flushIntervalMs, blockedUntil - Date.now()));
    },
    flush,
    size: () => pending.length,
    failures: () => consecutiveFailures,
    dispose() {
      disposed = true;
      clearTimer();
      pending = [];
    }
  };
}
