import type { ActivityEvent, ScreenshotRecord } from "@apprentice/schemas";
import { humanize } from "./format";

export type ActivityItem =
  | { readonly kind: "event"; readonly id: string; readonly ts: number; readonly event: ActivityEvent }
  | { readonly kind: "screenshot"; readonly id: string; readonly ts: number; readonly screenshot: ScreenshotRecord };

/** Timeline id for a screenshot shown on its own; distinct from event ids. */
export function screenshotItemId(screenshotId: string): string {
  return `shot:${screenshotId}`;
}

/**
 * Screenshots that no listed event displays: not referenced by any event's
 * `screenshotRef` and not pointing at an event that is in the list.
 */
export function standaloneScreenshots(events: readonly ActivityEvent[], screenshots: readonly ScreenshotRecord[]): ScreenshotRecord[] {
  const eventIds = new Set(events.map((event) => event.id));
  const referenced = new Set(events.map((event) => event.screenshotRef).filter((ref): ref is string => ref !== undefined));
  return screenshots.filter((shot) => !referenced.has(shot.id) && (shot.eventId === undefined || !eventIds.has(shot.eventId)));
}

/** Events and standalone screenshots in time order; an event sorts before a screenshot at the same instant. */
export function activityItems(events: readonly ActivityEvent[], screenshots: readonly ScreenshotRecord[]): ActivityItem[] {
  const items: ActivityItem[] = [
    ...events.map((event): ActivityItem => ({ kind: "event", id: event.id, ts: event.ts, event })),
    ...standaloneScreenshots(events, screenshots).map((screenshot): ActivityItem => ({ kind: "screenshot", id: screenshotItemId(screenshot.id), ts: screenshot.ts, screenshot }))
  ];
  return items.sort((a, b) => a.ts - b.ts || rank(a) - rank(b));
}

function rank(item: ActivityItem): number {
  return item.kind === "event" ? 0 : 1;
}

/** Replaces events that already exist (by id), appends the rest, keeps time order. */
export function mergeEvents(current: readonly ActivityEvent[], incoming: readonly ActivityEvent[]): ActivityEvent[] {
  if (incoming.length === 0) return [...current];
  const byId = new Map(incoming.map((event) => [event.id, event]));
  const replaced = current.map((event) => byId.get(event.id) ?? event);
  const known = new Set(current.map((event) => event.id));
  const fresh = incoming.filter((event) => !known.has(event.id));
  return [...replaced, ...fresh].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
}

export function mergeScreenshots(current: readonly ScreenshotRecord[], incoming: readonly ScreenshotRecord[]): ScreenshotRecord[] {
  if (incoming.length === 0) return [...current];
  const byId = new Map(incoming.map((shot) => [shot.id, shot]));
  const replaced = current.map((shot) => byId.get(shot.id) ?? shot);
  const known = new Set(current.map((shot) => shot.id));
  const fresh = incoming.filter((shot) => !known.has(shot.id));
  return [...replaced, ...fresh].sort((a, b) => a.ts - b.ts);
}

export function screenshotTitle(record: ScreenshotRecord): string {
  return `Screenshot (${humanize(record.reason).toLowerCase()})`;
}

export function screenshotLocation(record: ScreenshotRecord): string {
  return [record.app?.name ?? record.app?.bundleId, record.domain].filter(Boolean).join(" / ");
}
