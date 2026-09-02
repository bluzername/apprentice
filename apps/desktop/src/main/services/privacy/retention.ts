import { computeRetentionPlan, deleteTodayPlan, type RetentionInventory, type RetentionPlan } from "@apprentice/core";
import type { RetentionSettings } from "@apprentice/schemas";
import type { StorageRef } from "../app-context.js";
import { readProtectedScreenshotIds } from "../teach/teach-service.js";

export interface RetentionOutcome {
  readonly deletedScreenshots: number;
  readonly deletedOcr: number;
  readonly deletedEvents: number;
}

/** Event ids referenced by any skill's evidence episodes (never expired by retention). */
export function protectedEventIds(storage: StorageRef): Set<string> {
  const current = storage.current;
  const episodeIds = [...current.skills.evidenceEpisodeIds()];
  const episodes = current.episodes.byIds(episodeIds);
  return new Set(episodes.flatMap((episode) => episode.eventIds));
}

export function buildInventory(storage: StorageRef, options: { excludeSessionIds?: ReadonlySet<string> } = {}): RetentionInventory {
  const current = storage.current;
  const exclude = options.excludeSessionIds ?? new Set<string>();
  const screenshotRows = current.db.all<{ id: string; ts: number; analyzed: number; session_id: string }>("SELECT id, ts, analyzed, session_id FROM screenshots");
  const eventRows = current.db.all<{ id: string; ts: number; type: string; session_id: string }>("SELECT id, ts, type, session_id FROM events");
  const excludedScreenshots = new Set(screenshotRows.filter((row) => exclude.has(row.session_id)).map((row) => row.id));
  const ocrRows = current.db.all<{ id: string; ts: number; screenshot_id: string }>("SELECT id, ts, screenshot_id FROM ocr");
  return {
    screenshots: screenshotRows.filter((row) => !exclude.has(row.session_id)).map((row) => ({ id: row.id, ts: row.ts, analyzed: row.analyzed === 1 })),
    ocr: ocrRows.filter((row) => !excludedScreenshots.has(row.screenshot_id)).map((row) => ({ id: row.id, ts: row.ts })),
    events: eventRows.filter((row) => !exclude.has(row.session_id)).map((row) => ({ id: row.id, ts: row.ts, type: row.type })),
    skillsProtectEventIds: protectedEventIds(storage)
  };
}

export function applyPlan(storage: StorageRef, plan: RetentionPlan): RetentionOutcome {
  const current = storage.current;
  for (const id of plan.screenshotIds) current.blobs.delete(id);
  const deletedScreenshots = current.screenshots.deleteByIds(plan.screenshotIds);
  const deletedOcr = current.screenshots.deleteOcrByIds(plan.ocrIds);
  const deletedEvents = current.events.deleteByIds(plan.eventIds);
  return { deletedScreenshots, deletedOcr, deletedEvents };
}

/** Retention pass: screenshots by hours, OCR by days, events by days; skill evidence and taught screenshots are kept. */
export function runRetention(storage: StorageRef, settings: RetentionSettings, now: number, options: { excludeSessionIds?: ReadonlySet<string> } = {}): RetentionOutcome {
  const inventory = buildInventory(storage, options);
  const plan = computeRetentionPlan(now, settings, inventory);
  const protectedShots = readProtectedScreenshotIds(storage);
  return applyPlan(storage, { ...plan, screenshotIds: plan.screenshotIds.filter((id) => !protectedShots.has(id)) });
}

export function runDeleteToday(storage: StorageRef, now: number): RetentionOutcome {
  const inventory = buildInventory(storage);
  const plan = deleteTodayPlan(now, inventory, { timezoneOffsetMinutes: -new Date(now).getTimezoneOffset() });
  return applyPlan(storage, plan);
}
