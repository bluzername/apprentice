import type { VariableSlot } from "@apprentice/schemas";
import { parseToken } from "../normalize/token.js";

const PERSON_ROUTE_PREFIXES: ReadonlySet<string> = new Set(["contact", "contacts", "person", "people", "user", "users", "member", "members", "candidate", "candidates", "lead", "leads", "customer", "customers"]);
const DATE_HINT = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|today|tomorrow|q[1-4]|\d{1,2}-\d{1,2})\b/;
const AMOUNT_HINT = /(\$|usd|eur|gbp|amount|total|price|invoice|\b\d+(\.\d{2})?\b)/;
const PERSON_HINT = /(name|contact|assignee|owner|recipient|person)/;

/** Kind from the sample labels themselves; the surrounding route is deliberately ignored. */
export function guessVariableKind(samples: readonly string[]): VariableSlot["kind"] {
  const joined = samples.join(" ").toLowerCase();
  if (DATE_HINT.test(joined)) return "date";
  if (AMOUNT_HINT.test(joined)) return "amount";
  if (PERSON_HINT.test(joined)) return "person";
  return "text";
}

/** Variable slots for ":id" path segments in the consensus tokens. */
export function routeVariables(tokens: readonly string[]): VariableSlot[] {
  const slots = new Map<string, VariableSlot>();
  for (const token of tokens) {
    const parts = parseToken(token);
    const route = parts["route"];
    if (route === undefined || !route.includes(":id")) continue;
    const segments = route.split("/").filter((segment) => segment.length > 0);
    segments.forEach((segment, index) => {
      if (segment !== ":id") return;
      const prefix = segments[index - 1] ?? "record";
      const name = `${prefix}_id`.replace(/[^a-z0-9_]/g, "_");
      if (slots.has(name)) return;
      slots.set(name, {
        name,
        kind: PERSON_ROUTE_PREFIXES.has(prefix) ? "person" : "identifier",
        description: `Identifier in the ${route} path${parts["domain"] !== undefined ? ` on ${parts["domain"]}` : ""}`,
        examples: [],
        required: true
      });
    });
  }
  return [...slots.values()];
}

/** Variables from labels that differ across occurrences at the same aligned step. */
export function alignedLabelVariables(sequences: ReadonlyArray<readonly string[]>): VariableSlot[] {
  if (sequences.length < 2) return [];
  const minLength = Math.min(...sequences.map((sequence) => sequence.length));
  const slots: VariableSlot[] = [];
  for (let position = 0; position < minLength; position += 1) {
    const parsed = sequences.map((sequence) => parseToken(sequence[position]!));
    const first = parsed[0]!;
    const sameShape = parsed.every(
      (parts) => parts["action"] === first["action"] && (parts["domain"] ?? parts["app"]) === (first["domain"] ?? first["app"])
    );
    if (!sameShape) continue;
    const labels = [...new Set(parsed.map((parts) => parts["name"] ?? parts["field"]).filter((label): label is string => label !== undefined))];
    if (labels.length < 2) continue;
    slots.push({
      name: `step${position + 1}_target`,
      kind: guessVariableKind(labels),
      description: `Target label that changes at step ${position + 1}`,
      examples: labels.slice(0, 6).map((label) => label.slice(0, 120)),
      required: true
    });
  }
  return slots;
}

export function detectVariables(consensusTokens: readonly string[], sequences: ReadonlyArray<readonly string[]>): VariableSlot[] {
  const combined = [...routeVariables(consensusTokens), ...alignedLabelVariables(sequences)];
  const seen = new Set<string>();
  return combined.filter((slot) => {
    if (seen.has(slot.name)) return false;
    seen.add(slot.name);
    return true;
  }).slice(0, 20);
}
