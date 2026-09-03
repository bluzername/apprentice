import type { ActivityEvent, ScreenshotRecord } from "@apprentice/schemas";
import type { StorageRef } from "./app-context.js";
import { ServiceError } from "./errors.js";
import { pngDimensions } from "./images/png-resize.js";

export interface ActivityQuery {
  readonly fromTs?: number;
  readonly toTs?: number;
  readonly app?: string;
  readonly domain?: string;
  readonly types?: readonly string[];
  readonly limit: number;
}

/** A triggered screenshot lands a little after its event (click settle plus capture time). */
const SCREENSHOT_LAG_MS = 10_000;

/**
 * Fills in `screenshotRef` from the screenshot index for events stored before
 * the link was written on the event side. Events that already carry a ref win.
 */
export function withDerivedScreenshotRefs(events: readonly ActivityEvent[], screenshots: readonly ScreenshotRecord[]): ActivityEvent[] {
  const byEventId = new Map<string, string>();
  for (const shot of screenshots) {
    if (shot.eventId !== undefined && !byEventId.has(shot.eventId)) byEventId.set(shot.eventId, shot.id);
  }
  return events.map((event) => {
    if (event.screenshotRef !== undefined) return event;
    const derived = byEventId.get(event.id);
    return derived === undefined ? event : { ...event, screenshotRef: derived };
  });
}

/** Activity timeline queries and deletions. Titles are never revealed to listings. */
export class ActivityService {
  constructor(private readonly storage: StorageRef) {}

  list(query: ActivityQuery): { events: ActivityEvent[]; screenshots: ScreenshotRecord[] } {
    const storage = this.storage.current;
    const stored = storage.events.query({ fromTs: query.fromTs, toTs: query.toTs, app: query.app, domain: query.domain, types: query.types, limit: query.limit }, { revealSensitive: false });
    const first = stored[0];
    const last = stored[stored.length - 1];
    const fromTs = query.fromTs ?? first?.ts ?? 0;
    const toTs = (query.toTs ?? last?.ts ?? fromTs) + SCREENSHOT_LAG_MS;
    const screenshots = stored.length === 0 && query.fromTs === undefined ? [] : storage.screenshots.inRange(fromTs, toTs);
    return { events: withDerivedScreenshotRefs(stored, screenshots), screenshots };
  }

  deleteEvents(ids: readonly string[]): number {
    return this.storage.current.events.deleteByIds(ids);
  }

  deleteRange(fromTs: number, toTs: number): number {
    const storage = this.storage.current;
    this.deleteScreenshots(storage.screenshots.idsInRange(fromTs, toTs));
    return storage.events.deleteRange(fromTs, toTs);
  }

  /** Removes screenshot blobs, records, and OCR; same semantics as the screenshot half of deleteRange. */
  deleteScreenshots(ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    const storage = this.storage.current;
    for (const id of ids) storage.blobs.delete(id);
    return storage.screenshots.deleteByIds(ids);
  }

  screenshot(id: string): { pngBase64: string; width: number; height: number } {
    const storage = this.storage.current;
    const record = storage.screenshots.get(id);
    const png = storage.blobs.read(id);
    if (!record || !png) throw new ServiceError("not_found", `Screenshot ${id} not found`);
    const dims = pngDimensions(png);
    return { pngBase64: png.toString("base64"), width: dims.width, height: dims.height };
  }
}
