import { stripPersonNames } from "./names.js";

export const MAX_LABEL_LENGTH = 40;

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const CSS_CLASS_RE = /\b(?:css|sc|jss|mui|emotion|chakra|tw|svelte|ng|v)-[a-z0-9_-]+\b/g;
/** Hash-like tokens: 8+ alphanumerics with at least three digits and three letters. */
const HASH_LIKE_RE = /\b(?=(?:[a-z]*\d){3})(?=(?:\d*[a-z]){3})[a-z0-9]{8,}\b/g;
const DIGIT_RUN_RE = /\d{4,}/g;

function kebab(text: string): string {
  return text
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Lowercase, de-identified, kebab-cased label bounded to 40 chars. */
export function normalizeLabel(text: string): string {
  const withoutNames = stripPersonNames(text, " ").text;
  const lowered = withoutNames
    .replace(EMAIL_RE, " ")
    .toLowerCase()
    .replace(CSS_CLASS_RE, " ")
    .replace(HASH_LIKE_RE, " ")
    .replace(DIGIT_RUN_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const truncated = lowered.length > MAX_LABEL_LENGTH ? lowered.slice(0, MAX_LABEL_LENGTH) : lowered;
  return kebab(truncated);
}
