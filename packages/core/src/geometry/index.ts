import type { ImageTransform, Point, Rect } from "@apprentice/schemas";
import { hammingDistance } from "../screenshots/phash.js";

function validateTransform(transform: ImageTransform): void {
  if (transform.resizedWidth <= 0 || transform.resizedHeight <= 0) throw new Error("ImageTransform: resized size must be positive");
  if (transform.originalWidth <= 0 || transform.originalHeight <= 0) throw new Error("ImageTransform: original size must be positive");
  if (transform.displayScale <= 0) throw new Error("ImageTransform: displayScale must be positive");
}

/** Maps a point in resized-image pixels to display points. */
export function mapImageToDisplay(point: Point, transform: ImageTransform): Point {
  validateTransform(transform);
  const scaleX = transform.originalWidth / transform.resizedWidth / transform.displayScale;
  const scaleY = transform.originalHeight / transform.resizedHeight / transform.displayScale;
  return { x: transform.originX + point.x * scaleX, y: transform.originY + point.y * scaleY };
}

/** Maps a point in display points back to resized-image pixels. */
export function mapDisplayToImage(point: Point, transform: ImageTransform): Point {
  validateTransform(transform);
  const scaleX = transform.resizedWidth / transform.originalWidth * transform.displayScale;
  const scaleY = transform.resizedHeight / transform.originalHeight * transform.displayScale;
  return { x: (point.x - transform.originX) * scaleX, y: (point.y - transform.originY) * scaleY };
}

export interface ScreenGeometry {
  readonly bounds: Rect;
  readonly displayScale: number;
  readonly displayId?: string;
}

export const DEFAULT_GEOMETRY_TOLERANCE_PX = 8;

export function geometryMatches(a: ScreenGeometry, b: ScreenGeometry, tolerancePx = DEFAULT_GEOMETRY_TOLERANCE_PX): boolean {
  if (a.displayScale !== b.displayScale) return false;
  if (a.displayId !== undefined && b.displayId !== undefined && a.displayId !== b.displayId) return false;
  const within = (x: number, y: number): boolean => Math.abs(x - y) <= tolerancePx;
  return (
    within(a.bounds.x, b.bounds.x) &&
    within(a.bounds.y, b.bounds.y) &&
    within(a.bounds.width, b.bounds.width) &&
    within(a.bounds.height, b.bounds.height)
  );
}

export interface StaleScreenInput {
  readonly capturedAt: number;
  readonly now: number;
  readonly maxAgeMs?: number;
  readonly beforeHash?: string;
  readonly afterHash?: string;
  readonly maxHamming?: number;
}

export interface StaleScreenResult {
  readonly stale: boolean;
  readonly reasons: readonly string[];
}

export const DEFAULT_MAX_SCREEN_AGE_MS = 5000;
export const DEFAULT_MAX_SCREEN_HAMMING = 10;

/** A screen is stale when the screenshot is too old or the content changed materially. */
export function isStaleScreen(input: StaleScreenInput): StaleScreenResult {
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_SCREEN_AGE_MS;
  const maxHamming = input.maxHamming ?? DEFAULT_MAX_SCREEN_HAMMING;
  const reasons: string[] = [];
  const age = input.now - input.capturedAt;
  if (age < 0) reasons.push("captured_in_future");
  if (age > maxAgeMs) reasons.push(`age_exceeded:${age}ms>${maxAgeMs}ms`);
  if (input.beforeHash !== undefined && input.afterHash !== undefined) {
    const distance = hammingDistance(input.beforeHash, input.afterHash);
    if (distance > maxHamming) reasons.push(`content_changed:hamming=${distance}>${maxHamming}`);
  }
  return { stale: reasons.length > 0, reasons };
}

export function clampPointToRect(point: Point, rect: Rect): Point {
  const maxX = rect.x + rect.width;
  const maxY = rect.y + rect.height;
  return { x: Math.min(Math.max(point.x, rect.x), maxX), y: Math.min(Math.max(point.y, rect.y), maxY) };
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/** Euclidean distance from a point to the nearest edge of a rect (0 when inside). */
export function distanceToRect(point: Point, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}
