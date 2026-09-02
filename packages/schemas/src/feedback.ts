import { z } from "zod";
import { IdSchema, TimestampMsSchema } from "./common.js";
import { FailureCategorySchema } from "./runs.js";
import { RiskClassSchema } from "./actions.js";
import { FEEDBACK_PAYLOAD_VERSION } from "./branding.js";

export const BoundaryAccuracySchema = z.enum([
  "correct",
  "started_too_early",
  "started_too_late",
  "ended_too_early",
  "ended_too_late"
]);

export const RejectionReasonCodeSchema = z.enum([
  "not_a_workflow",
  "too_rare",
  "too_simple",
  "too_risky",
  "wrong_steps",
  "private",
  "already_automated",
  "prefer_manual",
  "other"
]);

export const CandidateFeedbackAnswersSchema = z.object({
  kind: z.literal("candidate"),
  relevant: z.boolean(),
  wouldDelegate: z.enum(["yes", "maybe", "no"]),
  boundaryAccuracy: BoundaryAccuracySchema,
  reasonCodes: z.array(RejectionReasonCodeSchema).max(9).default([])
});

export const RunFeedbackAnswersSchema = z.object({
  kind: z.literal("run"),
  outcomeAchieved: z.enum(["yes", "partly", "no"]),
  corrections: z.number().int().min(0).max(999),
  estimatedTimeSavedMinutes: z.number().min(0).max(600),
  trustRating: z.number().int().min(1).max(5),
  wouldUseAgain: z.boolean(),
  failureCategory: FailureCategorySchema
});

export const PulseFeedbackAnswersSchema = z.object({
  kind: z.literal("pulse"),
  day: z.union([z.literal(1), z.literal(3), z.literal(7)]),
  stillUsing: z.boolean(),
  mostUseful: z.enum(["candidates", "teaching", "guided_runs", "privacy_controls", "nothing_yet"]),
  biggestConcern: z.enum(["privacy", "accuracy", "speed", "usefulness", "setup", "none"]),
  recommendScore: z.number().int().min(0).max(10)
});

export const GeneralFeedbackAnswersSchema = z.object({
  kind: z.literal("general"),
  sentiment: z.enum(["positive", "neutral", "negative"])
});

export const FeedbackAnswersSchema = z.discriminatedUnion("kind", [
  CandidateFeedbackAnswersSchema,
  RunFeedbackAnswersSchema,
  PulseFeedbackAnswersSchema,
  GeneralFeedbackAnswersSchema
]);
export type FeedbackAnswers = z.infer<typeof FeedbackAnswersSchema>;

export const UploadStatusSchema = z.enum(["local_only", "queued", "uploaded", "failed", "exported"]);

export const PerformanceMetricsSchema = z.object({
  captureLatencyMs: z.number().nonnegative().optional(),
  encryptionLatencyMs: z.number().nonnegative().optional(),
  queueDelayMs: z.number().nonnegative().optional(),
  modelFirstResponseMs: z.number().nonnegative().optional(),
  stepLatencyMs: z.number().nonnegative().optional(),
  peakQueueSize: z.number().int().nonnegative().optional(),
  helperRestarts: z.number().int().nonnegative().optional()
});
export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;

export const FeedbackSchema = z.object({
  id: IdSchema,
  contextType: z.enum(["candidate", "run", "pulse", "general"]),
  contextId: IdSchema,
  answers: FeedbackAnswersSchema,
  comment: z.string().max(2000).optional(),
  consent: z.object({
    localStored: z.literal(true).default(true),
    remoteUpload: z.boolean().default(false),
    commentWarningShown: z.boolean().default(false)
  }),
  sanitization: z.object({
    ok: z.boolean(),
    removedFields: z.array(z.string().max(64)).default([])
  }),
  uploadStatus: UploadStatusSchema,
  appVersion: z.string().max(32),
  modelInfo: z.object({
    provider: z.string().max(64),
    model: z.string().max(128).optional(),
    version: z.string().max(64).optional()
  }),
  performance: PerformanceMetricsSchema.default({}),
  createdAt: TimestampMsSchema
});
export type Feedback = z.infer<typeof FeedbackSchema>;

// ---------------------------------------------------------------------------
// Local product analytics events (strict, no free text)
// ---------------------------------------------------------------------------
export const ProductEventNameSchema = z.enum([
  "onboarding_step_completed",
  "onboarding_completed",
  "permission_granted",
  "permission_denied",
  "learning_started",
  "learning_paused",
  "learning_private",
  "learning_stopped",
  "candidate_generated",
  "candidate_viewed",
  "candidate_accepted",
  "candidate_edited",
  "candidate_rejected",
  "teach_started",
  "teach_saved",
  "teach_cancelled",
  "skill_saved",
  "skill_deleted",
  "run_started",
  "run_completed",
  "run_failed",
  "run_interrupted",
  "action_approved",
  "action_rejected",
  "feedback_submitted",
  "feedback_uploaded",
  "export_created",
  "data_deleted",
  "model_configured",
  "model_health_checked",
  "helper_restarted",
  "demo_loaded",
  "app_launched"
]);
export type ProductEventName = z.infer<typeof ProductEventNameSchema>;

/** Property values: numbers, booleans, or short enum-like tokens. No free text. */
export const AnalyticsTokenSchema = z.string().max(64).regex(/^[a-z0-9_.:-]+$/i);
export const ProductEventPropsSchema = z.record(
  z.string().max(48).regex(/^[a-zA-Z0-9_]+$/),
  z.union([z.number(), z.boolean(), AnalyticsTokenSchema])
);

export const ProductEventSchema = z.object({
  id: IdSchema,
  ts: TimestampMsSchema,
  name: ProductEventNameSchema,
  props: ProductEventPropsSchema.default({}),
  riskClass: RiskClassSchema.optional(),
  installationId: IdSchema,
  sessionId: IdSchema.optional()
});
export type ProductEvent = z.infer<typeof ProductEventSchema>;

// ---------------------------------------------------------------------------
// Optional remote payload (strict allowlist; forbidden keys are rejected)
// ---------------------------------------------------------------------------
export const FORBIDDEN_REMOTE_KEYS = [
  "screenshot", "screenshots", "image", "png", "ocr", "ocrText", "url", "urls", "domain", "domains",
  "title", "windowTitle", "pageTitle", "clipboard", "typedText", "text", "transcript",
  "document", "body", "message", "messages", "email", "emails", "name", "names",
  "filename", "filenames", "path", "prompt", "response", "reasoning", "thinking", "html", "dom"
] as const;

export const MemoryBucketSchema = z.enum(["lt16", "16", "24", "32", "48plus", "unknown"]);
export const ChipFamilySchema = z.enum(["m1", "m2", "m3", "m4", "m5", "apple_other", "unknown"]);

export const RemoteEventSchema = z
  .object({
    name: ProductEventNameSchema,
    ts: TimestampMsSchema,
    counts: z.record(z.string().max(48).regex(/^[a-zA-Z0-9_]+$/), z.number()).default({}),
    riskClass: RiskClassSchema.optional(),
    provider: z.string().max(64).optional()
  })
  .strict();

export const RemoteFeedbackItemSchema = z
  .object({
    contextType: z.enum(["candidate", "run", "pulse", "general"]),
    answers: FeedbackAnswersSchema,
    comment: z.string().max(2000).optional(),
    createdAt: TimestampMsSchema
  })
  .strict();

export const RemoteFeedbackPayloadSchema = z
  .object({
    schemaVersion: z.literal(FEEDBACK_PAYLOAD_VERSION),
    installationId: z.string().regex(/^[a-f0-9]{16,64}$/),
    participantCode: z.string().max(32).regex(/^[A-Za-z0-9_-]*$/).optional(),
    appVersion: z.string().max(32),
    macosMajor: z.number().int().min(14).max(40),
    chipFamily: ChipFamilySchema,
    memoryBucket: MemoryBucketSchema,
    provider: z.string().max(64),
    model: z.string().max(128).optional(),
    modelVersion: z.string().max(64).optional(),
    events: z.array(RemoteEventSchema).max(500).default([]),
    feedback: z.array(RemoteFeedbackItemSchema).max(100).default([]),
    performance: PerformanceMetricsSchema.optional()
  })
  .strict();
export type RemoteFeedbackPayload = z.infer<typeof RemoteFeedbackPayloadSchema>;

export const TelemetryBatchSchema = z
  .object({
    schemaVersion: z.literal(FEEDBACK_PAYLOAD_VERSION),
    installationId: z.string().regex(/^[a-f0-9]{16,64}$/),
    appVersion: z.string().max(32),
    events: z.array(RemoteEventSchema).min(1).max(500)
  })
  .strict();
export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>;

/** Export bundle manifest. */
export const FeedbackBundleManifestSchema = z.object({
  bundleVersion: z.literal(1),
  productId: z.string().max(64),
  installationId: z.string().regex(/^[a-f0-9]{16,64}$/),
  participantCode: z.string().max(32).optional(),
  createdAt: TimestampMsSchema,
  appVersion: z.string().max(32),
  files: z.array(z.string().regex(/^[a-zA-Z0-9_./-]+$/)),
  includesScreenshots: z.boolean(),
  screenshotCount: z.number().int().nonnegative().default(0)
});
export type FeedbackBundleManifest = z.infer<typeof FeedbackBundleManifestSchema>;
