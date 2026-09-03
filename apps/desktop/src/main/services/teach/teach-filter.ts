import { APP_BUNDLE_ID, type ActivityEvent } from "@apprentice/schemas";

/** Electron accelerator names and helper key names collapsed to one vocabulary. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  commandorcontrol: "cmd",
  cmdorctrl: "cmd",
  command: "cmd",
  cmd: "cmd",
  meta: "cmd",
  super: "cmd",
  control: "ctrl",
  ctrl: "ctrl",
  option: "alt",
  alt: "alt",
  shift: "shift",
  return: "enter",
  enter: "enter",
  esc: "escape",
  escape: "escape"
};

function keySet(keys: readonly string[] | string): ReadonlySet<string> {
  const list = typeof keys === "string" ? keys.split(/[+\s]+/) : keys;
  return new Set(
    list
      .map((key) => key.trim().toLowerCase())
      .filter((key) => key.length > 0)
      .map((key) => KEY_ALIASES[key] ?? key)
  );
}

function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

/** "Alt+Command+L" -> {alt, cmd, l}. Order and alias spelling do not matter. */
export function parseTeachShortcut(accelerator: string): ReadonlySet<string> {
  return keySet(accelerator);
}

export function isShortcutEvent(event: ActivityEvent, shortcut: ReadonlySet<string>): boolean {
  if (event.type !== "shortcut") return false;
  const keys = event.payload?.["keys"];
  if (typeof keys !== "string" && !Array.isArray(keys)) return false;
  return sameKeys(keySet(keys), shortcut);
}

/** Everything from the last teach marker onward is the act of teaching, not the taught work. */
export function trimAtTeachMarker(events: readonly ActivityEvent[]): readonly ActivityEvent[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]!.type === "teach_marker") return events.slice(0, index);
  }
  return events;
}

/**
 * Keeps only events that belong to the work the user is teaching: allowed events from
 * other apps, minus teach markers, privacy gaps, and the teach shortcut itself.
 */
export function isTaughtEvent(event: ActivityEvent, teachShortcut: ReadonlySet<string>): boolean {
  if (event.privacy !== "allowed") return false;
  if (event.type === "teach_marker" || event.type === "privacy_gap") return false;
  if (event.app?.bundleId === APP_BUNDLE_ID) return false;
  return !isShortcutEvent(event, teachShortcut);
}
