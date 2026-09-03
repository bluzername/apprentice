import type { ActivityEvent } from "@apprentice/schemas";
import { normalizeAppName } from "../normalize/app-name.js";
import { browserViewFromEvent } from "../normalize/browser-view.js";
import { normalizeLabel } from "../normalize/label.js";
import { normalizeKeys } from "../normalize/token.js";

export const OUTCOME_CLICK_TERMS: readonly string[] = ["send", "submit", "save", "create", "publish", "complete", "done", "post"];
export const OUTCOME_SHORTCUTS: ReadonlySet<string> = new Set(["cmd+s", "cmd+enter", "cmd+return"]);
export const CLOSING_SHORTCUTS: ReadonlySet<string> = new Set(["cmd+w", "cmd+q", "escape", "esc"]);
const CLOSING_EVENT_TYPES: ReadonlySet<ActivityEvent["type"]> = new Set([
  "app_activated",
  "idle_changed",
  "clipboard_changed",
  "screenshot_captured",
  "privacy_gap"
]);

/** Closing actions this long after an outcome event still belong to the finished workflow. */
export const OUTCOME_TAIL_WINDOW_MS = 20_000;

export const CONTEXT_SHIFT_GAP_MS = 60_000;
export const CONTEXT_SHIFT_MIN_EVENTS = 3;

export function eventContext(event: ActivityEvent): string | undefined {
  if (event.domain !== undefined && event.domain.length > 0) return event.domain.toLowerCase();
  if (event.app !== undefined) return normalizeAppName(event.app.bundleId, event.app.name);
  return undefined;
}

function shortcutKeys(event: ActivityEvent): string | undefined {
  const keys = event.payload?.["keys"];
  if (typeof keys !== "string" && !Array.isArray(keys)) return undefined;
  return normalizeKeys(keys as string[] | string);
}

export function isOutcomeEvent(event: ActivityEvent): boolean {
  if (event.type === "form_submit" || event.type === "download") return true;
  if (event.type === "shortcut") {
    const keys = shortcutKeys(event);
    return keys !== undefined && OUTCOME_SHORTCUTS.has(keys);
  }
  if (event.type === "click" || event.type === "mouse_down") {
    const raw = event.element?.name ?? event.element?.ariaLabel ?? event.element?.text ?? "";
    const label = normalizeLabel(raw);
    if (label.length === 0) return false;
    const words = label.split("-");
    return OUTCOME_CLICK_TERMS.some((term) => words.includes(term));
  }
  return false;
}

/**
 * Closing actions wrap up a finished workflow rather than start a new one: close or
 * quit shortcuts, escape, app switches, native window title changes, idle, clipboard,
 * screenshot, and privacy gap events. A browser title change that carries a view class
 * is navigation and therefore not closing.
 */
export function isClosingAction(event: ActivityEvent): boolean {
  if (event.type === "shortcut") {
    const keys = shortcutKeys(event);
    return keys !== undefined && CLOSING_SHORTCUTS.has(keys);
  }
  if (event.type === "window_title_changed") return browserViewFromEvent(event) === null;
  return CLOSING_EVENT_TYPES.has(event.type);
}

export function isUserCorrection(event: ActivityEvent): boolean {
  return event.payload?.["correction"] === true;
}

export function teachPhase(event: ActivityEvent): "start" | "end" | null {
  if (event.type !== "teach_marker") return null;
  const phase = event.payload?.["phase"];
  return phase === "end" ? "end" : "start";
}

export function isIdleStart(event: ActivityEvent): boolean {
  return event.type === "idle_changed" && event.payload?.["idle"] === true;
}

/**
 * True when the event at `index` starts a run of at least three events in a
 * different context than the previous event, after a gap of at least 60 s.
 */
export function isContextShift(events: readonly ActivityEvent[], index: number): boolean {
  const current = events[index];
  const previous = events[index - 1];
  if (current === undefined || previous === undefined) return false;
  if (current.ts - previous.ts < CONTEXT_SHIFT_GAP_MS) return false;
  const previousContext = eventContext(previous);
  const nextContext = eventContext(current);
  if (nextContext === undefined || nextContext === previousContext) return false;
  const run = events.slice(index, index + CONTEXT_SHIFT_MIN_EVENTS);
  if (run.length < CONTEXT_SHIFT_MIN_EVENTS) return false;
  return run.every((event) => eventContext(event) === nextContext);
}
