import { isDomainAllowed, newId, type MetricsRecorder } from "@apprentice/core";
import type { ActivityEvent, AppRef, ExtensionEvent, HelperEvent, PrivacyClassification, ScreenshotReason, ScreenshotRecord, SemanticElement } from "@apprentice/schemas";
import type { StorageRef } from "../app-context.js";
import type { Clock } from "../clock.js";
import type { Emit } from "../events.js";
import type { HelperClient } from "../helper/types.js";
import type { Logger } from "../logger.js";
import type { SettingsStore } from "../settings-store.js";
import type { CaptureService } from "./capture-service.js";
import { createContextClassifier, type ContextClassifier, type ContextClassifierInput } from "./context-classifier.js";
import { DEFAULT_CLICK_AX_TIMEOUT_MS, elementFromAxContext, withTimeout } from "./click-enrichment.js";
import { mapExtensionEvent, mapHelperEvent, roundTimestamp, withoutUndefined, type ActivityEventDraft, type MappedHelperEvent } from "./event-mapping.js";

export interface FocusContext {
  readonly app?: AppRef;
  readonly windowTitle?: string;
  readonly domain?: string;
  readonly path?: string;
}

export interface ObservationPipelineDeps {
  readonly storage: StorageRef;
  readonly settings: SettingsStore;
  readonly helper: HelperClient;
  readonly capture: CaptureService;
  readonly sessionId: string;
  readonly emit: Emit;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly isCapturing: () => boolean;
  /**
   * True while a guided run is executing. The helper posts the run's own clicks and keys, and
   * the observer would otherwise record them as the user's routine and feed them to discovery.
   */
  readonly runActive?: () => boolean;
  readonly metrics?: MetricsRecorder;
  readonly fixturePath?: string;
  readonly flushIntervalMs?: number;
  readonly batchSize?: number;
  readonly clickSettleMs?: number;
  readonly intervalMs?: number;
  /** Upper bound for the accessibility lookup that enriches native clicks. */
  readonly clickAxTimeoutMs?: number;
}

export interface IngestResult {
  readonly accepted: number;
  readonly dropped: number;
}

/** A buffered event; `pending` entries wait for click enrichment and block the batch behind them so seq order is kept. */
interface BufferEntry {
  readonly event: ActivityEvent;
  readonly pending: boolean;
}

const DEFAULT_FLUSH_MS = 500;
const DEFAULT_BATCH = 50;
const DEFAULT_CLICK_SETTLE_MS = 400;
const DEFAULT_INTERVAL_MS = 5000;
/** A second mouse_down this close in time and space in the same app is a multi-click, not a new click. */
const MULTI_CLICK_WINDOW_MS = 350;
const MULTI_CLICK_RADIUS_PX = 6;
/** An interval screenshot joins the newest allowed event of the same app that happened this recently. */
const INTERVAL_ATTACH_WINDOW_MS = 5000;

/** The most recent buffered click, kept so a double click collapses into it. */
interface RecentClick {
  readonly eventId: string;
  readonly ts: number;
  readonly x: number;
  readonly y: number;
  readonly bundleId: string | undefined;
}

/**
 * Turns helper and extension events into allowlist-checked ActivityEvents,
 * batches database writes, and decides when a sparse screenshot may be taken.
 */
export class ObservationPipeline {
  private context: FocusContext = {};
  private lastGapKey: string | null = null;
  private capturePaused = false;
  private idle = false;
  private seq: number;
  private buffer: readonly BufferEntry[] = [];
  private enrichments: ReadonlySet<Promise<void>> = new Set();
  private flushTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private clickTimer: NodeJS.Timeout | null = null;
  private unsubscribeHelper: (() => void) | null = null;
  private unsubscribeCapture: (() => void) | null = null;
  private storedListeners: ReadonlyArray<(events: readonly ActivityEvent[]) => void> = [];
  private lastNavigation: { domain: string; path: string; ts: number } | null = null;
  private recentClick: RecentClick | null = null;
  private observing = false;
  private readonly classifier: ContextClassifier;

  constructor(private readonly deps: ObservationPipelineDeps) {
    this.classifier = createContextClassifier(deps.settings, () => deps.isCapturing());
    this.seq = deps.storage.current.events.latestSeq(deps.sessionId) + 1;
    this.unsubscribeCapture = deps.capture.onCaptured((record) => this.attachScreenshot(record));
  }

  get isObserving(): boolean {
    return this.observing;
  }

  currentContext(): FocusContext {
    return this.context;
  }

  latestNavigation(): { domain: string; path: string; ts: number } | null {
    return this.lastNavigation;
  }

  /** Number of clicks whose accessibility enrichment has not settled yet. */
  get pendingEnrichments(): number {
    return this.enrichments.size;
  }

  onStored(listener: (events: readonly ActivityEvent[]) => void): () => void {
    this.storedListeners = [...this.storedListeners, listener];
    return () => {
      this.storedListeners = this.storedListeners.filter((entry) => entry !== listener);
    };
  }

  /** Starts helper observation and the interval fallback. Called when learning turns on. */
  async start(): Promise<void> {
    if (this.observing) return;
    this.observing = true;
    this.unsubscribeHelper ??= this.deps.helper.onEvent((event) => this.handleHelperEvent(event));
    this.intervalTimer = setInterval(() => this.intervalTick(), this.deps.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.intervalTimer.unref?.();
    this.deps.capture.resetThrottle();
    if (this.deps.helper.connected) {
      await this.deps.helper.startObservation(this.deps.fixturePath ? { fixturePath: this.deps.fixturePath } : {});
    }
    this.pushEvent({ ts: this.deps.clock.now(), source: "system", type: "learning_state_changed", privacy: "allowed", redaction: "none_needed", payload: { state: "learning" } });
  }

  /** Stops helper observation and timers; nothing is captured until start() again. */
  async stop(): Promise<void> {
    if (!this.observing) return;
    this.observing = false;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = null;
    if (this.clickTimer) clearTimeout(this.clickTimer);
    this.clickTimer = null;
    if (this.deps.helper.connected) {
      await this.deps.helper.stopObservation().catch((error: unknown) => {
        this.deps.logger.warn("stopObservation failed", { error: error instanceof Error ? error.message : String(error) });
      });
    }
    this.flush();
  }

  async shutdown(): Promise<void> {
    await this.stop();
    this.unsubscribeHelper?.();
    this.unsubscribeHelper = null;
    this.unsubscribeCapture?.();
    this.unsubscribeCapture = null;
    await this.settleEnrichments();
    this.flush();
    await this.deps.capture.idle();
  }

  /** Resolves once every in-flight click enrichment has settled (each is bounded by the AX timeout). */
  async settleEnrichments(): Promise<void> {
    while (this.enrichments.size > 0) await Promise.all([...this.enrichments]);
  }

  /** Writes the ready prefix of the buffer now and notifies listeners. Events behind a pending click wait. */
  flush(): readonly ActivityEvent[] {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const firstPending = this.buffer.findIndex((entry) => entry.pending);
    const ready = firstPending === -1 ? this.buffer : this.buffer.slice(0, firstPending);
    if (ready.length === 0) return [];
    this.buffer = this.buffer.slice(ready.length);
    const batch = ready.map((entry) => entry.event);
    const result = this.deps.storage.current.events.insertValidated(batch);
    for (const rejected of result.rejected) {
      this.deps.metrics?.increment("events.invalid");
      this.deps.logger.error("event rejected by schema", { id: rejected.id, type: rejected.type, error: rejected.error });
    }
    if (result.inserted.length === 0) return [];
    this.deps.emit("event:activity", { events: [...result.inserted] });
    for (const listener of this.storedListeners) listener(result.inserted);
    return result.inserted;
  }

  /** Explicit teach marker (global shortcut). Always stored; bypasses the capture interval. */
  insertTeachMarker(phase: "start" | "end" = "start"): ActivityEvent {
    const event = this.pushEvent({
      ts: this.deps.clock.now(),
      source: "user",
      type: "teach_marker",
      app: this.context.app,
      domain: this.context.domain,
      privacy: "allowed",
      redaction: "none_needed",
      payload: { phase }
    });
    if (this.captureAllowed()) this.deps.capture.request("teach_marker", this.captureContext(event.id));
    return event;
  }

  /** Browser events from the paired extension. The allowlist is re-checked per event. */
  ingestExtensionBatch(events: readonly ExtensionEvent[]): IngestResult {
    if (!this.deps.isCapturing() || this.deps.runActive?.() === true) return { accepted: 0, dropped: events.length };
    let accepted = 0;
    let dropped = 0;
    for (const event of events) {
      if (this.ingestExtensionEvent(event)) accepted += 1;
      else dropped += 1;
    }
    return { accepted, dropped };
  }

  private classify(input: ContextClassifierInput): PrivacyClassification {
    return this.classifier(input);
  }

  private ingestExtensionEvent(raw: ExtensionEvent): boolean {
    const domain = raw.domain.toLowerCase();
    const allowed = isDomainAllowed(domain, this.deps.settings.get().allowlist.domains);
    if (!allowed) {
      this.recordGap(`domain:${domain}`, { domain });
      return false;
    }
    const mapped = mapExtensionEvent(raw);
    if (mapped.resumesCapture) {
      this.capturePaused = false;
      return true;
    }
    const ts = roundTimestamp(raw.ts);
    if (raw.type === "navigation") {
      this.lastNavigation = { domain, path: raw.path ?? "/", ts };
      this.context = { ...this.context, domain, path: raw.path ?? "/" };
    }
    const event = this.pushEvent(
      withoutUndefined({
        ts,
        source: "extension",
        type: mapped.type,
        app: this.context.app,
        domain,
        routePattern: mapped.routePattern,
        element: mapped.element,
        privacy: mapped.sensitive ? "sensitive" : "allowed",
        redaction: "redacted",
        payload: mapped.payload
      })
    );
    if (mapped.sensitive) {
      this.capturePaused = true;
      return true;
    }
    if (mapped.captureReason !== undefined) this.scheduleCapture(mapped.captureReason, event.id);
    return true;
  }

  private handleHelperEvent(raw: HelperEvent): void {
    if (!this.deps.isCapturing()) return;
    let mapped: ReturnType<typeof mapHelperEvent>;
    try {
      mapped = mapHelperEvent(raw);
    } catch (error) {
      this.deps.logger.warn("helper event rejected", { event: raw.event, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (mapped === null) return;
    const ts = roundTimestamp(raw.ts);
    if (mapped.type === "idle_changed") {
      this.idle = mapped.payload?.["idle"] === true;
      this.pushEvent({ ts, source: "native_helper", type: "idle_changed", app: this.context.app, privacy: "allowed", redaction: "none_needed", payload: mapped.payload });
      return;
    }
    if (mapped.contextChange) this.applyContextChange(mapped.app, mapped.windowTitle);
    if (this.deps.runActive?.() === true) {
      // Keep the app context current, but never learn from the assistant's own approved actions.
      this.deps.metrics?.increment("event.suppressed_during_run");
      return;
    }
    const bundleId = mapped.app?.bundleId ?? this.context.app?.bundleId;
    const app = bundleId !== undefined ? { ...this.context.app, bundleId } : undefined;
    const classification = this.classify({ bundleId, isSecureInput: mapped.sensitive });
    if (classification === "excluded") return;
    if (classification === "privacy_gap") {
      this.recordGap(`app:${bundleId ?? "unknown"}`, { app });
      return;
    }
    if (classification === "sensitive" || mapped.sensitive) {
      this.capturePaused = true;
      this.pushEvent({ ts, source: "native_helper", type: mapped.sensitive ? "secure_field_focused" : "privacy_gap", app, privacy: "sensitive", redaction: "none_needed", payload: mapped.sensitive ? mapped.payload : { reason: "denied_app" } });
      return;
    }
    this.storeAllowedHelperEvent(mapped, ts, app);
  }

  /** Stores an allowed helper event; clicks wait for accessibility enrichment, sensitive views pause capture. */
  private storeAllowedHelperEvent(mapped: MappedHelperEvent, ts: number, app: AppRef | undefined): void {
    const sensitiveView = mapped.sensitiveView === true;
    const draft: ActivityEventDraft = withoutUndefined({
      ts,
      source: "native_helper",
      type: mapped.type,
      app,
      privacy: sensitiveView ? "sensitive" : "allowed",
      redaction: mapped.type === "window_title_changed" ? "redacted" : "none_needed",
      payload: sensitiveView ? { ...mapped.payload, sensitive: true } : mapped.payload
    });
    const point = mapped.type === "mouse_down" ? this.clickPoint(mapped) : null;
    if (point !== null) {
      const collapsed = this.collapseMultiClick(ts, point, app?.bundleId);
      if (collapsed !== null) {
        this.deps.metrics?.increment("click.collapsed");
        if (mapped.captureReason !== undefined) this.scheduleCapture(mapped.captureReason, collapsed);
        return;
      }
    }
    const enrich = point !== null && this.deps.helper.connected;
    const event = this.pushEvent(draft, { pending: enrich });
    if (point !== null) this.recentClick = { eventId: event.id, ts, x: point.x, y: point.y, bundleId: app?.bundleId };
    if (enrich && point !== null) this.trackEnrichment(this.enrichClick(event.id, point.x, point.y));
    if (sensitiveView) {
      this.capturePaused = true;
      return;
    }
    if (mapped.captureReason !== undefined) this.scheduleCapture(mapped.captureReason, event.id);
  }

  private clickPoint(mapped: MappedHelperEvent): { x: number; y: number } | null {
    const x = mapped.payload?.["x"];
    const y = mapped.payload?.["y"];
    return typeof x === "number" && typeof y === "number" ? { x, y } : null;
  }

  /**
   * Folds a mouse_down that lands within the multi-click window and radius of the previous
   * click in the same app into that click by bumping `payload.count`. Returns the id of the
   * absorbing event, or null when the click is a new one (or the previous click already
   * left the buffer).
   */
  private collapseMultiClick(ts: number, point: { x: number; y: number }, bundleId: string | undefined): string | null {
    const previous = this.recentClick;
    if (previous === null) return null;
    const near = ts - previous.ts <= MULTI_CLICK_WINDOW_MS && ts >= previous.ts && Math.abs(point.x - previous.x) <= MULTI_CLICK_RADIUS_PX && Math.abs(point.y - previous.y) <= MULTI_CLICK_RADIUS_PX;
    if (!near || previous.bundleId !== bundleId) return null;
    const index = this.buffer.findIndex((entry) => entry.event.id === previous.eventId);
    if (index === -1) return null;
    const entry = this.buffer[index]!;
    const count = entry.event.payload?.["count"];
    const nextCount = (typeof count === "number" ? count : 1) + 1;
    const updated: BufferEntry = { ...entry, event: { ...entry.event, payload: { ...entry.event.payload, count: nextCount } } };
    this.buffer = [...this.buffer.slice(0, index), updated, ...this.buffer.slice(index + 1)];
    this.recentClick = { ...previous, ts };
    return previous.eventId;
  }

  private trackEnrichment(promise: Promise<void>): void {
    const tracked: Promise<void> = promise.finally(() => {
      this.enrichments = new Set([...this.enrichments].filter((entry) => entry !== tracked));
    });
    this.enrichments = new Set([...this.enrichments, tracked]);
  }

  /** Asks the helper what sits under the click; on failure or timeout the event is stored as a plain click. */
  private async enrichClick(eventId: string, x: number, y: number): Promise<void> {
    const timeoutMs = this.deps.clickAxTimeoutMs ?? DEFAULT_CLICK_AX_TIMEOUT_MS;
    let element: SemanticElement | undefined;
    try {
      element = elementFromAxContext(await withTimeout(this.deps.helper.accessibilityContextAtPoint(x, y), timeoutMs));
      this.deps.metrics?.increment(element !== undefined ? "click.enriched" : "click.unresolved");
    } catch (error) {
      this.deps.metrics?.increment("click.enrichmentFailed");
      this.deps.logger.debug("click enrichment skipped", { error: error instanceof Error ? error.message : String(error) });
    }
    this.resolvePending(eventId, element);
  }

  private resolvePending(eventId: string, element: SemanticElement | undefined): void {
    this.buffer = this.buffer.map((entry) => {
      if (entry.event.id !== eventId) return entry;
      return { event: element !== undefined ? { ...entry.event, element } : entry.event, pending: false };
    });
    this.scheduleFlush();
  }

  private applyContextChange(app: AppRef | undefined, windowTitle: string | undefined): void {
    const nextApp = app?.bundleId !== undefined && app.bundleId !== this.context.app?.bundleId ? app : { ...this.context.app, ...app };
    const appChanged = nextApp?.bundleId !== this.context.app?.bundleId;
    this.context = withoutUndefined({ app: nextApp, windowTitle: windowTitle ?? (appChanged ? undefined : this.context.windowTitle), domain: appChanged ? undefined : this.context.domain, path: appChanged ? undefined : this.context.path });
    this.capturePaused = false;
    if (appChanged) this.lastGapKey = null;
  }

  private recordGap(key: string, fields: { app?: AppRef; domain?: string }): void {
    if (this.lastGapKey === key) return;
    this.lastGapKey = key;
    this.pushEvent(withoutUndefined({ ts: this.deps.clock.now(), source: "system", type: "privacy_gap", app: fields.app ? { bundleId: fields.app.bundleId } : undefined, privacy: "privacy_gap", redaction: "none_needed" }));
  }

  private captureAllowed(): boolean {
    if (!this.deps.isCapturing() || this.capturePaused || this.idle) return false;
    const classification = this.classify({ bundleId: this.context.app?.bundleId, domain: this.context.domain });
    return classification === "allowed";
  }

  private captureContext(eventId: string): { eventId: string; app?: AppRef; domain?: string } {
    return withoutUndefined({ eventId, app: this.context.app, domain: this.context.domain });
  }

  private scheduleCapture(reason: ScreenshotReason, eventId: string): void {
    if (!this.captureAllowed()) return;
    if (reason === "click") {
      if (this.clickTimer) clearTimeout(this.clickTimer);
      this.clickTimer = setTimeout(() => {
        this.clickTimer = null;
        if (this.captureAllowed()) this.deps.capture.request("click", this.captureContext(eventId));
      }, this.deps.clickSettleMs ?? DEFAULT_CLICK_SETTLE_MS);
      this.clickTimer.unref?.();
      return;
    }
    this.deps.capture.request(reason, this.captureContext(eventId));
  }

  /**
   * Links a stored screenshot to its event. Triggered captures name their event;
   * interval captures adopt the newest allowed event of the same app within the
   * attach window when that event has no screenshot yet.
   */
  private attachScreenshot(record: ScreenshotRecord): void {
    if (record.eventId !== undefined) {
      this.linkScreenshot(record.eventId, record.id);
      return;
    }
    if (record.reason !== "interval") return;
    const eventId = this.findRecentEventFor(record);
    if (eventId === null) return;
    this.deps.storage.current.screenshots.setEventId(record.id, eventId);
    this.linkScreenshot(eventId, record.id, record);
  }

  /** Sets `screenshotRef` on the buffered copy, or on the stored row when the event was already written. */
  private linkScreenshot(eventId: string, screenshotId: string, record?: ScreenshotRecord): void {
    const index = this.buffer.findIndex((entry) => entry.event.id === eventId);
    if (index !== -1) {
      const entry = this.buffer[index]!;
      const updated: BufferEntry = { ...entry, event: { ...entry.event, screenshotRef: screenshotId } };
      this.buffer = [...this.buffer.slice(0, index), updated, ...this.buffer.slice(index + 1)];
      return;
    }
    const stored = this.deps.storage.current.events.setScreenshotRef(eventId, screenshotId);
    if (stored === null) {
      this.deps.logger.debug("screenshot event no longer stored", { eventId, screenshotId });
      return;
    }
    const attached = record ?? this.deps.storage.current.screenshots.get(screenshotId);
    this.deps.emit("event:activity", { events: [stored], screenshots: attached ? [attached] : [] });
  }

  private findRecentEventFor(record: ScreenshotRecord): string | null {
    const bundleId = record.app?.bundleId;
    if (bundleId === undefined) return null;
    const fromTs = record.ts - INTERVAL_ATTACH_WINDOW_MS;
    const attachable = (event: ActivityEvent): boolean =>
      event.privacy === "allowed" && event.app?.bundleId === bundleId && event.ts >= fromTs && event.ts <= record.ts && event.screenshotRef === undefined;
    const buffered = [...this.buffer].reverse().find((entry) => attachable(entry.event));
    if (buffered !== undefined) return buffered.event.id;
    const stored = this.deps.storage.current.events.query({ fromTs, toTs: record.ts, app: bundleId, sessionId: this.deps.sessionId, limit: 200 });
    return [...stored].reverse().find(attachable)?.id ?? null;
  }

  private intervalTick(): void {
    if (!this.observing || !this.captureAllowed()) return;
    this.deps.capture.request("interval", withoutUndefined({ app: this.context.app, domain: this.context.domain }));
  }

  private scheduleFlush(): void {
    if (this.buffer.length >= (this.deps.batchSize ?? DEFAULT_BATCH)) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.deps.flushIntervalMs ?? DEFAULT_FLUSH_MS);
      this.flushTimer.unref?.();
    }
  }

  private pushEvent(draft: ActivityEventDraft, options: { pending?: boolean } = {}): ActivityEvent {
    const event: ActivityEvent = withoutUndefined({ ...draft, ts: roundTimestamp(draft.ts), id: newId("evt"), seq: this.seq, sessionId: this.deps.sessionId });
    this.seq += 1;
    this.buffer = [...this.buffer, { event, pending: options.pending === true }];
    this.scheduleFlush();
    return event;
  }
}
