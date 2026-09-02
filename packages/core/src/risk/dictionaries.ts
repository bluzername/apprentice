import type { RiskClass } from "@apprentice/schemas";

export const EXTERNAL_COMMUNICATION: readonly string[] = [
  "send", "reply", "reply all", "forward", "post", "publish", "share", "invite", "message", "email",
  "tweet", "broadcast", "submit application", "send invoice", "send email", "send message", "notify",
  "announce", "dm", "chat"
];

export const DESTRUCTIVE: readonly string[] = [
  "delete", "remove", "discard", "erase", "clear all", "uninstall", "revoke", "reset", "format",
  "empty trash", "permanently", "destroy", "purge", "wipe", "drop", "unsubscribe all", "delete forever"
];

export const FINANCIAL_OR_ACCESS: readonly string[] = [
  "buy", "purchase", "pay", "pay now", "checkout", "check out", "transfer", "withdraw", "deposit", "authorize",
  "subscribe", "upgrade plan", "billing", "card number", "password", "sign in", "log in", "login",
  "sign up", "two-factor", "verification code", "permissions", "grant access", "admin", "api key",
  "token", "wallet", "place order", "confirm payment", "add payment method", "credit card"
];

export const INTERNAL_MUTATION: readonly string[] = [
  "save", "create", "add", "update", "edit", "rename", "move", "archive", "assign", "mark complete",
  "log activity", "change status", "save draft", "apply", "insert", "attach", "upload", "duplicate",
  "complete", "done", "new", "record", "tag", "label", "pin", "star", "snooze", "schedule", "approve",
  "reject", "accept", "decline", "confirm", "submit", "sign", "log call", "log note"
];

export const NAVIGATION: readonly string[] = [
  "open", "go to", "back", "next", "tab", "menu", "expand", "view", "close", "previous", "home",
  "dashboard", "settings", "search", "filter", "sort", "show", "hide", "collapse", "scroll", "more",
  "details", "overview", "refresh", "reload", "switch", "select", "cancel", "dismiss"
];

export interface RiskDictionary {
  readonly riskClass: RiskClass;
  readonly terms: readonly string[];
}

/** Ordered by severity, highest first. */
export const RISK_DICTIONARIES: readonly RiskDictionary[] = [
  { riskClass: "financial_or_access", terms: FINANCIAL_OR_ACCESS },
  { riskClass: "destructive", terms: DESTRUCTIVE },
  { riskClass: "external_communication", terms: EXTERNAL_COMMUNICATION },
  { riskClass: "internal_mutation", terms: INTERNAL_MUTATION },
  { riskClass: "reversible_navigation", terms: NAVIGATION }
];

const RISK_RANK: Readonly<Record<RiskClass, number>> = {
  read_only: 0,
  reversible_navigation: 1,
  internal_mutation: 2,
  unknown: 3,
  external_communication: 4,
  destructive: 5,
  financial_or_access: 6,
  sensitive_context: 7
};

export function riskClassRank(riskClass: RiskClass): number {
  return RISK_RANK[riskClass];
}

export function maxRiskClass(classes: readonly RiskClass[]): RiskClass {
  return classes.reduce<RiskClass>(
    (highest, current) => (riskClassRank(current) > riskClassRank(highest) ? current : highest),
    "read_only"
  );
}

export const LOW_RISK_CLASSES: ReadonlySet<RiskClass> = new Set(["read_only", "reversible_navigation", "internal_mutation"]);
