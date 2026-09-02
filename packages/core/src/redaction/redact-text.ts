import { stripPersonNames } from "../normalize/names.js";

export type RedactionCategory =
  | "url_query"
  | "email"
  | "uuid"
  | "iban"
  | "card"
  | "ssn"
  | "phone"
  | "numeric_id"
  | "person_name";

export interface RedactionResult {
  readonly text: string;
  readonly removed: readonly RedactionCategory[];
}

interface Rule {
  readonly category: RedactionCategory;
  readonly pattern: RegExp;
  readonly replacement: string;
}

const URL_WITH_QUERY_RE = /(https?:\/\/[^\s?#]+)(\?[^\s#]*)?(#\S*)?/g;

/** Ordered: specific patterns first so later, broader ones do not swallow them. */
const RULES: readonly Rule[] = [
  { category: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: "[email]" },
  {
    category: "uuid",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replacement: "[uuid]"
  },
  { category: "iban", pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, replacement: "[iban]" },
  { category: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[ssn]" },
  { category: "card", pattern: /\b\d(?:[ -]?\d){12,18}\b/g, replacement: "[card]" },
  {
    category: "phone",
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\b\d{2,4})[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g,
    replacement: "[phone]"
  },
  { category: "numeric_id", pattern: /\b\d{5,}\b/g, replacement: "[id]" }
];

function applyRule(text: string, rule: Rule): { text: string; hit: boolean } {
  let hit = false;
  const replaced = text.replace(rule.pattern, () => {
    hit = true;
    return rule.replacement;
  });
  return { text: replaced, hit };
}

function stripUrlQueries(text: string): { text: string; hit: boolean } {
  let hit = false;
  const replaced = text.replace(URL_WITH_QUERY_RE, (_match: string, base: string, query?: string, fragment?: string) => {
    if ((query !== undefined && query.length > 0) || (fragment !== undefined && fragment.length > 0)) hit = true;
    return base;
  });
  return { text: replaced, hit };
}

/** Masks PII and volatile identifiers. `removed` lists the categories that matched. */
export function redactText(input: string): RedactionResult {
  const removed: RedactionCategory[] = [];
  const urls = stripUrlQueries(input);
  if (urls.hit) removed.push("url_query");
  let text = urls.text;
  for (const rule of RULES) {
    const result = applyRule(text, rule);
    text = result.text;
    if (result.hit) removed.push(rule.category);
  }
  const names = stripPersonNames(text);
  if (names.count > 0) removed.push("person_name");
  return { text: names.text, removed };
}
