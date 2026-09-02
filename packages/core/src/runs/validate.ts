import { KEY_NAMES, type ActionValidation, type ProposedAction } from "@apprentice/schemas";

export interface ValidationContext {
  readonly screenshotWidth: number;
  readonly screenshotHeight: number;
  readonly subtaskCount: number;
}

const MAX_TEXT_LENGTH = 2000;
const MIN_WAIT_MS = 100;
const MAX_WAIT_MS = 15_000;
const KEY_SET: ReadonlySet<string> = new Set(KEY_NAMES);
const MODIFIER_CANON: Readonly<Record<string, string>> = {
  command: "cmd",
  cmd: "cmd",
  control: "ctrl",
  ctrl: "ctrl",
  option: "alt",
  alt: "alt",
  shift: "shift"
};
const TAB = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const SPACE = 32;
const DELETE = 127;

/** Control characters other than tab and newlines are never typed. */
export function hasControlCharacters(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    const allowedWhitespace = code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN;
    if ((code < SPACE && !allowedWhitespace) || code === DELETE) return true;
  }
  return false;
}

function hasCoordinates(action: ProposedAction): action is Extract<ProposedAction, { x: number; y: number }> {
  return action.type === "click" || action.type === "double_click" || action.type === "move" || action.type === "scroll";
}

/** Deterministic validation of a model-proposed action against the current screenshot and skill. */
export function validateProposedAction(action: ProposedAction, ctx: ValidationContext): ActionValidation {
  const errors: string[] = [];
  if (ctx.screenshotWidth <= 0 || ctx.screenshotHeight <= 0) errors.push("screenshot dimensions must be positive");
  if (action.sourceScreenshot.width !== ctx.screenshotWidth || action.sourceScreenshot.height !== ctx.screenshotHeight) {
    errors.push(
      `source screenshot ${action.sourceScreenshot.width}x${action.sourceScreenshot.height} does not match current ${ctx.screenshotWidth}x${ctx.screenshotHeight}`
    );
  }
  if (!Number.isInteger(action.subtaskIndex) || action.subtaskIndex < 0 || action.subtaskIndex >= ctx.subtaskCount) {
    errors.push(`subtask index ${action.subtaskIndex} out of range (0..${ctx.subtaskCount - 1})`);
  }
  if (hasCoordinates(action)) {
    if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) errors.push("coordinates must be finite");
    if (action.x < 0 || action.x >= ctx.screenshotWidth) errors.push(`x=${action.x} outside screenshot width ${ctx.screenshotWidth}`);
    if (action.y < 0 || action.y >= ctx.screenshotHeight) errors.push(`y=${action.y} outside screenshot height ${ctx.screenshotHeight}`);
  }
  if (action.type === "scroll" && action.deltaX === 0 && action.deltaY === 0) errors.push("scroll needs a non-zero delta");
  if (action.type === "type_text") {
    if (action.text.length === 0) errors.push("text must not be empty");
    if (action.text.length > MAX_TEXT_LENGTH) errors.push(`text exceeds ${MAX_TEXT_LENGTH} characters`);
    if (hasControlCharacters(action.text)) errors.push("text contains control characters");
  }
  if (action.type === "press_key" && !KEY_SET.has(action.key)) errors.push(`key not allowed: ${action.key}`);
  if (action.type === "hotkey") {
    if (!KEY_SET.has(action.key)) errors.push(`key not allowed: ${action.key}`);
    if (action.modifiers.length === 0) errors.push("hotkey needs at least one modifier");
    const canon = action.modifiers.map((modifier) => MODIFIER_CANON[modifier] ?? modifier);
    if (new Set(canon).size !== canon.length) errors.push("hotkey modifiers repeat (e.g. cmd and command)");
    if (canon.length > 3) errors.push("hotkey has more than three modifiers");
  }
  if (action.type === "wait" && (action.ms < MIN_WAIT_MS || action.ms > MAX_WAIT_MS)) {
    errors.push(`wait must be between ${MIN_WAIT_MS} and ${MAX_WAIT_MS} ms`);
  }
  return {
    ok: errors.length === 0,
    errors: errors.map((error) => error.slice(0, 256)),
    resolvedTarget: hasCoordinates(action) ? { source: "coordinates_only" } : undefined
  };
}
