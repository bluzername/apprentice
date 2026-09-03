import { BackpressureQueue, CaptureThrottle, isNearDuplicate, newId, type CaptureDecision } from "@apprentice/core";
import type { AppRef, OcrImageResult, OcrResult, ScreenshotReason, ScreenshotRecord } from "@apprentice/schemas";
import type { MetricsRecorder } from "@apprentice/core";
import type { StorageRef } from "../app-context.js";
import type { Clock } from "../clock.js";
import { hashPng, resizeToLongEdge, type PngResizer } from "../images/png-resize.js";
import type { Logger } from "../logger.js";
import type { ScreenSource } from "./screen-source.js";

export type OcrFn = (pngBase64: string) => Promise<OcrImageResult>;

export interface CaptureContext {
  readonly eventId?: string;
  readonly app?: AppRef;
  readonly domain?: string;
}

interface CaptureJob {
  readonly reason: ScreenshotReason;
  readonly context: CaptureContext;
  readonly enqueuedAt: number;
}

export interface CaptureServiceDeps {
  readonly storage: StorageRef;
  readonly screenSource: ScreenSource;
  readonly ocr: OcrFn;
  readonly resizer: PngResizer;
  readonly metrics: MetricsRecorder;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly sessionId: string;
  readonly minIntervalMs?: number;
  readonly queueCapacity?: number;
  readonly ocrMaxLongEdge?: number;
}

export const OCR_MAX_LONG_EDGE = 1280;

/**
 * Sparse screenshot capture: throttle, perceptual dedup, backpressure (concurrency 1),
 * encrypted blob, screenshot record, then encrypted OCR. Every stage is timed.
 */
export class CaptureService {
  private readonly throttle: CaptureThrottle;
  private readonly queue: BackpressureQueue<CaptureJob>;
  private draining: Promise<void> | null = null;
  private lastHash: string | null = null;
  private captured = 0;
  private deduplicated = 0;

  constructor(private readonly deps: CaptureServiceDeps) {
    this.throttle = new CaptureThrottle({ now: () => deps.clock.now(), minIntervalMs: deps.minIntervalMs });
    this.queue = new BackpressureQueue<CaptureJob>({ capacity: deps.queueCapacity ?? 4, classify: () => ({ kind: "screenshot" }) });
    this.lastHash = deps.storage.current.screenshots.latestHash();
  }

  /** Applies the throttle and enqueues a capture when allowed. */
  request(reason: ScreenshotReason, context: CaptureContext = {}): CaptureDecision {
    const decision = this.throttle.request(reason);
    if (!decision.allowed) return decision;
    this.queue.push({ reason, context, enqueuedAt: this.deps.clock.now() });
    this.deps.metrics.increment("capture.enqueued");
    this.kick();
    return decision;
  }

  resetThrottle(): void {
    this.throttle.reset();
  }

  stats(): { captured: number; deduplicated: number; queue: ReturnType<BackpressureQueue<CaptureJob>["stats"]>; lastHash: string | null } {
    return { captured: this.captured, deduplicated: this.deduplicated, queue: this.queue.stats(), lastHash: this.lastHash };
  }

  /** Resolves once every queued capture finished (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private kick(): void {
    if (this.draining) return;
    this.draining = this.drain().finally(() => {
      this.draining = null;
      if (this.queue.size > 0) this.kick();
    });
  }

  private async drain(): Promise<void> {
    for (let job = this.queue.shift(); job !== undefined; job = this.queue.shift()) {
      try {
        await this.process(job);
      } catch (error) {
        this.deps.metrics.increment("capture.failed");
        this.deps.logger.warn("screenshot capture failed", { reason: job.reason, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private async process(job: CaptureJob): Promise<void> {
    const startedAt = this.deps.clock.now();
    this.deps.metrics.record("capture.queueDelayMs", Math.max(0, startedAt - job.enqueuedAt));
    const captureStart = performance.now();
    const capture = await this.deps.screenSource.captureFrontmost();
    this.deps.metrics.record("capture.captureMs", performance.now() - captureStart);
    const hash = hashPng(capture.png);
    if (this.lastHash !== null && isNearDuplicate(hash, this.lastHash)) {
      this.deduplicated += 1;
      this.deps.metrics.increment("capture.deduplicated");
      return;
    }
    const id = newId("shot");
    const storage = this.deps.storage.current;
    const written = storage.blobs.write(id, capture.png);
    this.deps.metrics.record("capture.encryptMs", written.encryptMs);
    const record: ScreenshotRecord = {
      id,
      ts: Math.round(capture.capturedAt),
      sessionId: this.deps.sessionId,
      eventId: job.context.eventId,
      width: capture.width,
      height: capture.height,
      displayScale: capture.displayScale,
      perceptualHash: hash,
      byteLength: written.byteLength,
      reason: job.reason,
      analyzed: false,
      app: job.context.app,
      domain: job.context.domain
    };
    storage.screenshots.insert(record);
    this.lastHash = hash;
    this.captured += 1;
    this.deps.metrics.increment("capture.stored");
    await this.runOcr(record, capture.png);
  }

  private async runOcr(record: ScreenshotRecord, png: Buffer): Promise<void> {
    const ocrStart = performance.now();
    try {
      const small = await resizeToLongEdge(this.deps.resizer, png, record.width, record.height, this.deps.ocrMaxLongEdge ?? OCR_MAX_LONG_EDGE);
      const result = await this.deps.ocr(small.png.toString("base64"));
      const ocr: OcrResult = { id: newId("ocr"), screenshotId: record.id, ts: record.ts, width: result.width, height: result.height, blocks: result.blocks.slice(0, 2000) };
      const storage = this.deps.storage.current;
      storage.screenshots.insertOcr(ocr);
      storage.screenshots.markAnalyzed(record.id);
      this.deps.metrics.record("capture.ocrMs", performance.now() - ocrStart);
    } catch (error) {
      this.deps.metrics.increment("capture.ocrFailed");
      this.deps.logger.warn("OCR failed; screenshot kept without text", { id: record.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
