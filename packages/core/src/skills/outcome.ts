import { CLOSING_SHORTCUTS, OUTCOME_CLICK_TERMS, OUTCOME_SHORTCUTS } from "../episodes/boundaries.js";
import { parseToken } from "../normalize/token.js";

/** Strong outcome tokens: form submits, downloads, save/send shortcuts, clicks on outcome-named controls. */
export function isOutcomeToken(token: string): boolean {
  const parts = parseToken(token);
  switch (parts["action"]) {
    case "form-submit":
    case "download":
      return true;
    case "shortcut":
      return parts["keys"] !== undefined && OUTCOME_SHORTCUTS.has(parts["keys"]);
    case "click": {
      const name = parts["name"];
      if (name === undefined) return false;
      const words = name.split("-");
      return OUTCOME_CLICK_TERMS.some((term) => words.includes(term));
    }
    default:
      return false;
  }
}

/** Closing tokens (close, quit, escape) wrap up finished work and never describe its goal. */
export function isClosingToken(token: string): boolean {
  const parts = parseToken(token);
  return parts["action"] === "shortcut" && parts["keys"] !== undefined && CLOSING_SHORTCUTS.has(parts["keys"]);
}

function findLast<T>(entries: readonly T[], predicate: (entry: T) => boolean): T | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (predicate(entry)) return entry;
  }
  return undefined;
}

/** The last strong outcome in a sequence, if any. */
export function outcomeEntry<T extends { readonly token: string }>(entries: readonly T[]): T | undefined {
  return findLast(entries, (entry) => isOutcomeToken(entry.token));
}

/**
 * The entry that best describes what a sequence achieved: the last strong outcome,
 * else the last step that is not a closing action, else the last step.
 */
export function anchorEntry<T extends { readonly token: string }>(entries: readonly T[]): T {
  const last = entries[entries.length - 1];
  if (last === undefined) throw new Error("anchorEntry: no entries");
  return outcomeEntry(entries) ?? findLast(entries, (entry) => !isClosingToken(entry.token)) ?? last;
}
