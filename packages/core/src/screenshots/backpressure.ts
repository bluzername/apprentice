export type QueueItemKind = "screenshot" | "event";

export interface QueueClassification {
  readonly kind: QueueItemKind;
  /** Perceptual hash for screenshots; used to drop redundant items. */
  readonly hash?: string;
}

export interface BackpressureStats {
  readonly size: number;
  readonly peakSize: number;
  readonly drops: { readonly redundant: number; readonly screenshot: number; readonly event: number };
}

export interface BackpressureQueueOptions<T> {
  readonly capacity: number;
  readonly classify: (item: T) => QueueClassification;
}

export type PushResult = "queued" | "dropped_redundant" | "dropped_event";

/**
 * Bounded queue. Redundant screenshots (same hash as a queued one) are dropped
 * first; when full, the oldest queued screenshot is evicted before any
 * semantic event is dropped.
 */
export class BackpressureQueue<T> {
  private readonly capacity: number;
  private readonly classify: (item: T) => QueueClassification;
  private items: T[] = [];
  private peak = 0;
  private droppedRedundant = 0;
  private droppedScreenshots = 0;
  private droppedEvents = 0;

  constructor(options: BackpressureQueueOptions<T>) {
    if (!Number.isInteger(options.capacity) || options.capacity <= 0) {
      throw new Error("BackpressureQueue: capacity must be a positive integer");
    }
    this.capacity = options.capacity;
    this.classify = options.classify;
  }

  push(item: T): PushResult {
    const meta = this.classify(item);
    if (meta.kind === "screenshot" && meta.hash !== undefined && this.hasScreenshotHash(meta.hash)) {
      this.droppedRedundant += 1;
      return "dropped_redundant";
    }
    if (this.items.length >= this.capacity) {
      const evicted = this.evictOldestScreenshot();
      if (!evicted) {
        this.droppedEvents += 1;
        return "dropped_event";
      }
    }
    this.items = [...this.items, item];
    this.peak = Math.max(this.peak, this.items.length);
    return "queued";
  }

  shift(): T | undefined {
    const [head, ...rest] = this.items;
    if (head === undefined) return undefined;
    this.items = rest;
    return head;
  }

  drain(): readonly T[] {
    const drained = this.items;
    this.items = [];
    return drained;
  }

  get size(): number {
    return this.items.length;
  }

  stats(): BackpressureStats {
    return {
      size: this.items.length,
      peakSize: this.peak,
      drops: { redundant: this.droppedRedundant, screenshot: this.droppedScreenshots, event: this.droppedEvents }
    };
  }

  private hasScreenshotHash(hash: string): boolean {
    return this.items.some((queued) => {
      const meta = this.classify(queued);
      return meta.kind === "screenshot" && meta.hash === hash;
    });
  }

  private evictOldestScreenshot(): boolean {
    const index = this.items.findIndex((queued) => this.classify(queued).kind === "screenshot");
    if (index < 0) return false;
    this.items = [...this.items.slice(0, index), ...this.items.slice(index + 1)];
    this.droppedScreenshots += 1;
    return true;
  }
}
