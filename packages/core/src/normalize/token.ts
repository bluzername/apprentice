import type { ActivityEvent } from "@apprentice/schemas";
import { normalizeAppName } from "./app-name.js";
import { browserViewFromEvent } from "./browser-view.js";
import { normalizeLabel } from "./label.js";
import { normalizeRoute } from "./route.js";

export type TokenParts = Readonly<Record<string, string>>;

export const TOKEN_SEPARATOR = "|";

const MEANINGFUL_ACTIONS: ReadonlySet<string> = new Set([
  "click",
  "form-submit",
  "navigate",
  "shortcut",
  "download",
  "copy",
  "paste",
  "view"
]);

const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  command: "cmd",
  cmd: "cmd",
  meta: "cmd",
  control: "ctrl",
  ctrl: "ctrl",
  option: "alt",
  alt: "alt",
  shift: "shift"
};
const MODIFIER_ORDER: readonly string[] = ["cmd", "ctrl", "alt", "shift"];

export function buildToken(parts: ReadonlyArray<readonly [string, string | undefined]>): string {
  return parts
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined && entry[1].length > 0)
    .map(([key, value]) => `${key}:${value}`)
    .join(TOKEN_SEPARATOR);
}

export function parseToken(token: string): TokenParts {
  const parts: Record<string, string> = {};
  for (const piece of token.split(TOKEN_SEPARATOR)) {
    const index = piece.indexOf(":");
    if (index <= 0) continue;
    parts[piece.slice(0, index)] = piece.slice(index + 1);
  }
  return parts;
}

export function tokenAction(token: string): string | undefined {
  return parseToken(token)["action"];
}

export function tokenContext(token: string): string | undefined {
  const parts = parseToken(token);
  return parts["domain"] ?? parts["app"];
}

export function isMeaningfulToken(token: string): boolean {
  const action = tokenAction(token);
  return action !== undefined && MEANINGFUL_ACTIONS.has(action);
}

export function normalizeKeys(keys: readonly string[] | string): string {
  const list = typeof keys === "string" ? keys.split(/[+\s]+/) : keys;
  const cleaned = list.map((key) => key.trim().toLowerCase()).filter((key) => key.length > 0);
  const modifiers = cleaned
    .map((key) => MODIFIER_ALIASES[key])
    .filter((key): key is string => key !== undefined);
  const uniqueModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
  const plain = cleaned.filter((key) => MODIFIER_ALIASES[key] === undefined);
  return [...uniqueModifiers, ...plain].join("+");
}

function payloadString(event: ActivityEvent, key: string): string | undefined {
  const value = event.payload?.[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join("+");
  return undefined;
}

function elementLabel(event: ActivityEvent): string | undefined {
  const element = event.element;
  if (!element) return undefined;
  const raw = element.name ?? element.ariaLabel ?? element.text ?? element.identifier;
  if (raw === undefined) return undefined;
  const label = normalizeLabel(raw);
  return label.length > 0 ? label : undefined;
}

function elementRole(event: ActivityEvent): string | undefined {
  const role = event.element?.role ?? event.element?.tag;
  if (role === undefined) return undefined;
  const normalized = normalizeLabel(role.replace(/^AX/, ""));
  return normalized.length > 0 ? normalized : undefined;
}

function actionParts(event: ActivityEvent): ReadonlyArray<readonly [string, string | undefined]> | null {
  switch (event.type) {
    case "click":
    case "mouse_down":
      return [["action", "click"], ["role", elementRole(event)], ["name", elementLabel(event)]];
    case "form_submit":
      return [["action", "form-submit"], ["purpose", payloadString(event, "formPurpose") ?? "unknown"]];
    case "navigation":
      return [["action", "navigate"]];
    case "shortcut": {
      const keys = event.payload?.["keys"];
      const normalized = keys === undefined ? "" : normalizeKeys(keys as string[] | string);
      return [["action", "shortcut"], ["keys", normalized.length > 0 ? normalized : undefined]];
    }
    case "download":
      return [["action", "download"], ["ext", normalizeLabel(payloadString(event, "extension") ?? "") || undefined]];
    case "copy":
      return [["action", "copy"]];
    case "paste":
      return [["action", "paste"]];
    case "field_input": {
      const label = normalizeLabel(payloadString(event, "fieldLabel") ?? "");
      return [["action", "field-input"], ["field", label.length > 0 ? label : undefined]];
    }
    case "app_activated":
      return [["action", "activate"]];
    case "window_title_changed": {
      // Browsers only: native app titles carry no coarse view class and produce no token.
      const view = browserViewFromEvent(event);
      if (view === null) return null;
      return [["site", view.site], ["view", view.view], ["action", "view"]];
    }
    default:
      return null;
  }
}

/** Converts an activity event into a stable action token, or null for non-actions. */
export function eventToToken(event: ActivityEvent): string | null {
  const parts = actionParts(event);
  if (parts === null) return null;
  const app = event.app ? normalizeAppName(event.app.bundleId, event.app.name) : undefined;
  const domain = event.domain?.toLowerCase();
  const route = event.routePattern !== undefined ? normalizeRoute(event.routePattern) : undefined;
  return buildToken([["app", app], ["domain", domain], ["route", route], ...parts]);
}
