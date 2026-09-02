import { z } from "zod";
import { IdSchema, TimestampMsSchema, UnitIntervalSchema } from "./common.js";

export const RiskClassSchema = z.enum([
  "read_only",
  "reversible_navigation",
  "internal_mutation",
  "external_communication",
  "destructive",
  "financial_or_access",
  "sensitive_context",
  "unknown"
]);
export type RiskClass = z.infer<typeof RiskClassSchema>;

export const ActionTypeSchema = z.enum([
  "click",
  "double_click",
  "move",
  "scroll",
  "type_text",
  "press_key",
  "hotkey",
  "wait",
  "ask_user",
  "done",
  "fail"
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

/** Allowed key names for press_key and hotkey. Anything else is rejected. */
export const KEY_NAMES = [
  "enter", "return", "tab", "escape", "esc", "space", "backspace", "delete",
  "up", "down", "left", "right", "home", "end", "pageup", "pagedown",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p",
  "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "-", "=", "[", "]", ";", "'", ",", ".", "/", "\\", "`"
] as const;
export const KeyNameSchema = z.enum(KEY_NAMES);
export type KeyName = z.infer<typeof KeyNameSchema>;

export const MODIFIER_NAMES = ["command", "cmd", "shift", "alt", "option", "ctrl", "control"] as const;
export const ModifierNameSchema = z.enum(MODIFIER_NAMES);
export type ModifierName = z.infer<typeof ModifierNameSchema>;

const ActionBase = z.object({
  purpose: z.string().min(1).max(300),
  expectedResult: z.string().min(1).max(300),
  confidence: UnitIntervalSchema,
  /** Dimensions of the screenshot the model looked at, in image pixels. */
  sourceScreenshot: z.object({
    screenshotId: IdSchema.optional(),
    width: z.number().int().positive(),
    height: z.number().int().positive()
  }),
  subtaskIndex: z.number().int().nonnegative()
});

const ImageCoordinate = z.object({
  /** Coordinates in source-screenshot pixel space (not display points). */
  x: z.number().min(0),
  y: z.number().min(0)
});

export const ProposedActionSchema = z.discriminatedUnion("type", [
  ActionBase.extend({
    type: z.literal("click"),
    ...ImageCoordinate.shape,
    button: z.enum(["left", "right", "middle"]).default("left")
  }),
  ActionBase.extend({ type: z.literal("double_click"), ...ImageCoordinate.shape }),
  ActionBase.extend({ type: z.literal("move"), ...ImageCoordinate.shape }),
  ActionBase.extend({
    type: z.literal("scroll"),
    ...ImageCoordinate.shape,
    deltaX: z.number().int().min(-2000).max(2000).default(0),
    deltaY: z.number().int().min(-2000).max(2000).default(0)
  }),
  ActionBase.extend({ type: z.literal("type_text"), text: z.string().min(1).max(2000) }),
  ActionBase.extend({ type: z.literal("press_key"), key: KeyNameSchema }),
  ActionBase.extend({
    type: z.literal("hotkey"),
    modifiers: z.array(ModifierNameSchema).min(1).max(3),
    key: KeyNameSchema
  }),
  ActionBase.extend({ type: z.literal("wait"), ms: z.number().int().min(100).max(15000) }),
  ActionBase.extend({ type: z.literal("ask_user"), question: z.string().min(1).max(500) }),
  ActionBase.extend({ type: z.literal("done"), summary: z.string().max(500).default("") }),
  ActionBase.extend({ type: z.literal("fail"), reason: z.string().max(500).default("") })
]);
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

/** Action after coordinate mapping into display points, ready for the helper. */
export const ExecutableActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), x: z.number(), y: z.number(), button: z.enum(["left", "right", "middle"]) }),
  z.object({ type: z.literal("double_click"), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("move"), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("scroll"), x: z.number(), y: z.number(), deltaX: z.number().int(), deltaY: z.number().int() }),
  z.object({ type: z.literal("type_text"), text: z.string().max(2000) }),
  z.object({ type: z.literal("press_key"), key: KeyNameSchema }),
  z.object({ type: z.literal("hotkey"), modifiers: z.array(ModifierNameSchema).min(1).max(3), key: KeyNameSchema }),
  z.object({ type: z.literal("wait"), ms: z.number().int().min(0).max(15000) })
]);
export type ExecutableAction = z.infer<typeof ExecutableActionSchema>;

export const PolicyDecisionSchema = z.enum(["auto", "approve", "approve_strong", "abort", "unsupported"]);
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const RiskResultSchema = z.object({
  riskClass: RiskClassSchema,
  decision: PolicyDecisionSchema,
  reasons: z.array(z.string().max(256)).max(20),
  matchedTerms: z.array(z.string().max(64)).max(20),
  /** True when the run-level low-risk continuation covers this action. */
  coveredByRunApproval: z.boolean().default(false)
});
export type RiskResult = z.infer<typeof RiskResultSchema>;

export const ApprovalScopeSchema = z.enum(["once", "run_low_risk"]);
export type ApprovalScope = z.infer<typeof ApprovalScopeSchema>;

export const ApprovalResultSchema = z.object({
  decision: z.enum(["approved", "rejected", "timed_out", "interrupted", "auto"]),
  scope: ApprovalScopeSchema.default("once"),
  ts: TimestampMsSchema,
  note: z.string().max(256).optional()
});
export type ApprovalResult = z.infer<typeof ApprovalResultSchema>;

export const ActionValidationSchema = z.object({
  ok: z.boolean(),
  errors: z.array(z.string().max(256)),
  /** Distance in display points the resolved target moved since proposal, if measured. */
  targetDriftPx: z.number().nonnegative().optional(),
  resolvedTarget: z
    .object({
      source: z.enum(["ocr", "accessibility", "coordinates_only"]),
      label: z.string().max(160).optional(),
      role: z.string().max(64).optional()
    })
    .optional()
});
export type ActionValidation = z.infer<typeof ActionValidationSchema>;
