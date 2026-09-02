import type { Rect } from "@apprentice/schemas";
import type { TemplateName } from "../types.js";

/** Small per-render overrides accepted by every screen template. */
export interface TemplateVariant {
  readonly title?: string;
  readonly primaryLabel?: string;
  /** When set, an orange ring is drawn around this rect (used to show the next action). */
  readonly highlight?: Rect;
}

export interface ScreenTemplate {
  readonly name: TemplateName;
  readonly primaryLabel: string;
  /** Rect of the primary action button in the default render. */
  readonly primaryButton: Rect;
  readonly render: (variant?: TemplateVariant) => string;
}

export interface ResolvedVariant {
  readonly title: string;
  readonly primaryLabel: string;
  readonly highlight: Rect | undefined;
}

export function resolveVariant(
  variant: TemplateVariant | undefined,
  defaults: { readonly title: string; readonly primaryLabel: string }
): ResolvedVariant {
  return {
    title: variant?.title ?? defaults.title,
    primaryLabel: variant?.primaryLabel ?? defaults.primaryLabel,
    highlight: variant?.highlight
  };
}

export function centre(r: Rect): { readonly x: number; readonly y: number } {
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}
