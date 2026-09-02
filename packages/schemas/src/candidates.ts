import { z } from "zod";
import { DurationMsSchema, IdSchema, TimestampMsSchema, UnitIntervalSchema } from "./common.js";
import { RiskClassSchema } from "./actions.js";

export const VariableSlotSchema = z.object({
  name: z.string().min(1).max(64),
  kind: z.enum(["text", "identifier", "date", "amount", "person", "file", "url_path", "unknown"]),
  description: z.string().max(256).optional(),
  examples: z.array(z.string().max(120)).max(6).default([]),
  required: z.boolean().default(true)
});
export type VariableSlot = z.infer<typeof VariableSlotSchema>;

export const CandidateStepSchema = z.object({
  index: z.number().int().nonnegative(),
  description: z.string().max(256),
  token: z.string().max(512),
  appOrDomain: z.string().max(256).optional(),
  occurrenceRatio: UnitIntervalSchema.default(1)
});
export type CandidateStep = z.infer<typeof CandidateStepSchema>;

export const ScoreComponentsSchema = z.object({
  sequenceSimilarity: UnitIntervalSchema,
  repeatCount: UnitIntervalSchema,
  triggerConsistency: UnitIntervalSchema,
  outcomeConsistency: UnitIntervalSchema,
  timeCost: UnitIntervalSchema,
  lowRiskCoverage: UnitIntervalSchema
});
export type ScoreComponents = z.infer<typeof ScoreComponentsSchema>;

export const SimilarityMetricsSchema = z.object({
  meanPairwise: UnitIntervalSchema,
  minPairwise: UnitIntervalSchema,
  weightedLcs: UnitIntervalSchema,
  editSimilarity: UnitIntervalSchema,
  appTransitionSimilarity: UnitIntervalSchema,
  durationConsistency: UnitIntervalSchema
});
export type SimilarityMetrics = z.infer<typeof SimilarityMetricsSchema>;

export const CandidateSuppressionStateSchema = z.enum([
  "active",
  "not_useful",
  "wrong_boundaries",
  "private",
  "already_automated",
  "never_learn",
  "converted",
  "consumption_suppressed"
]);
export type CandidateSuppressionState = z.infer<typeof CandidateSuppressionStateSchema>;

export const WorkflowCandidateSchema = z.object({
  id: IdSchema,
  source: z.enum(["passive", "taught"]),
  evidenceEpisodeIds: z.array(IdSchema).min(1),
  similarity: SimilarityMetricsSchema,
  repeatCount: z.number().int().positive(),
  medianDurationMs: DurationMsSchema,
  estimatedWeeklyFrequency: z.number().nonnegative(),
  estimatedWeeklyMinutes: z.number().nonnegative(),
  deterministicTitle: z.string().max(160),
  refinedTitle: z.string().max(160).optional(),
  refinedDescription: z.string().max(1000).optional(),
  trigger: z.string().max(512),
  steps: z.array(CandidateStepSchema),
  variables: z.array(VariableSlotSchema),
  expectedOutcome: z.string().max(512),
  confidence: UnitIntervalSchema,
  confidenceExplanation: z.string().max(1000),
  scoreComponents: ScoreComponentsSchema,
  riskClass: RiskClassSchema,
  suppression: z.object({
    state: CandidateSuppressionStateSchema,
    reason: z.string().max(256).optional(),
    ts: TimestampMsSchema.optional()
  }),
  apps: z.array(z.string().max(256)),
  domains: z.array(z.string().max(253)),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
  /** Signature used to avoid regenerating the same candidate. */
  patternKey: z.string().max(128)
});
export type WorkflowCandidate = z.infer<typeof WorkflowCandidateSchema>;

export const CandidateUserActionSchema = z.enum([
  "try_once",
  "edit_and_save",
  "not_useful",
  "wrong_boundaries",
  "private_workflow",
  "already_automated",
  "never_learn"
]);
export type CandidateUserAction = z.infer<typeof CandidateUserActionSchema>;
