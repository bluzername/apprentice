import {
  DEFAULT_DENY_APP_BUNDLE_PATTERNS,
  DEFAULT_DENY_DOMAIN_PATTERNS,
  type PolicyDecision,
  type ProposedAction,
  type RiskClass,
  type RiskResult,
  type SemanticElement
} from "@apprentice/schemas";
import { isAppDenied, isDomainDenied } from "../allowlist/index.js";
import { detectCredentialShapes } from "./credentials.js";
import { EXTERNAL_COMMUNICATION, riskClassRank } from "./dictionaries.js";
import { classifyText, matchTerms } from "./match.js";

export interface RiskInput {
  readonly action: ProposedAction;
  readonly targetLabel?: string;
  readonly axRole?: string;
  readonly ocrNearTarget?: string;
  readonly browserElement?: SemanticElement;
  readonly bundleId?: string;
  readonly domain?: string;
  readonly sensitive?: { readonly sensitive: boolean; readonly reasons: readonly string[] };
  readonly skillRiskClass?: RiskClass;
}

/** Decision before run-level approvals and policy mode are applied. */
export const BASE_DECISION: Readonly<Record<RiskClass, PolicyDecision>> = {
  read_only: "approve",
  reversible_navigation: "approve",
  internal_mutation: "approve",
  external_communication: "approve",
  destructive: "approve_strong",
  financial_or_access: "unsupported",
  sensitive_context: "abort",
  unknown: "approve"
};

const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  "tab", "escape", "esc", "up", "down", "left", "right", "home", "end", "pageup", "pagedown"
]);
// "q" and "w" are deliberately absent: cmd+q, cmd+shift+w and cmd+w are handled
// as destructive / mutating below, and must never fall through to navigation
// (which a run-scope navigation approval can auto-approve).
const NAVIGATION_HOTKEYS: ReadonlySet<string> = new Set(["t", "l", "f", "tab", "[", "]", "1", "2", "3", "4", "5", "6", "7", "8", "9", "h", "m", "`"]);
/** Shortcuts that end an application, close every window, or force quit. Always approve_strong. */
const DESTRUCTIVE_COMBOS: ReadonlySet<string> = new Set([
  "cmd+delete", "cmd+backspace", "cmd+shift+delete",
  "cmd+q", "cmd+shift+q",
  "cmd+shift+w",
  "alt+cmd+escape", "alt+cmd+esc"
]);
/** Shortcuts that change state but are recoverable. Approval required, never automatic. */
const MUTATION_COMBOS: ReadonlySet<string> = new Set(["cmd+s", "cmd+v", "cmd+z", "cmd+x", "cmd+n", "cmd+w"]);
const READ_ONLY_COMBOS: ReadonlySet<string> = new Set(["cmd+c", "cmd+a", "cmd+f"]);
const SUBMIT_KEYS: ReadonlySet<string> = new Set(["enter", "return"]);
const NAVIGATION_ROLES: ReadonlySet<string> = new Set(["link", "tab", "menuitem", "axlink", "axtab", "axmenuitem", "a"]);

function contextText(input: RiskInput): string {
  const element = input.browserElement;
  return [
    input.targetLabel,
    input.ocrNearTarget,
    element?.name,
    element?.ariaLabel,
    element?.text,
    element?.identifier
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" ");
}

function roleOf(input: RiskInput): string | undefined {
  const role = input.axRole ?? input.browserElement?.role ?? input.browserElement?.tag;
  return role?.toLowerCase();
}

function result(riskClass: RiskClass, reasons: readonly string[], matchedTerms: readonly string[]): RiskResult {
  return {
    riskClass,
    decision: BASE_DECISION[riskClass],
    reasons: reasons.slice(0, 20).map((reason) => reason.slice(0, 256)),
    matchedTerms: [...new Set(matchedTerms)].slice(0, 20).map((term) => term.slice(0, 64)),
    coveredByRunApproval: false
  };
}

function hotkeyCombo(action: ProposedAction): string {
  if (action.type !== "hotkey") return "";
  const modifiers = action.modifiers.map((modifier) => (modifier === "command" ? "cmd" : modifier === "control" ? "ctrl" : modifier === "option" ? "alt" : modifier));
  return `${[...new Set(modifiers)].sort().join("+")}+${action.key}`;
}

function classifyKeyboard(input: RiskInput, text: string): RiskResult {
  const { action } = input;
  const sendTerms = matchTerms(text, EXTERNAL_COMMUNICATION);
  const key = action.type === "press_key" || action.type === "hotkey" ? action.key : "";
  const combo = hotkeyCombo(action);
  const isCmdEnter = action.type === "hotkey" && SUBMIT_KEYS.has(key) && combo.includes("cmd");
  if ((action.type === "press_key" && SUBMIT_KEYS.has(key)) || isCmdEnter) {
    if (sendTerms.length > 0) return result("external_communication", [`submit key near send-like text: ${sendTerms.join(", ")}`], sendTerms);
    const textRisk = classifyText(text);
    if (textRisk.riskClass !== "unknown" && riskClassRank(textRisk.riskClass) > riskClassRank("internal_mutation")) {
      return result(textRisk.riskClass, ["submit key near risky text"], textRisk.matchedTerms);
    }
    return result("internal_mutation", ["submit key without send-like context"], textRisk.matchedTerms);
  }
  if (action.type === "press_key") {
    if (NAVIGATION_KEYS.has(key)) return result("read_only", [`navigation key: ${key}`], []);
    return result("internal_mutation", [`key press enters input: ${key}`], []);
  }
  if (DESTRUCTIVE_COMBOS.has(combo)) {
    return result("destructive", [`destructive shortcut: ${combo}`], []);
  }
  if (MUTATION_COMBOS.has(combo)) {
    return result("internal_mutation", [`mutating shortcut: ${combo}`], []);
  }
  if (READ_ONLY_COMBOS.has(combo)) return result("read_only", [`read-only shortcut: ${combo}`], []);
  if (NAVIGATION_HOTKEYS.has(key)) return result("reversible_navigation", [`navigation shortcut: ${combo}`], []);
  return result("unknown", [`unrecognized shortcut: ${combo}`], []);
}

/**
 * Typed text is never classified through the button-label dictionaries: a note
 * that mentions "password", "admin" or "delete" is ordinary prose, and routing
 * it through those dictionaries used to abort the run as financial_or_access.
 * Instead the content is checked for credential SHAPES, which only add a reason.
 * The class stays internal_mutation, so the decision is capped at "approve" and
 * the exact text is put in front of the user. A genuinely sensitive destination
 * (a secure text field) is caught earlier by detectSensitiveContext, which
 * aborts before this runs.
 */
function classifyTypedText(typed: string): RiskResult {
  const shapes = detectCredentialShapes(typed);
  const reasons = ["typing enters input; exact text must be shown for approval"];
  if (shapes.length > 0) {
    reasons.push(`typed text has a credential shape: ${shapes.join(", ")}`);
  }
  // Reason kinds only: the typed value itself is never copied into the result.
  return result("internal_mutation", reasons, shapes);
}

function classifyPointer(input: RiskInput, text: string): RiskResult {
  const textRisk = classifyText(text);
  const role = roleOf(input);
  if (textRisk.riskClass !== "unknown") {
    return result(textRisk.riskClass, [`label matched ${textRisk.riskClass}: ${textRisk.matchedTerms.join(", ")}`], textRisk.matchedTerms);
  }
  if (role !== undefined && NAVIGATION_ROLES.has(role)) return result("reversible_navigation", [`element role ${role}`], []);
  if (text.length === 0) return result("unknown", ["no label, role, or OCR context for the target"], []);
  return result("unknown", ["label did not match any risk dictionary"], []);
}

/**
 * Deterministic risk classification. The model's own claims are not an input
 * here, so nothing the model says can lower the class.
 */
export function classifyRisk(input: RiskInput): RiskResult {
  if (input.sensitive?.sensitive === true) {
    return result("sensitive_context", input.sensitive.reasons.map((reason) => `sensitive: ${reason}`), []);
  }
  if (input.domain !== undefined && isDomainDenied(input.domain, DEFAULT_DENY_DOMAIN_PATTERNS)) {
    return result("financial_or_access", [`denied domain: ${input.domain}`], []);
  }
  if (input.bundleId !== undefined && isAppDenied(input.bundleId, DEFAULT_DENY_APP_BUNDLE_PATTERNS)) {
    return result("financial_or_access", [`denied app: ${input.bundleId}`], []);
  }
  const { action } = input;
  const text = contextText(input);
  let classified: RiskResult;
  switch (action.type) {
    case "done":
    case "fail":
    case "ask_user":
    case "wait":
    case "move":
    case "scroll":
      classified = result("read_only", [`${action.type} does not change state`], []);
      break;
    case "type_text":
      classified = classifyTypedText(action.text);
      break;
    case "press_key":
    case "hotkey":
      classified = classifyKeyboard(input, text);
      break;
    case "click":
    case "double_click":
      classified = classifyPointer(input, text);
      break;
  }
  if (classified.riskClass === "unknown" && input.skillRiskClass !== undefined && riskClassRank(input.skillRiskClass) > riskClassRank("unknown")) {
    return result(input.skillRiskClass, [...classified.reasons, `escalated to skill risk class ${input.skillRiskClass}`], classified.matchedTerms);
  }
  return classified;
}
