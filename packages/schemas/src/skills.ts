import { z } from "zod";
import { DurationMsSchema, IdSchema, TimestampMsSchema } from "./common.js";
import { RiskClassSchema } from "./actions.js";
import { VariableSlotSchema } from "./candidates.js";

export const ActionPolicyModeSchema = z.enum([
  "suggest_only",
  "guide",
  "approval_every_step",
  "low_risk_auto"
]);
export type ActionPolicyMode = z.infer<typeof ActionPolicyModeSchema>;

export const CompletionPredicateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url_pattern"), pattern: z.string().min(1).max(256) }),
  z.object({ kind: z.literal("title_contains"), text: z.string().min(1).max(160) }),
  z.object({ kind: z.literal("ocr_contains"), text: z.string().min(1).max(160) }),
  z.object({ kind: z.literal("app_frontmost"), bundleId: z.string().min(1).max(256) }),
  z.object({ kind: z.literal("dom_marker"), marker: z.string().min(1).max(160) }),
  z.object({ kind: z.literal("user_confirm") })
]);
export type CompletionPredicate = z.infer<typeof CompletionPredicateSchema>;

export const SkillSubtaskSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(120),
  goal: z.string().min(1).max(500),
  completionCriteria: z.string().min(1).max(500),
  keySteps: z.array(z.string().max(300)).max(20).default([]),
  completionPredicates: z.array(CompletionPredicateSchema).max(6).default([]),
  appOrDomain: z.string().max(256).optional()
});
export type SkillSubtask = z.infer<typeof SkillSubtaskSchema>;

export const ActionPolicySchema = z.object({
  mode: ActionPolicyModeSchema,
  /** Allow read-only/scroll actions to continue automatically after one approval per run. */
  allowLowRiskRunApproval: z.boolean().default(true),
  /** Allow navigation clicks under the per-run low-risk opt-in. */
  allowNavigationRunApproval: z.boolean().default(false),
  /** Typing always requires approval showing the exact text. Not user-configurable in the alpha. */
  requireTypingApproval: z.literal(true).default(true),
  neverAutoSend: z.literal(true).default(true)
});
export type ActionPolicy = z.infer<typeof ActionPolicySchema>;

export const SkillCorrectionSchema = z.object({
  ts: TimestampMsSchema,
  field: z.string().max(64),
  note: z.string().max(500),
  fromVersion: z.number().int().positive()
});

export const SkillSchema = z.object({
  id: IdSchema,
  version: z.number().int().positive(),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(""),
  trigger: z.string().min(1).max(500),
  preconditions: z.array(z.string().max(300)).max(10).default([]),
  variables: z.array(VariableSlotSchema).max(20).default([]),
  subtasks: z.array(SkillSubtaskSchema).min(1).max(30),
  allowedApps: z.array(z.string().max(256)).default([]),
  allowedDomains: z.array(z.string().max(253)).default([]),
  policy: ActionPolicySchema,
  maxSteps: z.number().int().min(1).max(200).default(60),
  timeoutMs: DurationMsSchema.default(20 * 60 * 1000),
  riskClass: RiskClassSchema.default("unknown"),
  evidence: z.object({
    episodeIds: z.array(IdSchema).default([]),
    candidateId: IdSchema.optional(),
    taughtRange: z.object({ startTs: TimestampMsSchema, endTs: TimestampMsSchema }).optional()
  }),
  corrections: z.array(SkillCorrectionSchema).default([]),
  successCriteria: z.array(z.string().max(300)).max(10).default([]),
  source: z.enum(["taught", "candidate", "imported", "demo"]),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
  archived: z.boolean().default(false)
});
export type Skill = z.infer<typeof SkillSchema>;

/** Model or deterministic output used to seed a skill editor. */
export const SkillDraftSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(""),
  goal: z.string().max(500).default(""),
  trigger: z.string().min(1).max(500),
  subtasks: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        goal: z.string().min(1).max(500),
        completionCriteria: z.string().min(1).max(500),
        keySteps: z.array(z.string().max(300)).max(20).default([]),
        appOrDomain: z.string().max(256).optional()
      })
    )
    .min(1)
    .max(30),
  variables: z.array(VariableSlotSchema).max(20).default([]),
  successCriteria: z.array(z.string().max(300)).max(10).default([]),
  riskNotes: z.array(z.string().max(300)).max(10).default([]),
  allowedApps: z.array(z.string().max(256)).default([]),
  allowedDomains: z.array(z.string().max(253)).default([]),
  origin: z.enum(["deterministic", "model_refined"]),
  confidence: z.number().min(0).max(1).default(0.5)
});
export type SkillDraft = z.infer<typeof SkillDraftSchema>;
