import { humanizeToken } from "../humanize.js";
import { parseToken, tokenContext } from "../normalize/token.js";

const MAX_TITLE = 160;

function outcomeLabel(token: string): string {
  const parts = parseToken(token);
  if (parts["action"] === "click" && parts["name"] !== undefined) {
    return parts["name"].replace(/-+/g, " ");
  }
  if (parts["action"] === "form-submit") {
    const purpose = parts["purpose"];
    return purpose !== undefined && purpose !== "unknown" ? `${purpose} form submit` : "form submit";
  }
  return humanizeToken(token).toLowerCase();
}

/** Deterministic, readable title from the first meaningful token and the last outcome token. */
export function deterministicTitle(triggerToken: string | undefined, outcomeToken: string | undefined): string {
  if (outcomeToken === undefined && triggerToken === undefined) return "Repeated workflow";
  const outcome = outcomeToken ?? triggerToken!;
  const outcomeContext = tokenContext(outcome) ?? "your apps";
  const triggerContext = triggerToken !== undefined ? tokenContext(triggerToken) : undefined;
  const base = `${outcomeContext}: ${outcomeLabel(outcome)}`;
  const withTrigger = triggerContext !== undefined && triggerContext !== outcomeContext ? `${base} after ${triggerContext}` : base;
  const capitalized = withTrigger[0]!.toUpperCase() + withTrigger.slice(1);
  return capitalized.slice(0, MAX_TITLE);
}
