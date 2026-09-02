import { z } from "zod";
import { DurationMsSchema, IdSchema, TimestampMsSchema } from "./common.js";
import {
  ActionValidationSchema,
  ApprovalResultSchema,
  ExecutableActionSchema,
  ProposedActionSchema,
  RiskResultSchema
} from "./actions.js";
import { ActionPolicyModeSchema } from "./skills.js";

export const FailureCategorySchema = z.enum([
  "none",
  "model_unavailable",
  "invalid_action",
  "policy_blocked",
  "stale_screen",
  "target_ambiguous",
  "user_rejected",
  "user_interrupted",
  "timeout",
  "verification_failed",
  "helper_error",
  "sensitive_context",
  "max_steps",
  "unknown"
]);
export type FailureCategory = z.infer<typeof FailureCategorySchema>;

export const RunStatusSchema = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "awaiting_user",
  "completed",
  "failed",
  "interrupted",
  "timed_out",
  "aborted_policy",
  "aborted_sensitive"
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const VerificationMethodSchema = z.enum([
  "extension_dom",
  "accessibility",
  "app_metadata",
  "screen_diff_ocr",
  "model_supporting",
  "user_confirmation",
  "none"
]);
export type VerificationMethod = z.infer<typeof VerificationMethodSchema>;

export const StepVerificationSchema = z.object({
  passed: z.boolean(),
  subtaskComplete: z.boolean(),
  method: VerificationMethodSchema,
  evidence: z.string().max(500),
  confidence: z.number().min(0).max(1)
});
export type StepVerification = z.infer<typeof StepVerificationSchema>;

export const RunStepTimingSchema = z.object({
  captureMs: DurationMsSchema.default(0),
  proposeMs: DurationMsSchema.default(0),
  approvalWaitMs: DurationMsSchema.default(0),
  executeMs: DurationMsSchema.default(0),
  verifyMs: DurationMsSchema.default(0),
  totalMs: DurationMsSchema.default(0)
});
export type RunStepTiming = z.infer<typeof RunStepTimingSchema>;

export const ControlTokenSchema = z.enum(["WAIT", "DONE", "FAIL", "SUBTASK_COMPLETE"]);
export type ControlToken = z.infer<typeof ControlTokenSchema>;

export const RunStepSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  index: z.number().int().nonnegative(),
  subtaskIndex: z.number().int().nonnegative(),
  ts: TimestampMsSchema,
  screenshotRef: IdSchema.optional(),
  semanticStateRef: IdSchema.optional(),
  proposed: ProposedActionSchema.nullable(),
  /** One-line action summary the model produced (never hidden reasoning). */
  actionSummary: z.string().max(300).default(""),
  rationale: z.string().max(500).default(""),
  validation: ActionValidationSchema.nullable(),
  risk: RiskResultSchema.nullable(),
  approval: ApprovalResultSchema.nullable(),
  executed: ExecutableActionSchema.nullable(),
  beforeStateHash: z.string().max(64).optional(),
  afterStateHash: z.string().max(64).optional(),
  verification: StepVerificationSchema.nullable(),
  timing: RunStepTimingSchema,
  failureCategory: FailureCategorySchema.default("none"),
  userInterrupted: z.boolean().default(false),
  controlToken: ControlTokenSchema.optional()
});
export type RunStep = z.infer<typeof RunStepSchema>;

export const RunMetricsSchema = z.object({
  steps: z.number().int().nonnegative().default(0),
  approvedActions: z.number().int().nonnegative().default(0),
  rejectedActions: z.number().int().nonnegative().default(0),
  corrections: z.number().int().nonnegative().default(0),
  modelLatencyMsTotal: DurationMsSchema.default(0),
  modelLatencyMsMax: DurationMsSchema.default(0),
  screenshotsUsed: z.number().int().nonnegative().default(0)
});
export type RunMetrics = z.infer<typeof RunMetricsSchema>;

export const RunSchema = z.object({
  id: IdSchema,
  skillId: IdSchema,
  skillVersion: z.number().int().positive(),
  skillName: z.string().max(120),
  mode: ActionPolicyModeSchema,
  status: RunStatusSchema,
  currentSubtaskIndex: z.number().int().nonnegative(),
  subtaskCount: z.number().int().positive(),
  startedAt: TimestampMsSchema,
  endedAt: TimestampMsSchema.optional(),
  failureCategory: FailureCategorySchema.default("none"),
  interruptedBy: z.enum(["user_escape", "menu_bar", "ui_stop", "policy", "timeout", "helper", "model"]).optional(),
  provider: z.string().max(64),
  model: z.string().max(128).optional(),
  metrics: RunMetricsSchema,
  /** Run-level approval for low-risk continuation. */
  lowRiskRunApproval: z.boolean().default(false),
  navigationRunApproval: z.boolean().default(false),
  summary: z.string().max(1000).default("")
});
export type Run = z.infer<typeof RunSchema>;
