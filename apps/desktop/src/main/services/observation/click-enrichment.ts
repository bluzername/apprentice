import { redactText } from "@apprentice/core";
import type { AccessibilityContextAtPointResult, SemanticElement } from "@apprentice/schemas";

/** Upper bound for the AX lookup that enriches a native click; the event is stored plain when it expires. */
export const DEFAULT_CLICK_AX_TIMEOUT_MS = 250;
export const MAX_ELEMENT_NAME_LENGTH = 80;
const MAX_IDENTIFIER_LENGTH = 160;

const AX_ROLE_MAP: Readonly<Record<string, string>> = {
  axbutton: "button",
  axlink: "link",
  axtextfield: "textbox",
  axtextarea: "textbox",
  axsearchfield: "searchbox",
  axsecuretextfield: "secure-text-field",
  axcheckbox: "checkbox",
  axradiobutton: "radio",
  axpopupbutton: "combobox",
  axcombobox: "combobox",
  axmenuitem: "menuitem",
  axmenubutton: "menubutton",
  axmenu: "menu",
  axtab: "tab",
  axrow: "row",
  axcell: "cell",
  axstatictext: "text",
  axheading: "heading",
  aximage: "image",
  axgroup: "group",
  axtoolbar: "toolbar",
  axlist: "list",
  axtable: "table",
  axoutline: "tree",
  axslider: "slider",
  axdisclosuretriangle: "disclosure",
  axscrollarea: "scrollarea",
  axwebarea: "webarea",
  axwindow: "window"
};

/** "AXButton" -> "button"; unknown roles lose the AX prefix and are lowercased. */
export function mapAxRole(role: string): string | undefined {
  const trimmed = role.trim();
  if (trimmed.length === 0) return undefined;
  const mapped = AX_ROLE_MAP[trimmed.toLowerCase()];
  if (mapped !== undefined) return mapped;
  return trimmed.replace(/^AX/, "").toLowerCase().slice(0, 64);
}

/** Redacted, whitespace-collapsed, bounded label; undefined when nothing survives. */
export function safeElementName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const cleaned = redactText(raw).text.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.slice(0, MAX_ELEMENT_NAME_LENGTH);
}

function nearestAncestorTitle(result: AccessibilityContextAtPointResult): string | undefined {
  return result.ancestors.find((ancestor) => ancestor.title !== undefined && ancestor.title.trim().length > 0)?.title;
}

/**
 * Semantic element for a stored click. Never carries a value: secure fields keep only
 * their role, and titles are redacted before they are attached. The helper's resolved
 * `name` (own label, labelled descendant, or titled ancestor) wins; the title,
 * description, and ancestor fallbacks cover helpers that do not resolve names.
 */
export function elementFromAxContext(result: AccessibilityContextAtPointResult): SemanticElement | undefined {
  const element = result.element;
  if (element === null) return undefined;
  const role = mapAxRole(element.role);
  if (element.isSecure) return role !== undefined ? { role } : undefined;
  const name = safeElementName(element.name) ?? safeElementName(element.title) ?? safeElementName(element.description) ?? safeElementName(nearestAncestorTitle(result));
  const identifier = element.identifier !== undefined && element.identifier.trim().length > 0 ? element.identifier.trim().slice(0, MAX_IDENTIFIER_LENGTH) : undefined;
  const semantic: SemanticElement = {
    ...(role !== undefined ? { role } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(identifier !== undefined ? { identifier } : {})
  };
  return Object.keys(semantic).length > 0 ? semantic : undefined;
}

export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`timed out after ${timeoutMs} ms`);
    this.name = "TimeoutError";
  }
}

/** Rejects with TimeoutError when `promise` does not settle within `timeoutMs`. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}
