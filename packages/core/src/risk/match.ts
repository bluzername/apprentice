import type { RiskClass } from "@apprentice/schemas";
import { RISK_DICTIONARIES, maxRiskClass } from "./dictionaries.js";

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const patternCache = new Map<string, RegExp>();

/** Word-bounded phrase match; spaces, hyphens, and underscores are interchangeable. */
export function termPattern(term: string): RegExp {
  const cached = patternCache.get(term);
  if (cached !== undefined) return cached;
  const flexible = escapeRegExp(term.toLowerCase()).replace(/[\s_-]+/g, "[\\s_-]+");
  const pattern = new RegExp(`(?:^|[^a-z0-9])${flexible}(?:$|[^a-z0-9])`, "i");
  patternCache.set(term, pattern);
  return pattern;
}

export function matchTerms(text: string, terms: readonly string[]): readonly string[] {
  const lowered = text.toLowerCase();
  return terms.filter((term) => termPattern(term).test(lowered));
}

export interface TextRiskMatch {
  readonly riskClass: RiskClass;
  readonly matchedTerms: readonly string[];
  readonly matchedClasses: readonly RiskClass[];
}

/** Highest-severity dictionary hit in a label or OCR snippet; "unknown" when nothing matched. */
export function classifyText(text: string): TextRiskMatch {
  const normalized = text.replace(/[|:]/g, " ");
  const hits = RISK_DICTIONARIES.map((dictionary) => ({
    riskClass: dictionary.riskClass,
    terms: matchTerms(normalized, dictionary.terms)
  })).filter((hit) => hit.terms.length > 0);
  if (hits.length === 0) return { riskClass: "unknown", matchedTerms: [], matchedClasses: [] };
  const matchedClasses = hits.map((hit) => hit.riskClass);
  return {
    riskClass: maxRiskClass(matchedClasses),
    matchedTerms: hits.flatMap((hit) => hit.terms),
    matchedClasses
  };
}
