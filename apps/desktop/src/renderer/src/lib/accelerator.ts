/**
 * Validation for Electron accelerator strings (used for the teach shortcut).
 * Reference: https://www.electronjs.org/docs/latest/api/accelerator
 */
const MODIFIERS: Record<string, string> = {
  command: "Command",
  cmd: "Command",
  control: "Control",
  ctrl: "Control",
  commandorcontrol: "CommandOrControl",
  cmdorctrl: "CommandOrControl",
  alt: "Alt",
  option: "Option",
  altgr: "AltGr",
  shift: "Shift",
  super: "Super",
  meta: "Meta"
};

const NAMED_KEYS: Record<string, string> = {
  plus: "Plus",
  space: "Space",
  tab: "Tab",
  capslock: "Capslock",
  numlock: "Numlock",
  scrolllock: "Scrolllock",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  return: "Return",
  enter: "Enter",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  escape: "Escape",
  esc: "Esc",
  volumeup: "VolumeUp",
  volumedown: "VolumeDown",
  volumemute: "VolumeMute",
  medianexttrack: "MediaNextTrack",
  mediaprevioustrack: "MediaPreviousTrack",
  mediastop: "MediaStop",
  mediaplaypause: "MediaPlayPause",
  printscreen: "PrintScreen",
  numdec: "numdec",
  numadd: "numadd",
  numsub: "numsub",
  nummult: "nummult",
  numdiv: "numdiv"
};

const PUNCTUATION = new Set(["~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "-", "_", "=", "[", "]", "{", "}", ";", ":", "'", '"', ",", ".", "<", ">", "/", "?", "\\", "|", "`"]);

export interface AcceleratorValidation {
  ok: boolean;
  normalized?: string;
  message?: string;
}

function normalizeKey(raw: string): string | null {
  const lower = raw.toLowerCase();
  if (/^[a-z0-9]$/.test(lower)) return lower.toUpperCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return `F${lower.slice(1)}`;
  if (/^num[0-9]$/.test(lower)) return lower;
  if (NAMED_KEYS[lower]) return NAMED_KEYS[lower];
  if (raw.length === 1 && PUNCTUATION.has(raw)) return raw;
  return null;
}

/**
 * Validates an accelerator such as "Alt+Command+L". Requires at least one
 * modifier because the shortcut is registered globally.
 */
export function validateAccelerator(input: string): AcceleratorValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, message: "Enter a shortcut such as Alt+Command+L." };
  if (trimmed.length > 64) return { ok: false, message: "Shortcut is too long." };
  const parts = trimmed.split("+").map((p) => p.trim());
  if (parts.some((p) => p.length === 0)) return { ok: false, message: "Separate keys with a single plus sign, for example Shift+Command+K." };
  const keyPart = parts[parts.length - 1];
  if (keyPart === undefined) return { ok: false, message: "Missing key." };
  const modifierParts = parts.slice(0, -1);
  const modifiers: string[] = [];
  for (const part of modifierParts) {
    const canonical = MODIFIERS[part.toLowerCase()];
    if (!canonical) return { ok: false, message: `"${part}" is not a modifier. Use Command, Control, Alt, Option or Shift.` };
    if (modifiers.includes(canonical)) return { ok: false, message: `Modifier "${canonical}" is repeated.` };
    modifiers.push(canonical);
  }
  const key = normalizeKey(keyPart);
  if (!key) {
    if (MODIFIERS[keyPart.toLowerCase()]) return { ok: false, message: "The shortcut must end with a key, not a modifier." };
    return { ok: false, message: `"${keyPart}" is not a recognised key.` };
  }
  if (modifiers.length === 0) return { ok: false, message: "Add at least one modifier (Command, Control, Alt or Shift) so the shortcut cannot fire while typing." };
  const onlyShift = modifiers.length === 1 && modifiers[0] === "Shift";
  if (onlyShift && /^[A-Z0-9]$/.test(key)) return { ok: false, message: "Shift alone with a letter or digit would trigger while typing. Add Command, Control or Alt." };
  return { ok: true, normalized: [...modifiers, key].join("+") };
}

/** Human-readable macOS style label: "Alt+Command+L" -> "Option Command L". */
export function acceleratorLabel(accelerator: string): string {
  const result = validateAccelerator(accelerator);
  const source = result.normalized ?? accelerator;
  return source
    .split("+")
    .map((p) => (p === "Alt" ? "Option" : p === "CommandOrControl" ? "Command" : p))
    .join(" ");
}
