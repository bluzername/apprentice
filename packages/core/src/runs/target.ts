import type { AxElement, ImageTransform, OcrBlock, Point } from "@apprentice/schemas";
import { distanceToRect, mapImageToDisplay } from "../geometry/index.js";
import { foreignHitBundleId } from "./validate.js";

export interface ResolveTargetInput {
  readonly point: Point;
  readonly ocrBlocks?: readonly OcrBlock[];
  readonly axElement?: AxElement | null;
  /** When provided, the ax element bounds (display points) are compared against the mapped point. */
  readonly transform?: ImageTransform;
  readonly maxDistancePx?: number;
  readonly ambiguityMarginPx?: number;
  /** Bundle id of the app the run acts on. */
  readonly targetBundleId?: string;
  /** Bundle id of the app owning `axElement`; an element of another app (or of Apprentice) never labels the target. */
  readonly hitBundleId?: string;
}

export interface ResolvedTarget {
  readonly source: "ocr" | "accessibility" | "coordinates_only";
  readonly label?: string;
  readonly role?: string;
  readonly distancePx?: number;
  readonly ambiguous: boolean;
  readonly candidates: readonly string[];
  /** Set when the accessibility hit belongs to an app other than the target (or to Apprentice itself). */
  readonly foreignBundleId?: string;
}

export const DEFAULT_TARGET_MAX_DISTANCE_PX = 40;
export const DEFAULT_AMBIGUITY_MARGIN_PX = 4;

/** Resolves the nearest OCR text or accessibility label for a proposed point and flags ambiguity. */
export function resolveTarget(input: ResolveTargetInput): ResolvedTarget {
  const maxDistance = input.maxDistancePx ?? DEFAULT_TARGET_MAX_DISTANCE_PX;
  const margin = input.ambiguityMarginPx ?? DEFAULT_AMBIGUITY_MARGIN_PX;
  const ranked = (input.ocrBlocks ?? [])
    .filter((block) => block.text.trim().length > 0)
    .map((block) => ({ block, distance: distanceToRect(input.point, block) }))
    .filter((entry) => entry.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || a.block.text.localeCompare(b.block.text));
  const nearest = ranked[0];
  if (nearest !== undefined) {
    const label = nearest.block.text.trim().slice(0, 160);
    const rivals = ranked
      .slice(1)
      .filter((entry) => entry.distance - nearest.distance <= margin && entry.block.text.trim() !== nearest.block.text.trim())
      .map((entry) => entry.block.text.trim().slice(0, 160));
    return { source: "ocr", label, distancePx: Math.round(nearest.distance * 100) / 100, ambiguous: rivals.length > 0, candidates: [label, ...rivals] };
  }
  const foreignBundleId = foreignHitBundleId(input);
  if (foreignBundleId !== undefined) return { source: "coordinates_only", ambiguous: false, candidates: [], foreignBundleId };
  const ax = input.axElement;
  if (ax !== undefined && ax !== null) {
    const label = (ax.title ?? ax.description ?? ax.identifier ?? "").trim().slice(0, 160);
    let distance: number | undefined;
    if (ax.bounds !== undefined && input.transform !== undefined) {
      distance = Math.round(distanceToRect(mapImageToDisplay(input.point, input.transform), ax.bounds) * 100) / 100;
      if (distance > maxDistance) return { source: "coordinates_only", ambiguous: false, candidates: [] };
    }
    return { source: "accessibility", label: label.length > 0 ? label : undefined, role: ax.role.slice(0, 64), distancePx: distance, ambiguous: false, candidates: label.length > 0 ? [label] : [] };
  }
  return { source: "coordinates_only", ambiguous: false, candidates: [] };
}
