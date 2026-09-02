import type { RetentionSettings } from "@apprentice/schemas";

export interface RetentionInventory {
  readonly screenshots: ReadonlyArray<{ readonly id: string; readonly ts: number; readonly analyzed: boolean; readonly analyzedAt?: number }>;
  readonly ocr: ReadonlyArray<{ readonly id: string; readonly ts: number }>;
  readonly events: ReadonlyArray<{ readonly id: string; readonly ts: number; readonly type: string }>;
  readonly skillsProtectEventIds: ReadonlySet<string>;
}

export interface RetentionPlan {
  readonly screenshotIds: readonly string[];
  readonly ocrIds: readonly string[];
  readonly eventIds: readonly string[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Screenshots that were never analyzed are still removed after this long. */
export const UNANALYZED_SCREENSHOT_MAX_AGE_MS = 48 * HOUR_MS;

/** Ids to delete under the retention settings. Events referenced by skill evidence are kept. */
export function computeRetentionPlan(now: number, settings: RetentionSettings, inventory: RetentionInventory): RetentionPlan {
  const screenshotMaxAge = settings.screenshotHours * HOUR_MS;
  const screenshotIds = inventory.screenshots
    .filter((shot) => {
      if (shot.analyzed) return now - (shot.analyzedAt ?? shot.ts) > screenshotMaxAge;
      return now - shot.ts > UNANALYZED_SCREENSHOT_MAX_AGE_MS;
    })
    .map((shot) => shot.id);
  const ocrIds = inventory.ocr.filter((entry) => now - entry.ts > settings.ocrDays * DAY_MS).map((entry) => entry.id);
  const eventIds = inventory.events
    .filter((event) => now - event.ts > settings.eventsDays * DAY_MS && !inventory.skillsProtectEventIds.has(event.id))
    .map((event) => event.id);
  return { screenshotIds, ocrIds, eventIds };
}

export interface DeleteTodayOptions {
  /** Minutes east of UTC for the local midnight; defaults to UTC. */
  readonly timezoneOffsetMinutes?: number;
}

export function startOfLocalDay(now: number, timezoneOffsetMinutes = 0): number {
  const shifted = now + timezoneOffsetMinutes * 60_000;
  const dayStart = shifted - (shifted % DAY_MS);
  return dayStart - timezoneOffsetMinutes * 60_000;
}

/** Everything captured since local midnight, including skill-protected events (explicit user intent). */
export function deleteTodayPlan(now: number, inventory: RetentionInventory, options: DeleteTodayOptions = {}): RetentionPlan {
  const start = startOfLocalDay(now, options.timezoneOffsetMinutes ?? 0);
  return {
    screenshotIds: inventory.screenshots.filter((shot) => shot.ts >= start && shot.ts <= now).map((shot) => shot.id),
    ocrIds: inventory.ocr.filter((entry) => entry.ts >= start && entry.ts <= now).map((entry) => entry.id),
    eventIds: inventory.events.filter((event) => event.ts >= start && event.ts <= now).map((event) => event.id)
  };
}
