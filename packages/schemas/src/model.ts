/**
 * Replaceable model boundary. Renderer code never touches these; only the
 * main process talks to a provider.
 */
import { z } from "zod";
import { IdSchema, UnitIntervalSchema } from "./common.js";
import { ProposedActionSchema } from "./actions.js";
import { SkillDraftSchema } from "./skills.js";
import { VariableSlotSchema } from "./candidates.js";
import { StepVerificationSchema } from "./runs.js";

export const ProviderTypeSchema = z.enum(["mock", "openai_compatible", "uimate"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const ModelHealthSchema = z.object({
  ok: z.boolean(),
  provider: ProviderTypeSchema,
  model: z.string().max(128).optional(),
  endpoint: z.string().max(256).optional(),
  latencyMs: z.number().nonnegative().optional(),
  message: z.string().max(500).optional(),
  capabilities: z.object({
    vision: z.boolean(),
    actionPolicy: z.boolean(),
    structuredOutput: z.boolean()
  }),
  checkedAt: z.number().int().nonnegative()
});
export type ModelHealth = z.infer<typeof ModelHealthSchema>;

export const ModelImageSchema = z.object({
  id: IdSchema.optional(),
  pngBase64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive()
});
export type ModelImage = z.infer<typeof ModelImageSchema>;

export const AnalyzeEpisodeInputSchema = z.object({
  episodeId: IdSchema,
  redactedSummary: z.string().max(8000),
  actionTokens: z.array(z.string().max(512)).max(400),
  apps: z.array(z.string().max(256)),
  domains: z.array(z.string().max(253)),
  activeDurationMs: z.number().int().nonnegative(),
  screenshots: z.array(ModelImageSchema).max(2).default([])
});
export type AnalyzeEpisodeInput = z.infer<typeof AnalyzeEpisodeInputSchema>;

export const EpisodeAnalysisSchema = z.object({
  goal: z.string().max(500),
  trigger: z.string().max(500),
  stepGroups: z.array(z.object({ title: z.string().max(160), tokenIndexes: z.array(z.number().int().nonnegative()) })).max(30),
  variables: z.array(VariableSlotSchema).max(20),
  successCriteria: z.array(z.string().max(300)).max(10),
  riskNotes: z.array(z.string().max(300)).max(10),
  suggestedSkillName: z.string().max(120),
  confidence: UnitIntervalSchema,
  provider: ProviderTypeSchema,
  latencyMs: z.number().nonnegative()
});
export type EpisodeAnalysis = z.infer<typeof EpisodeAnalysisSchema>;

export const DraftSkillInputSchema = z.object({
  deterministicDraft: SkillDraftSchema,
  redactedSummary: z.string().max(8000),
  actionTokens: z.array(z.string().max(512)).max(400),
  screenshots: z.array(ModelImageSchema).max(2).default([])
});
export type DraftSkillInput = z.infer<typeof DraftSkillInputSchema>;

export const NextActionInputSchema = z.object({
  runId: IdSchema,
  sessionId: IdSchema,
  instruction: z.string().max(2000),
  skill: z.object({
    name: z.string().max(120),
    subtasks: z.array(
      z.object({
        title: z.string().max(120),
        goal: z.string().max(500),
        completionCriteria: z.string().max(500),
        keySteps: z.array(z.string().max(300)).max(20)
      })
    )
  }),
  currentSubtaskIndex: z.number().int().nonnegative(),
  priorActions: z.array(z.object({ stepIndex: z.number().int().nonnegative(), summary: z.string().max(300) })).max(200),
  screenshot: ModelImageSchema,
  platform: z.enum(["macos"]).default("macos"),
  variables: z.record(z.string().max(64), z.string().max(500)).default({})
});
export type NextActionInput = z.infer<typeof NextActionInputSchema>;

export const ProposedActionResultSchema = z.object({
  action: ProposedActionSchema.nullable(),
  actionSummary: z.string().max(300),
  rationale: z.string().max(500),
  controlToken: z.enum(["WAIT", "DONE", "FAIL", "SUBTASK_COMPLETE"]).optional(),
  subtaskCompleteEvidence: z.string().max(300).optional(),
  parseErrors: z.array(z.string().max(300)).default([]),
  latencyMs: z.number().nonnegative(),
  provider: ProviderTypeSchema
});
export type ProposedActionResult = z.infer<typeof ProposedActionResultSchema>;

export const VerifyStepInputSchema = z.object({
  runId: IdSchema,
  expectedResult: z.string().max(300),
  completionCriteria: z.string().max(500),
  before: ModelImageSchema.optional(),
  after: ModelImageSchema,
  ocrDiff: z.object({ added: z.array(z.string().max(200)).max(50), removed: z.array(z.string().max(200)).max(50) }).optional()
});
export type VerifyStepInput = z.infer<typeof VerifyStepInputSchema>;

export { StepVerificationSchema };

export const ModelEndpointConfigSchema = z.object({
  baseUrl: z.string().url().max(256),
  model: z.string().min(1).max(128),
  hasApiKey: z.boolean().default(false),
  providerType: ProviderTypeSchema,
  requestTimeoutMs: z.number().int().min(1000).max(600000).default(130000),
  imagesToKeep: z.number().int().min(1).max(10).default(2)
});
export type ModelEndpointConfig = z.infer<typeof ModelEndpointConfigSchema>;

export const LocalRuntimeStateSchema = z.object({
  runtimeInstalled: z.boolean(),
  runtimeVersion: z.string().optional(),
  modelInstalled: z.boolean(),
  modelPath: z.string().optional(),
  processState: z.enum(["stopped", "starting", "running", "stopping", "error"]),
  port: z.number().int().optional(),
  pid: z.number().int().optional(),
  lastError: z.string().max(500).optional(),
  download: z
    .object({
      active: z.boolean(),
      receivedBytes: z.number().nonnegative(),
      totalBytes: z.number().nonnegative().optional(),
      file: z.string().max(200).optional()
    })
    .optional(),
  logPath: z.string().optional()
});
export type LocalRuntimeState = z.infer<typeof LocalRuntimeStateSchema>;

export const ModelStatusSchema = z.object({
  providerType: ProviderTypeSchema,
  model: z.string().max(128).optional(),
  location: z.enum(["none", "local_managed", "local_external", "remote"]),
  health: ModelHealthSchema.nullable(),
  memoryRecommendation: z.string().max(200),
  runtime: LocalRuntimeStateSchema,
  queue: z.object({ pending: z.number().int().nonnegative(), active: z.number().int().nonnegative(), peak: z.number().int().nonnegative() }),
  lastLatencyMs: z.number().nonnegative().optional(),
  screenshotsUsed: z.number().int().nonnegative(),
  paused: z.boolean(),
  pauseReason: z.string().max(200).optional()
});
export type ModelStatus = z.infer<typeof ModelStatusSchema>;
