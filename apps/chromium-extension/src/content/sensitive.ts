/** Sensitive-context detection. Any hit pauses capture until the next path change. */
import type { ExtensionEvent } from "@apprentice/schemas";

export type SensitiveReason = NonNullable<ExtensionEvent["sensitiveReason"]>;

export const SENSITIVE_PAGE_PATTERN = /login|sign[- ]?in|password|checkout|payment|billing|2fa|verify/i;
export const SENSITIVE_META_NAME = "apprentice-sensitive";

export interface FieldSignals {
  readonly tagName: string;
  readonly type: string | null;
  readonly autocomplete: string | null;
}

export interface PageSignals {
  readonly title: string;
  readonly path: string;
  readonly hasSensitiveMeta: boolean;
}

/** Password inputs, payment-card autocomplete tokens, and one-time codes are always sensitive. */
export function isSensitiveField(field: FieldSignals): boolean {
  const tag = field.tagName.toLowerCase();
  const type = (field.type ?? "").toLowerCase();
  const autocomplete = (field.autocomplete ?? "").toLowerCase().trim();
  if (tag === "input" && type === "password") {
    return true;
  }
  if (tag !== "input" && tag !== "textarea" && tag !== "select") {
    return false;
  }
  return autocomplete.split(/\s+/).some((token) => token.startsWith("cc-") || token === "one-time-code");
}

export function isSensitivePage(page: PageSignals): boolean {
  if (page.hasSensitiveMeta) {
    return true;
  }
  return SENSITIVE_PAGE_PATTERN.test(page.title) || SENSITIVE_PAGE_PATTERN.test(page.path);
}

export function sensitiveFieldReason(field: FieldSignals): SensitiveReason | null {
  return isSensitiveField(field) ? "password_field" : null;
}

export function sensitivePageReason(page: PageSignals): SensitiveReason | null {
  return isSensitivePage(page) ? "sensitive_page" : null;
}
