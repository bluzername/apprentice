/**
 * Shape-based detection of secrets inside text the model wants to type.
 *
 * Typed content is classified here rather than through the button-label
 * dictionaries: a note containing "password", "admin" or "delete" is ordinary
 * text, while an API key or a card number is not. Only the KIND of match is
 * ever returned - the matched value never leaves this module, so a secret can
 * never reach a risk reason, a log line, or the feedback payload.
 */

/** Kinds of credential shape this module recognizes. */
export type CredentialShape = "api_key_prefix" | "payment_card_number" | "high_entropy_token";

/** Longest input examined; typed text is bounded elsewhere, this is a hard stop. */
const MAX_SCANNED_CHARS = 4000;

/** Vendor key prefixes that are unambiguous on their own. */
const API_KEY_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[A-Za-z0-9_-]{35}\b/,
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/
];

const MIN_TOKEN_LENGTH = 20;
const MIN_ENTROPY_BITS_PER_CHAR = 3.0;
const MIN_CARD_DIGITS = 13;
const MAX_CARD_DIGITS = 19;

/** Shannon entropy of a string in bits per character. */
export function shannonEntropyPerChar(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Standard Luhn checksum over a digit string. */
export function isLuhnValid(digits: string): boolean {
  if (digits.length < MIN_CARD_DIGITS || digits.length > MAX_CARD_DIGITS) return false;
  if (!/^[0-9]+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** A digit run of card length that passes Luhn, allowing spaces and hyphens between groups. */
function hasCardNumber(text: string): boolean {
  const runs = text.match(/[0-9](?:[ -]?[0-9]){12,18}/g) ?? [];
  return runs.some((run) => isLuhnValid(run.replace(/[ -]/g, "")));
}

/** A long opaque token: mixed character classes and high per-character entropy. */
function hasHighEntropyToken(text: string): boolean {
  const tokens = text.split(/[\s"'<>(){}[\],;]+/).filter((token) => token.length >= MIN_TOKEN_LENGTH);
  return tokens.some((token) => {
    if (!/^[A-Za-z0-9_\-+/=.:]+$/.test(token)) return false;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((pattern) => pattern.test(token)).length;
    if (classes < 3) return false;
    // Prose never reaches this shape: "Follow-up-notes-for-the-manager" has too few classes,
    // and a sentence fragment of this length has too little entropy per character.
    return shannonEntropyPerChar(token) >= MIN_ENTROPY_BITS_PER_CHAR;
  });
}

/**
 * Credential shapes found in `text`, in a stable order. Returns an empty array
 * for ordinary prose. The matched substrings are deliberately not returned.
 */
export function detectCredentialShapes(text: string): readonly CredentialShape[] {
  const scanned = text.slice(0, MAX_SCANNED_CHARS);
  const shapes: CredentialShape[] = [];
  if (API_KEY_PATTERNS.some((pattern) => pattern.test(scanned))) shapes.push("api_key_prefix");
  if (hasCardNumber(scanned)) shapes.push("payment_card_number");
  if (hasHighEntropyToken(scanned)) shapes.push("high_entropy_token");
  return shapes;
}
