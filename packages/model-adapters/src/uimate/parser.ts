/**
 * Ported from Tencent/UI-Mate agents/ui_mate_agent.py at commit 1cb9e1e, Apache-2.0.
 *
 * Response parsing: `<action>` extraction, XML tool-call parsing, 0-999
 * coordinate scaling and the pyautogui translation used by the official
 * runner. `toPyautoguiCode` / `parseResponse` produce the same strings as
 * Python so the golden trajectory can be replayed for parity; Apprentice never
 * executes these strings, they are only the reference semantics that
 * translate.ts maps onto the strict ProposedAction schema.
 */
import {
  COORDINATE_SCALE,
  DEFAULT_COORDINATE_TYPE,
  INFEASIBLE_LITERALS,
  INFEASIBLE_REGEXES,
  type CoordinateType
} from "./constants.js";
import {
  PyUnicodeError,
  pyFloat,
  pyInt,
  pyRepr,
  pyStr,
  pyStrip,
  pyUnicodeEscapeDecode
} from "./python-compat.js";
import { SUBTASK_COMPLETE_ACTION } from "./workflow.js";

/** Flat parameter dict of one `computer_use` call (values are raw strings or parsed JSON). */
export type ToolCallParams = { readonly [name: string]: unknown };

export class UIMateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UIMateParseError";
  }
}

/** Heuristic used to turn a give-up response into FAIL rather than DONE. */
export function looksInfeasibleResponse(text: string): boolean {
  const lowered = (text ?? "").toLowerCase();
  if (lowered.includes("infeasible")) {
    return true;
  }
  if (INFEASIBLE_LITERALS.some((pattern) => lowered.includes(pattern))) {
    return true;
  }
  return INFEASIBLE_REGEXES.some((pattern) => pattern.test(lowered));
}

const ACTION_RE = /<action>\s*([\s\S]*?)\s*<\/action>/i;

export function extractActionText(response: string): string {
  const match = ACTION_RE.exec(response);
  return match?.[1] !== undefined ? pyStrip(match[1]) : "";
}

/**
 * Trim a past response before replaying it as assistant history. Keeping the
 * thinking means replaying from `<think>` onwards; otherwise history starts at
 * `<action>`.
 */
export function compactResponseForHistory(response: string, includeThinking = false): string {
  const tag = includeThinking ? /<think\b[^>]*>/i : /<action\b[^>]*>/i;
  const match = tag.exec(response);
  if (!match) {
    return response;
  }
  return pyStrip(response.slice(match.index));
}

function tryParseJson(value: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Parse one XML tool call into a flat params dict; null unless it targets computer_use. */
export function parseXmlToolCall(xmlContent: string): ToolCallParams | null {
  const funcMatch = /<function=([^>]+)>/.exec(xmlContent);
  if (!funcMatch || funcMatch[1] !== "computer_use") {
    return null;
  }
  const paramRe = /<parameter=([^>]+)>\s*([\s\S]*?)\s*<\/parameter>/g;
  const entries: Array<readonly [string, unknown]> = [];
  for (const match of xmlContent.matchAll(paramRe)) {
    const name = match[1] ?? "";
    const value = pyStrip(match[2] ?? "");
    if (value.startsWith("[") || value.startsWith("{")) {
      const parsed = tryParseJson(value);
      if (parsed.ok) {
        entries.push([name, parsed.value]);
        continue;
      }
    }
    entries.push([name, value]);
  }
  return Object.fromEntries(entries);
}

export function extractXmlToolCalls(response: string): readonly ToolCallParams[] {
  const results: ToolCallParams[] = [];
  for (const match of response.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)) {
    const params = parseXmlToolCall(match[1] ?? "");
    // Python: `if params:` - an empty dict is falsy and skipped.
    if (params && Object.keys(params).length > 0) {
      results.push(params);
    }
  }
  return results;
}

export function scaleCoordinate(
  x: number,
  y: number,
  originalWidth: number,
  originalHeight: number,
  coordinateType: CoordinateType
): readonly [number, number] {
  if (coordinateType === "absolute") {
    return [pyInt(x), pyInt(y)];
  }
  return [pyInt((x * originalWidth) / COORDINATE_SCALE), pyInt((y * originalHeight) / COORDINATE_SCALE)];
}

/** Port of `_clean_keys`: strips stray `keys=[...]` / quote wrappers from key names. */
export function cleanKeys(rawKeys: unknown): readonly unknown[] {
  const keys = Array.isArray(rawKeys) ? (rawKeys as readonly unknown[]) : [rawKeys];
  return keys.map((key) => {
    if (typeof key !== "string") {
      return key;
    }
    let cleaned = key;
    if (cleaned.startsWith("keys=[")) {
      cleaned = cleaned.slice(6);
    }
    if (cleaned.endsWith("]")) {
      cleaned = cleaned.slice(0, -1);
    }
    if (cleaned.startsWith("['") || cleaned.startsWith('["')) {
      cleaned = cleaned.length > 2 ? cleaned.slice(2) : cleaned;
    }
    if (cleaned.endsWith("']") || cleaned.endsWith('"]')) {
      cleaned = cleaned.length > 2 ? cleaned.slice(0, -2) : cleaned;
    }
    return pyStrip(cleaned);
  });
}

const COORDINATE_ACTIONS = new Set([
  "left_click", "click", "right_click", "middle_click",
  "double_click", "triple_click", "drag", "mouse_move"
]);

/** Resolve the `coordinate` argument into scaled ints, or null when absent/malformed. */
export function resolveCoordinate(
  action: string,
  args: ToolCallParams,
  originalWidth: number,
  originalHeight: number,
  coordinateType: CoordinateType
): readonly [number, number] | null {
  if (!COORDINATE_ACTIONS.has(action)) {
    return null;
  }
  const coordinate = args["coordinate"];
  if (!Array.isArray(coordinate) || coordinate.length < 2) {
    return null;
  }
  const [x, y] = coordinate as readonly unknown[];
  return scaleCoordinate(pyFloat(x), pyFloat(y), originalWidth, originalHeight, coordinateType);
}

/** `text.encode("latin-1", "backslashreplace").decode("unicode_escape")` with Python's fallbacks. */
export function decodeTypedText(text: unknown): readonly string[] {
  if (typeof text === "string") {
    try {
      return Array.from(pyUnicodeEscapeDecode(text));
    } catch (error: unknown) {
      if (error instanceof PyUnicodeError) {
        return Array.from(text);
      }
      throw error;
    }
  }
  if (Array.isArray(text)) {
    return (text as readonly unknown[]).map((item) => pyStr(item));
  }
  if (text !== null && typeof text === "object") {
    // Python iterates a dict's keys.
    return Object.keys(text);
  }
  throw new UIMateParseError(`type action text is not iterable: ${JSON.stringify(text)}`);
}

function typeToCode(text: unknown): string {
  return decodeTypedText(text)
    .map((char) => {
      if (char === "\n") {
        return "pyautogui.press('enter')\n";
      }
      if (char === "'") {
        return "pyautogui.press(\"'\")\n";
      }
      if (char === "\\") {
        return "pyautogui.press('\\\\')\n";
      }
      if (char === '"') {
        return "pyautogui.press('\"')\n";
      }
      return `pyautogui.press('${char}')\n`;
    })
    .join("");
}

/** Port of the `hotkey` key normalisation (split on "+", flatten). */
export function normalizeHotkeyKeys(rawKeys: unknown): readonly unknown[] {
  if (typeof rawKeys === "string") {
    return rawKeys.split("+").map((k) => pyStrip(k));
  }
  if (Array.isArray(rawKeys)) {
    return (rawKeys as readonly unknown[]).flatMap((key) => {
      if (typeof key === "string" && key.includes("+") && key !== "+") {
        return key.split("+").map((k) => pyStrip(k));
      }
      return [typeof key === "string" ? pyStrip(key) : key];
    });
  }
  if (rawKeys !== null && rawKeys !== undefined) {
    return [rawKeys];
  }
  return [];
}

/** Port of the `press` key normalisation. */
export function normalizePressKeys(rawKeys: unknown): readonly unknown[] {
  if (Array.isArray(rawKeys)) {
    return cleanKeys(rawKeys);
  }
  if (rawKeys !== null && rawKeys !== undefined) {
    return [rawKeys];
  }
  return [];
}

function keysArg(args: ToolCallParams): unknown {
  return "keys" in args ? args["keys"] : [];
}

/** Convert one parsed action into pyautogui source (or a control token). */
export function toPyautoguiCode(
  action: string,
  args: ToolCallParams,
  originalWidth: number,
  originalHeight: number,
  coordinateType: CoordinateType
): string | readonly string[] {
  const adj = resolveCoordinate(action, args, originalWidth, originalHeight, coordinateType);
  const at = adj ? `${adj[0]}, ${adj[1]}` : "";

  switch (action) {
    case "left_click":
    case "click":
      return `pyautogui.click(${at})`;
    case "right_click":
      return `pyautogui.rightClick(${at})`;
    case "middle_click":
      return `pyautogui.middleClick(${at})`;
    case "double_click":
      return `pyautogui.doubleClick(${at})`;
    case "triple_click":
      return `pyautogui.tripleClick(${at})`;
    case "drag": {
      const duration = "duration" in args ? args["duration"] : 0.5;
      if (!adj) {
        return "pyautogui.dragTo(0, 0)";
      }
      const truthy = duration !== null && duration !== undefined && duration !== 0 && duration !== "" && duration !== false;
      return truthy ? `pyautogui.dragTo(${at}, duration=${pyStr(duration)})` : `pyautogui.dragTo(${at})`;
    }
    case "mouse_move":
      return adj ? `pyautogui.moveTo(${at})` : "pyautogui.moveTo(0, 0)";
    case "type":
      return typeToCode("text" in args ? args["text"] : "");
    case "hotkey": {
      const keys = normalizeHotkeyKeys(keysArg(args));
      const keysStr = keys.map((k) => `'${pyStr(k)}'`).join(", ");
      return keys.length > 1 ? `pyautogui.hotkey(${keysStr})` : `pyautogui.press(${keysStr})`;
    }
    case "press": {
      const keys = normalizePressKeys(keysArg(args));
      return keys.length === 1 ? `pyautogui.press(${pyRepr(keys[0])})` : `pyautogui.press(${pyRepr(keys)})`;
    }
    case "key_down":
      return cleanKeys(keysArg(args)).map((k) => `pyautogui.keyDown('${pyStr(k)}')`);
    case "key_up":
      return [...cleanKeys(keysArg(args))].reverse().map((k) => `pyautogui.keyUp('${pyStr(k)}')`);
    case "scroll":
    case "sroll": {
      const pixels = "pixels" in args ? args["pixels"] : 0;
      const direction = "direction" in args ? args["direction"] : "vertical";
      return direction === "horizontal" ? `pyautogui.hscroll(${pyStr(pixels)})` : `pyautogui.scroll(${pyStr(pixels)})`;
    }
    case "wait":
      return "WAIT";
    case SUBTASK_COMPLETE_ACTION:
      // The workflow rewrites this step's actions; here it only has to stay harmless.
      return "WAIT";
    case "finished": {
      const status = pyStr("status" in args ? args["status"] : "").toLowerCase();
      return ["success", "successful", "yes", "ok"].includes(status) ? "DONE" : "FAIL";
    }
    default:
      return "";
  }
}

export interface ParsedResponse {
  readonly instruction: string;
  readonly codes: readonly string[];
}

function isTerminal(code: string): boolean {
  return code === "FAIL" || code === "DONE";
}

/**
 * Turn a model response into (action text, pyautogui code / control tokens).
 * `call_user` and responses without a usable action fall back to the
 * infeasibility heuristic: FAIL when the model is giving up, DONE otherwise.
 */
export function parseResponse(
  response: string,
  originalWidth: number,
  originalHeight: number,
  coordinateType: CoordinateType = DEFAULT_COORDINATE_TYPE
): ParsedResponse {
  const text = response ?? "";
  const infeasible = looksInfeasibleResponse(text);
  const giveUp = infeasible ? "FAIL" : "DONE";

  const instruction = extractActionText(text);
  if (!instruction) {
    return { instruction: "<Error>: no <action> block found in response", codes: ["FAIL"] };
  }

  const toolCalls = extractXmlToolCalls(text);
  if (toolCalls.length === 0) {
    return { instruction: "<Error>: no <tool_call> blocks found in response", codes: [giveUp] };
  }

  const codes = toolCalls.flatMap((params): readonly string[] => {
    const action = params["action"];
    if (typeof action !== "string" || action.length === 0) {
      return ["FAIL"];
    }
    if (action === "call_user") {
      return [giveUp];
    }
    const code = toPyautoguiCode(action, params, originalWidth, originalHeight, coordinateType);
    if (typeof code === "string") {
      return code.length === 0 ? ["FAIL"] : [code];
    }
    return code.length === 0 ? ["FAIL"] : code;
  });

  if (codes.length === 0) {
    return { instruction: "<Error>: no pyautogui code generated", codes: [giveUp] };
  }

  // A terminal signal is returned on its own, never merged with other code.
  const terminal = codes.find(isTerminal);
  if (terminal !== undefined) {
    return { instruction, codes: [terminal] };
  }

  if (codes.length > 1) {
    const hasModifier = codes.some(
      (c) => (c.includes("keyDown") || c.includes("keyUp")) && (c.includes("'ctrl'") || c.includes("'shift'"))
    );
    const forceJoin = codes.some((c) =>
      ["'enter'", "'backspace'", "'tab'", "'space'"].some((k) => c.includes(k))
    );
    if (!hasModifier || forceJoin) {
      return { instruction, codes: [codes.join("\n")] };
    }
  }
  return { instruction, codes };
}
