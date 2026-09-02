export class InferenceCancelledError extends Error {
  constructor(message = "Model work was cancelled") {
    super(message);
    this.name = "InferenceCancelledError";
  }
}

export interface QueueStats {
  readonly pending: number;
  readonly active: number;
  readonly peak: number;
  readonly lastLatencyMs?: number;
}

interface Job<T> {
  readonly run: (signal: AbortSignal) => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

export interface InferenceQueueOptions {
  /** Returns a reason while model work must wait (battery, thermal, idle), or null. */
  readonly pauseReason?: () => string | null;
  readonly pausePollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Serial (concurrency 1) queue for every provider call, with cancellation and pause support. */
export class InferenceQueue {
  private jobs: Array<Job<unknown>> = [];
  private activeCount = 0;
  private peak = 0;
  private lastLatencyMs: number | undefined;
  private controller = new AbortController();
  private draining = false;

  constructor(private readonly options: InferenceQueueOptions = {}) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  stats(): QueueStats {
    return { pending: this.jobs.length, active: this.activeCount, peak: this.peak, lastLatencyMs: this.lastLatencyMs };
  }

  isBusy(): boolean {
    return this.activeCount > 0 || this.jobs.length > 0;
  }

  enqueue<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs = [...this.jobs, { run: run as (signal: AbortSignal) => Promise<unknown>, resolve: resolve as (value: unknown) => void, reject }];
      this.peak = Math.max(this.peak, this.jobs.length + this.activeCount);
      void this.drain();
    });
  }

  /** Rejects every pending job and aborts the in-flight request's signal. */
  cancelAll(): number {
    const cancelled = this.jobs;
    this.jobs = [];
    for (const job of cancelled) job.reject(new InferenceCancelledError());
    this.controller.abort(new InferenceCancelledError());
    this.controller = new AbortController();
    return cancelled.length + this.activeCount;
  }

  private async waitWhilePaused(): Promise<void> {
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.()));
    while (this.options.pauseReason?.() !== null && this.options.pauseReason?.() !== undefined) {
      await sleep(this.options.pausePollMs ?? 2000);
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.jobs.length > 0) {
        await this.waitWhilePaused();
        const [job, ...rest] = this.jobs;
        this.jobs = rest;
        if (!job) break;
        this.activeCount = 1;
        const started = performance.now();
        const signal = this.controller.signal;
        try {
          const value = await job.run(signal);
          this.lastLatencyMs = performance.now() - started;
          job.resolve(value);
        } catch (error) {
          this.lastLatencyMs = performance.now() - started;
          job.reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          this.activeCount = 0;
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
