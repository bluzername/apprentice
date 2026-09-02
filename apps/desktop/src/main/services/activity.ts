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

/** Activity timeline queries and deletions. Titles are never revealed to listings. */
export class ActivityService {
  constructor(private readonly storage: StorageRef) {}

  list(query: ActivityQuery): { events: ActivityEvent[]; screenshots: ScreenshotRecord[] } {
    const storage = this.storage.current;
    const events = storage.events.query({ fromTs: query.fromTs, toTs: query.toTs, app: query.app, domain: query.domain, types: query.types, limit: query.limit }, { revealSensitive: false });
    const first = events[0];
    const last = events[events.length - 1];
    const fromTs = query.fromTs ?? first?.ts ?? 0;
    const toTs = query.toTs ?? last?.ts ?? fromTs;
    const screenshots = events.length === 0 && query.fromTs === undefined ? [] : storage.screenshots.inRange(fromTs, toTs);
    return { events, screenshots };
  }

  deleteEvents(ids: readonly string[]): number {
    return this.storage.current.events.deleteByIds(ids);
  }

  deleteRange(fromTs: number, toTs: number): number {
    const storage = this.storage.current;
    const screenshotIds = storage.screenshots.idsInRange(fromTs, toTs);
    for (const id of screenshotIds) storage.blobs.delete(id);
    storage.screenshots.deleteByIds(screenshotIds);
    return storage.events.deleteRange(fromTs, toTs);
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
