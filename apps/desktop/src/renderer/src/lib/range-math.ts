/** Pure helpers for the teach-flow range editor. All timestamps are ms. */

export interface TimeRange {
  startTs: number;
  endTs: number;
}

export type HandleKind = "start" | "end";

export const DEFAULT_MIN_SPAN_MS = 5_000;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Position of ts inside bounds as a fraction 0..1 (clamped). */
export function tsToFraction(ts: number, bounds: TimeRange): number {
  const span = bounds.endTs - bounds.startTs;
  if (span <= 0) return 0;
  return clamp((ts - bounds.startTs) / span, 0, 1);
}

export function fractionToTs(fraction: number, bounds: TimeRange): number {
  const span = bounds.endTs - bounds.startTs;
  return Math.round(bounds.startTs + clamp(fraction, 0, 1) * span);
}

/** Keeps the range inside bounds and at least minSpan wide, preferring to move the requested handle. */
export function clampRange(range: TimeRange, bounds: TimeRange, minSpan = DEFAULT_MIN_SPAN_MS): TimeRange {
  const span = Math.max(0, bounds.endTs - bounds.startTs);
  const effectiveMin = Math.min(minSpan, span);
  let startTs = clamp(range.startTs, bounds.startTs, bounds.endTs);
  let endTs = clamp(range.endTs, bounds.startTs, bounds.endTs);
  if (endTs - startTs < effectiveMin) {
    endTs = Math.min(bounds.endTs, startTs + effectiveMin);
    startTs = Math.max(bounds.startTs, endTs - effectiveMin);
  }
  return { startTs, endTs };
}

/** Sets one handle to an absolute timestamp, pushing nothing but clamping to the other handle. */
export function setHandle(range: TimeRange, which: HandleKind, ts: number, bounds: TimeRange, minSpan = DEFAULT_MIN_SPAN_MS): TimeRange {
  if (which === "start") {
    const startTs = clamp(ts, bounds.startTs, range.endTs - minSpan);
    return clampRange({ startTs, endTs: range.endTs }, bounds, minSpan);
  }
  const endTs = clamp(ts, range.startTs + minSpan, bounds.endTs);
  return clampRange({ startTs: range.startTs, endTs }, bounds, minSpan);
}

export function moveHandle(range: TimeRange, which: HandleKind, deltaMs: number, bounds: TimeRange, minSpan = DEFAULT_MIN_SPAN_MS): TimeRange {
  const current = which === "start" ? range.startTs : range.endTs;
  return setHandle(range, which, current + deltaMs, bounds, minSpan);
}

/** Keyboard step: 1% of the span (10% with the coarse modifier), never below one second. */
export function keyboardStepMs(bounds: TimeRange, coarse = false): number {
  const span = Math.max(0, bounds.endTs - bounds.startTs);
  const fraction = coarse ? 0.1 : 0.01;
  return Math.max(1_000, Math.round(span * fraction));
}

export interface TimedItem {
  id: string;
  ts: number;
}

/** Items inside the range (inclusive) that are not excluded. */
export function includedItems<T extends TimedItem>(items: readonly T[], range: TimeRange, excludedIds: ReadonlySet<string> | readonly string[] = []): T[] {
  const excluded = excludedIds instanceof Set ? excludedIds : new Set(excludedIds);
  return items.filter((item) => item.ts >= range.startTs && item.ts <= range.endTs && !excluded.has(item.id));
}

/** Timestamp of the item closest to ts, or null when the list is empty. */
export function nearestItemTs(items: readonly TimedItem[], ts: number): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const distance = Math.abs(item.ts - ts);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item.ts;
    }
  }
  return best;
}

/** Converts a pointer x position over a track into a timestamp. */
export function pointerToTs(clientX: number, trackLeft: number, trackWidth: number, bounds: TimeRange): number {
  if (trackWidth <= 0) return bounds.startTs;
  return fractionToTs((clientX - trackLeft) / trackWidth, bounds);
}
