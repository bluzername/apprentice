import type { RiskClass } from "@apprentice/schemas";
import { parseToken } from "../normalize/token.js";
import { maxRiskClass } from "./dictionaries.js";
import { classifyText } from "./match.js";

const NAVIGATION_ROLES: ReadonlySet<string> = new Set(["link", "tab", "menuitem", "menu-item", "menu", "treeitem", "a"]);
const SEND_SHORTCUTS: ReadonlySet<string> = new Set(["cmd+enter", "cmd+return", "cmd+shift+enter"]);
const DESTRUCTIVE_SHORTCUTS: ReadonlySet<string> = new Set(["cmd+delete", "cmd+backspace", "cmd+shift+delete"]);
const MUTATION_SHORTCUTS: ReadonlySet<string> = new Set(["cmd+s", "cmd+v", "cmd+z", "cmd+shift+z", "cmd+x", "cmd+n", "cmd+shift+s"]);

const FORM_PURPOSE_RISK: Readonly<Record<string, RiskClass>> = {
  message: "external_communication",
  checkout: "financial_or_access",
  login: "financial_or_access",
  search: "read_only",
  create: "internal_mutation",
  update: "internal_mutation",
  upload: "internal_mutation"
};

function shortcutRisk(keys: string | undefined): RiskClass {
  if (keys === undefined) return "unknown";
  if (SEND_SHORTCUTS.has(keys)) return "external_communication";
  if (DESTRUCTIVE_SHORTCUTS.has(keys)) return "destructive";
  if (MUTATION_SHORTCUTS.has(keys)) return "internal_mutation";
  if (keys === "cmd+c" || keys === "cmd+a" || keys === "cmd+f") return "read_only";
  return "reversible_navigation";
}

/** Deterministic risk class for one normalized action token. */
export function tokenRiskClass(token: string): RiskClass {
  const parts = parseToken(token);
  const action = parts["action"];
  const labelText = [parts["name"], parts["purpose"], parts["field"]].filter((part) => part !== undefined).join(" ");
  switch (action) {
    case "navigate":
    case "activate":
    case "view":
      return "reversible_navigation";
    case "copy":
    case "download":
      return "read_only";
    case "paste":
    case "field-input":
      return "internal_mutation";
    case "shortcut":
      return shortcutRisk(parts["keys"]);
    case "form-submit": {
      const byPurpose = FORM_PURPOSE_RISK[parts["purpose"] ?? ""];
      if (byPurpose !== undefined) return byPurpose;
      const text = classifyText(labelText);
      return text.riskClass === "unknown" ? "internal_mutation" : text.riskClass;
    }
    case "click": {
      const text = classifyText(labelText);
      if (text.riskClass !== "unknown") return text.riskClass;
      const role = parts["role"];
      return role !== undefined && NAVIGATION_ROLES.has(role) ? "reversible_navigation" : "unknown";
    }
    default:
      return "unknown";
  }
}

/** Highest matched risk class across a token sequence; "unknown" only when nothing matched at all. */
export function candidateRiskClass(tokens: readonly string[]): RiskClass {
  const classes = tokens.map((token) => tokenRiskClass(token));
  const matched = classes.filter((riskClass) => riskClass !== "unknown");
  if (matched.length === 0) return "unknown";
  return maxRiskClass(matched);
}
