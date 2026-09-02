import type { CompletionPredicate, VerificationMethod } from "@apprentice/schemas";
import { sha256Hex } from "../ids.js";

export interface ScreenState {
  readonly url?: string;
  readonly domain?: string;
  readonly path?: string;
  readonly windowTitle?: string;
  readonly ocrText?: string;
  readonly frontmostBundleId?: string;
  readonly domMarkers?: readonly string[];
  readonly userConfirmed?: boolean;
}

export interface PredicateEvaluation {
  readonly complete: boolean;
  readonly satisfied: readonly string[];
  readonly method: VerificationMethod;
}

const METHOD_BY_KIND: Readonly<Record<CompletionPredicate["kind"], VerificationMethod>> = {
  dom_marker: "extension_dom",
  url_pattern: "extension_dom",
  title_contains: "accessibility",
  app_frontmost: "app_metadata",
  ocr_contains: "screen_diff_ocr",
  user_confirm: "user_confirmation"
};

const METHOD_PRIORITY: readonly VerificationMethod[] = [
  "extension_dom", "accessibility", "app_metadata", "screen_diff_ocr", "model_supporting", "user_confirmation", "none"
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Glob-like URL pattern: "*" matches anything, ":id" matches one path segment. */
export function urlPatternToRegExp(pattern: string): RegExp {
  const escaped = escapeRegExp(pattern.toLowerCase()).replace(/\\\*/g, ".*").replace(/:id/g, "[^/]+");
  return new RegExp(`^(?:https?://)?${escaped}/?$`);
}

function currentUrl(state: ScreenState): string | undefined {
  if (state.url !== undefined) return state.url.toLowerCase().split(/[?#]/)[0];
  if (state.domain !== undefined) return `${state.domain}${state.path ?? "/"}`.toLowerCase();
  return undefined;
}

export function predicateKey(predicate: CompletionPredicate): string {
  switch (predicate.kind) {
    case "url_pattern": return `url_pattern:${predicate.pattern}`;
    case "title_contains": return `title_contains:${predicate.text}`;
    case "ocr_contains": return `ocr_contains:${predicate.text}`;
    case "app_frontmost": return `app_frontmost:${predicate.bundleId}`;
    case "dom_marker": return `dom_marker:${predicate.marker}`;
    case "user_confirm": return "user_confirm";
  }
}

export function predicateHolds(predicate: CompletionPredicate, state: ScreenState): boolean {
  switch (predicate.kind) {
    case "url_pattern": {
      const url = currentUrl(state);
      return url !== undefined && urlPatternToRegExp(predicate.pattern).test(url);
    }
    case "title_contains":
      return state.windowTitle !== undefined && state.windowTitle.toLowerCase().includes(predicate.text.toLowerCase());
    case "ocr_contains":
      return state.ocrText !== undefined && state.ocrText.toLowerCase().includes(predicate.text.toLowerCase());
    case "app_frontmost":
      return state.frontmostBundleId !== undefined && state.frontmostBundleId.toLowerCase() === predicate.bundleId.toLowerCase();
    case "dom_marker":
      return (state.domMarkers ?? []).includes(predicate.marker);
    case "user_confirm":
      return state.userConfirmed === true;
  }
}

/** Any satisfied predicate completes the subtask; the method is the strongest satisfied source. */
export function evaluateCompletionPredicates(predicates: readonly CompletionPredicate[], state: ScreenState): PredicateEvaluation {
  const satisfiedPredicates = predicates.filter((predicate) => predicateHolds(predicate, state));
  const methods = satisfiedPredicates.map((predicate) => METHOD_BY_KIND[predicate.kind]);
  const method = METHOD_PRIORITY.find((candidate) => methods.includes(candidate)) ?? "none";
  return { complete: satisfiedPredicates.length > 0, satisfied: satisfiedPredicates.map(predicateKey), method };
}

export interface StateHashInput {
  readonly ocrText?: string;
  readonly windowTitle?: string;
  readonly url?: string;
  readonly screenshotHash?: string;
}

export function stateHash(input: StateHashInput): string {
  const normalized = [
    (input.ocrText ?? "").replace(/\s+/g, " ").trim().toLowerCase(),
    (input.windowTitle ?? "").trim().toLowerCase(),
    (input.url ?? "").trim().toLowerCase(),
    (input.screenshotHash ?? "").toLowerCase()
  ].join(" ");
  return sha256Hex(normalized);
}
