import { DEFAULT_DENY_APP_BUNDLE_PATTERNS, DEFAULT_DENY_DOMAIN_PATTERNS, type ActivityEvent } from "@apprentice/schemas";
import { isAppDenied, isDomainDenied } from "../allowlist/index.js";
import { SECURE_AX_ROLES, SENSITIVE_DICTIONARIES, SIGN_IN_TERMS } from "./dictionaries.js";

export { SENSITIVE_DICTIONARIES, SIGN_IN_TERMS, SECURE_AX_ROLES } from "./dictionaries.js";

export interface SensitiveContextInput {
  readonly ocrText?: string;
  readonly windowTitle?: string;
  readonly axRole?: string;
  readonly domain?: string;
  readonly bundleId?: string;
  readonly secureFieldFocused?: boolean;
}

export interface SensitiveContextResult {
  readonly sensitive: boolean;
  readonly reasons: readonly string[];
}

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term: string): RegExp {
  const flexible = escapeRegExp(term.toLowerCase()).replace(/[\s_-]+/g, "[\\s_-]*");
  return new RegExp(`(^|[^a-z0-9])${flexible}($|[^a-z0-9])`, "i");
}

export function containsTerm(text: string, terms: readonly string[]): string | undefined {
  const lowered = text.toLowerCase();
  return terms.find((term) => termPattern(term).test(lowered));
}

function dictionaryReasons(text: string, prefix: string): readonly string[] {
  return SENSITIVE_DICTIONARIES.filter((dictionary) => containsTerm(text, dictionary.terms) !== undefined).map(
    (dictionary) => `${prefix}:${dictionary.reason}`
  );
}

/** Deterministic detection of contexts where nothing may be captured or acted on. */
export function detectSensitiveContext(input: SensitiveContextInput): SensitiveContextResult {
  const reasons: string[] = [];
  if (input.secureFieldFocused === true) reasons.push("secure_field_focused");
  if (input.axRole !== undefined && SECURE_AX_ROLES.includes(input.axRole.toLowerCase())) {
    reasons.push("secure_field_role");
  }
  if (input.bundleId !== undefined && isAppDenied(input.bundleId, DEFAULT_DENY_APP_BUNDLE_PATTERNS)) {
    reasons.push("denied_app");
  }
  if (input.domain !== undefined && isDomainDenied(input.domain, DEFAULT_DENY_DOMAIN_PATTERNS)) {
    reasons.push("denied_domain");
  }
  if (input.windowTitle !== undefined) {
    reasons.push(...dictionaryReasons(input.windowTitle, "title"));
    if (containsTerm(input.windowTitle, SIGN_IN_TERMS) !== undefined) reasons.push("title:sign_in");
  }
  if (input.ocrText !== undefined) reasons.push(...dictionaryReasons(input.ocrText, "ocr"));
  return { sensitive: reasons.length > 0, reasons };
}

export function isSensitiveEvent(event: ActivityEvent): boolean {
  if (event.privacy === "sensitive") return true;
  if (event.type === "secure_field_focused") return true;
  return event.payload?.["sensitive"] === true;
}

export function episodeHasSensitiveEvents(events: readonly ActivityEvent[]): boolean {
  return events.some((event) => isSensitiveEvent(event));
}
