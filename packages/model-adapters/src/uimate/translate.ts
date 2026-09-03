/**
 * Ported from Tencent/UI-Mate agents/ui_mate_agent.py at commit 1cb9e1e, Apache-2.0.
 *
 * Maps parsed UI-Mate `computer_use` calls onto Apprentice's strict
 * `ProposedAction` union. This is the only place the official protocol is
 * narrowed: unsupported UI-Mate actions (triple_click, drag, key_down, key_up,
 * multi-key press) yield `action: null` plus parse errors, never a guessed
 * action. Nothing from `<think>` is read here; the only free text carried into
 * the result is the `<action>` sentence.
 *
 * Terminal tokens are explicit only (deviation from `parse_response`): DONE and
 * FAIL come from a `finished` tool call and SUBTASK_COMPLETE from a
 * `subtask_complete` call. A reply the parser cannot map - no `<action>` block,
 * no `<tool_call>`, an unknown action name, a reply cut off at max_tokens -
 * produces `action: null` plus `parseErrors` and no control token, so the run
 * engine retries it as an invalid action instead of ending the run.
 */
import {
  KEY_NAMES,
  MODIFIER_NAMES,
  ProposedActionSchema,
  type ControlToken,
  type KeyName,
  type ModifierName,
  type ProposedAction
} from "@apprentice/schemas";
import type { CoordinateType } from "./constants.js";
import {
  decodeTypedText,
  extractActionText,
  extractXmlToolCalls,
  looksInfeasibleResponse,
  normalizeHotkeyKeys,
  normalizePressKeys,
  resolveCoordinate,
  type ToolCallParams
} from "./parser.js";
import { pyStr } from "./python-compat.js";
import { SUBTASK_COMPLETE_ACTION } from "./workflow.js";

export const DEFAULT_CONFIDENCE = 0.7;
export const INFEASIBLE_CONFIDENCE = 0.5;
export const WAIT_MIN_MS = 100;
export const WAIT_MAX_MS = 15000;
export const DEFAULT_WAIT_MS = 1000;
export const SCROLL_DELTA_LIMIT = 2000;
const SUMMARY_MAX = 300;
const RATIONALE_MAX = 500;

export interface TranslateContext {
  /** Width of the image the model looked at (resized dims), in pixels. */
  readonly width: number;
  readonly height: number;
  readonly coordinateType: CoordinateType;
  readonly subtaskIndex: number;
  readonly screenshotId?: string;
  /** UI-Mate is trained on Ubuntu; map ctrl/control to command on macOS. */
  readonly remapControlToCommand: boolean;
  /** Last known pointer position in image pixels, used for scroll targets. */
  readonly pointer?: { readonly x: number; readonly y: number };
}

export interface TranslatedToolCall {
  readonly action: ProposedAction | null;
  readonly controlToken?: ControlToken;
  readonly subtaskCompleteEvidence?: string;
  readonly parseErrors: readonly string[];
  readonly rationaleNotes: readonly string[];
}

export interface TranslationResult {
  readonly action: ProposedAction | null;
  readonly actionSummary: string;
  readonly rationale: string;
  readonly controlToken?: ControlToken;
  readonly subtaskCompleteEvidence?: string;
  readonly parseErrors: readonly string[];
}

const KEY_ALIASES: Readonly<Record<string, KeyName>> = {
  page_up: "pageup",
  pgup: "pageup",
  page_down: "pagedown",
  pgdn: "pagedown",
  del: "delete",
  spacebar: "space",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right"
};

const KEY_SET: ReadonlySet<string> = new Set(KEY_NAMES);
const MODIFIER_SET: ReadonlySet<string> = new Set(MODIFIER_NAMES);

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeKeyName(raw: unknown): KeyName | null {
  const lowered = pyStr(raw).trim().toLowerCase();
  const aliased = KEY_ALIASES[lowered] ?? lowered;
  return KEY_SET.has(aliased) ? (aliased as KeyName) : null;
}

export function normalizeModifier(raw: unknown, remapControlToCommand: boolean): ModifierName | null {
  const lowered = pyStr(raw).trim().toLowerCase();
  if ((lowered === "ctrl" || lowered === "control") && remapControlToCommand) {
    return "command";
  }
  return MODIFIER_SET.has(lowered) ? (lowered as ModifierName) : null;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type ActionFields = DistributiveOmit<ProposedAction, "purpose" | "expectedResult" | "confidence" | "sourceScreenshot" | "subtaskIndex">;

interface Partial {
  readonly fields: ActionFields | null;
  readonly expectedResult: string;
  readonly controlToken?: ControlToken;
  readonly subtaskCompleteEvidence?: string;
  readonly parseErrors: readonly string[];
  readonly rationaleNotes: readonly string[];
}

function unsupported(reason: string): Partial {
  return { fields: null, expectedResult: "", parseErrors: [reason], rationaleNotes: [] };
}

type CoordinateOutcome = { readonly ok: true; readonly value: readonly [number, number] | null } | { readonly ok: false; readonly reason: string };

/** `resolveCoordinate` without exceptions: Python raises ValueError on non-numeric coordinates. */
function safeCoordinate(action: string, params: ToolCallParams, ctx: TranslateContext): CoordinateOutcome {
  try {
    return { ok: true, value: resolveCoordinate(action, params, ctx.width, ctx.height, ctx.coordinateType) };
  } catch (error: unknown) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

function clickLike(action: string, params: ToolCallParams, ctx: TranslateContext): Partial {
  const outcome = safeCoordinate(action, params, ctx);
  if (!outcome.ok) {
    return unsupported(`${action}: coordinate is not numeric (${outcome.reason})`);
  }
  const coordinate = outcome.value;
  if (!coordinate) {
    return unsupported(`${action}: coordinate missing or malformed; clicks without a target are not executed`);
  }
  const [x, y] = coordinate;
  const at = `(${x}, ${y})`;
  switch (action) {
    case "left_click":
    case "click":
      return { fields: { type: "click", x, y, button: "left" }, expectedResult: `The element at ${at} responds to a left click.`, parseErrors: [], rationaleNotes: [] };
    case "right_click":
      return { fields: { type: "click", x, y, button: "right" }, expectedResult: `A context menu or right-click response appears at ${at}.`, parseErrors: [], rationaleNotes: [] };
    case "middle_click":
      return { fields: { type: "click", x, y, button: "middle" }, expectedResult: `The element at ${at} responds to a middle click.`, parseErrors: [], rationaleNotes: [] };
    case "double_click":
      return { fields: { type: "double_click", x, y }, expectedResult: `The element at ${at} opens or selects on double click.`, parseErrors: [], rationaleNotes: [] };
    case "mouse_move":
      return { fields: { type: "move", x, y }, expectedResult: `The pointer rests at ${at} without clicking.`, parseErrors: [], rationaleNotes: [] };
    default:
      return unsupported(`${action} is not supported by the Apprentice action schema`);
  }
}

function typeText(params: ToolCallParams): Partial {
  const raw = "text" in params ? params["text"] : "";
  const text = decodeTypedText(raw).join("");
  if (text.length === 0) {
    return unsupported("type: empty text (the official parser scores this as FAIL)");
  }
  return {
    fields: { type: "type_text", text },
    expectedResult: `The focused field shows the typed text (${text.length} characters).`,
    parseErrors: [],
    rationaleNotes: []
  };
}

function singleKey(rawKey: unknown): Partial {
  const key = normalizeKeyName(rawKey);
  if (!key) {
    return unsupported(`press: key ${JSON.stringify(pyStr(rawKey))} is not an allowed key name`);
  }
  return { fields: { type: "press_key", key }, expectedResult: `The ${key} key press is applied to the focused element.`, parseErrors: [], rationaleNotes: [] };
}

function hotkey(params: ToolCallParams, ctx: TranslateContext): Partial {
  const keys = normalizeHotkeyKeys("keys" in params ? params["keys"] : []);
  if (keys.length === 0) {
    return unsupported("hotkey: no keys given");
  }
  if (keys.length === 1) {
    return singleKey(keys[0]);
  }
  const rawModifiers = keys.slice(0, -1);
  const rawKey = keys[keys.length - 1];
  const key = normalizeKeyName(rawKey);
  if (!key) {
    return unsupported(`hotkey: key ${JSON.stringify(pyStr(rawKey))} is not an allowed key name`);
  }
  const modifiers = rawModifiers.map((m) => normalizeModifier(m, ctx.remapControlToCommand));
  const bad = rawModifiers.filter((_, i) => modifiers[i] === null).map((m) => pyStr(m));
  if (bad.length > 0) {
    return unsupported(`hotkey: unsupported modifier(s) ${bad.join(", ")}`);
  }
  if (modifiers.length > 3) {
    return unsupported("hotkey: more than three modifiers");
  }
  const remapped = rawModifiers.some((m) => ["ctrl", "control"].includes(pyStr(m).trim().toLowerCase())) && ctx.remapControlToCommand;
  const resolved = modifiers.filter((m): m is ModifierName => m !== null);
  return {
    fields: { type: "hotkey", modifiers: resolved, key },
    expectedResult: `The ${[...resolved, key].join("+")} shortcut takes effect.`,
    parseErrors: [],
    rationaleNotes: remapped ? ["ctrl remapped to command for macOS (UI-Mate is trained on Ubuntu)"] : []
  };
}

function press(params: ToolCallParams): Partial {
  const keys = normalizePressKeys("keys" in params ? params["keys"] : []);
  if (keys.length !== 1) {
    return unsupported(`press: expected exactly one key, got ${keys.length}; key sequences are not supported`);
  }
  return singleKey(keys[0]);
}

function scroll(params: ToolCallParams, ctx: TranslateContext): Partial {
  const pixels = toNumber("pixels" in params ? params["pixels"] : 0);
  if (pixels === null) {
    return unsupported("scroll: pixels is not numeric");
  }
  const horizontal = ("direction" in params ? params["direction"] : "vertical") === "horizontal";
  const amount = clamp(Math.trunc(pixels), -SCROLL_DELTA_LIMIT, SCROLL_DELTA_LIMIT);
  // UI-Mate: positive pixels scroll up (vertical) / right (horizontal).
  // Apprentice: deltaY negative scrolls up, deltaX positive scrolls right.
  const deltaX = horizontal ? amount : 0;
  const deltaY = horizontal ? 0 : -amount;
  const outcome = safeCoordinate("mouse_move", params, ctx);
  const explicit = outcome.ok ? outcome.value : null;
  const target = explicit
    ? { x: explicit[0], y: explicit[1] }
    : ctx.pointer ?? { x: Math.trunc(ctx.width / 2), y: Math.trunc(ctx.height / 2) };
  const direction = horizontal ? (amount >= 0 ? "right" : "left") : amount >= 0 ? "up" : "down";
  return {
    fields: { type: "scroll", x: target.x, y: target.y, deltaX, deltaY },
    expectedResult: `The content under (${target.x}, ${target.y}) scrolls ${direction}.`,
    parseErrors: [],
    rationaleNotes: explicit ? [] : ["scroll target defaulted to the last pointer position or screen centre"]
  };
}

function wait(params: ToolCallParams): Partial {
  const seconds = toNumber("time" in params ? params["time"] : null);
  const ms = seconds === null ? DEFAULT_WAIT_MS : clamp(Math.round(seconds * 1000), WAIT_MIN_MS, WAIT_MAX_MS);
  return {
    fields: { type: "wait", ms },
    expectedResult: `The screen settles after ${ms} ms.`,
    controlToken: "WAIT",
    parseErrors: [],
    rationaleNotes: seconds === null ? [`wait duration missing; defaulted to ${DEFAULT_WAIT_MS} ms`] : []
  };
}

function callUser(params: ToolCallParams, actionText: string, infeasible: boolean): Partial {
  const text = pyStr("text" in params ? params["text"] : "").trim();
  const question = truncate(text.length > 0 ? text : actionText, 500);
  if (question.length === 0) {
    return unsupported("call_user: no question text");
  }
  // The reference agent turns an infeasible-sounding call_user into FAIL. Here the
  // question reaches the user instead; only an explicit `finished` call ends a run.
  return {
    fields: { type: "ask_user", question },
    expectedResult: "The user answers before the run continues.",
    parseErrors: [],
    rationaleNotes: infeasible ? ["the model's wording suggests it considers the task infeasible"] : []
  };
}

function finished(params: ToolCallParams, actionText: string): Partial {
  const status = pyStr("status" in params ? params["status"] : "").toLowerCase();
  const success = ["success", "successful", "yes", "ok"].includes(status);
  const summary = truncate(actionText, 500);
  return success
    ? { fields: { type: "done", summary }, expectedResult: "The task goal is visibly satisfied.", controlToken: "DONE", parseErrors: [], rationaleNotes: [] }
    : { fields: { type: "fail", reason: summary }, expectedResult: "The run stops without further actions.", controlToken: "FAIL", parseErrors: [], rationaleNotes: [] };
}

function subtaskComplete(params: ToolCallParams): Partial {
  const evidence = truncate(pyStr("evidence" in params ? params["evidence"] : "").trim(), SUMMARY_MAX);
  return {
    fields: null,
    expectedResult: "",
    controlToken: "SUBTASK_COMPLETE",
    subtaskCompleteEvidence: evidence.length > 0 ? evidence : "The model reported the current subtask complete without evidence text.",
    parseErrors: [],
    rationaleNotes: []
  };
}

function translatePartial(params: ToolCallParams, actionText: string, infeasible: boolean, ctx: TranslateContext): Partial {
  const action = params["action"];
  if (typeof action !== "string" || action.length === 0) {
    return unsupported("tool call has no action name");
  }
  switch (action) {
    case "left_click":
    case "click":
    case "right_click":
    case "middle_click":
    case "double_click":
    case "mouse_move":
      return clickLike(action, params, ctx);
    case "triple_click":
    case "drag":
    case "key_down":
    case "key_up":
      return unsupported(`${action} is not supported by the Apprentice action schema`);
    case "type":
      return typeText(params);
    case "hotkey":
      return hotkey(params, ctx);
    case "press":
      return press(params);
    case "scroll":
    case "sroll":
      return scroll(params, ctx);
    case "wait":
      return wait(params);
    case "call_user":
      return callUser(params, actionText, infeasible);
    case "finished":
      return finished(params, actionText);
    case SUBTASK_COMPLETE_ACTION:
      return subtaskComplete(params);
    default:
      return unsupported(`unknown action ${JSON.stringify(action)}`);
  }
}

/** Translate one parsed `computer_use` call. */
export function translateToolCall(
  params: ToolCallParams,
  actionText: string,
  infeasible: boolean,
  ctx: TranslateContext
): TranslatedToolCall {
  const partial = translatePartial(params, actionText, infeasible, ctx);
  const base = {
    controlToken: partial.controlToken,
    subtaskCompleteEvidence: partial.subtaskCompleteEvidence,
    rationaleNotes: partial.rationaleNotes
  };
  if (partial.fields === null) {
    return { ...base, action: null, parseErrors: partial.parseErrors };
  }
  const candidate = {
    ...partial.fields,
    purpose: truncate(actionText.length > 0 ? actionText : `Model proposed ${partial.fields.type}`, SUMMARY_MAX),
    expectedResult: truncate(partial.expectedResult, SUMMARY_MAX),
    confidence: infeasible ? INFEASIBLE_CONFIDENCE : DEFAULT_CONFIDENCE,
    sourceScreenshot: {
      ...(ctx.screenshotId !== undefined ? { screenshotId: ctx.screenshotId } : {}),
      width: ctx.width,
      height: ctx.height
    },
    subtaskIndex: ctx.subtaskIndex
  };
  const parsed = ProposedActionSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return { ...base, action: null, parseErrors: [...partial.parseErrors, ...issues] };
  }
  return { ...base, action: parsed.data, parseErrors: partial.parseErrors };
}

function isTerminal(token: ControlToken | undefined): boolean {
  return token === "DONE" || token === "FAIL";
}

function pickCall(calls: readonly TranslatedToolCall[]): { readonly chosen: TranslatedToolCall; readonly extraErrors: readonly string[] } {
  const first = calls[0];
  if (first === undefined) {
    throw new RangeError("pickCall requires at least one call");
  }
  // A terminal signal wins on its own, never merged with other code (official rule).
  const terminal = calls.find((call) => isTerminal(call.controlToken));
  const completion = calls.find((call) => call.controlToken === "SUBTASK_COMPLETE");
  const chosen = terminal ?? completion ?? first;
  const extraErrors = calls.length > 1 ? [`${calls.length - 1} additional tool call(s) ignored; Apprentice executes one action per step`] : [];
  return { chosen, extraErrors };
}

function buildRationale(actionText: string, notes: readonly string[]): string {
  const parts = [actionText, ...notes].filter((part) => part.length > 0);
  return truncate(parts.join(" | "), RATIONALE_MAX);
}

/**
 * Translate a full model response. Terminal tokens are explicit only: a missing
 * `<action>` block or a missing `<tool_call>` is a parse failure, not a claim
 * that the task is done or infeasible (see the file header).
 */
export function translateResponse(response: string, ctx: TranslateContext): TranslationResult {
  const text = response ?? "";
  const infeasible = looksInfeasibleResponse(text);
  const actionText = truncate(extractActionText(text), SUMMARY_MAX);

  if (actionText.length === 0) {
    return {
      action: null,
      actionSummary: "",
      rationale: "",
      parseErrors: ["no <action> block found in response"]
    };
  }

  const toolCalls = extractXmlToolCalls(text);
  if (toolCalls.length === 0) {
    return {
      action: null,
      actionSummary: actionText,
      rationale: buildRationale(actionText, infeasible ? ["the model's wording suggests it considers the task infeasible"] : []),
      parseErrors: ["no <tool_call> blocks found in response"]
    };
  }

  const translated = toolCalls.map((params) => translateToolCall(params, actionText, infeasible, ctx));
  const { chosen, extraErrors } = pickCall(translated);
  return {
    action: chosen.action,
    actionSummary: actionText,
    rationale: buildRationale(actionText, chosen.rationaleNotes),
    ...(chosen.controlToken !== undefined ? { controlToken: chosen.controlToken } : {}),
    ...(chosen.subtaskCompleteEvidence !== undefined ? { subtaskCompleteEvidence: chosen.subtaskCompleteEvidence } : {}),
    parseErrors: [...chosen.parseErrors, ...extraErrors]
  };
}
