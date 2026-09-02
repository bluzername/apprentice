/**
 * Typed IPC contract between the renderer (React) and the Electron main
 * process. The preload script exposes exactly these channels and nothing else.
 * Every request and response is validated with these schemas in main.
 */
import { z } from "zod";
import { IdSchema, TimestampMsSchema } from "./common.js";
import { ActivityEventSchema, ScreenshotRecordSchema } from "./events.js";
import { EpisodeSchema } from "./episodes.js";
import { CandidateUserActionSchema, WorkflowCandidateSchema } from "./candidates.js";
import { SkillDraftSchema, SkillSchema, ActionPolicyModeSchema } from "./skills.js";
import { RunSchema, RunStepSchema } from "./runs.js";
import { ApprovalScopeSchema, ProposedActionSchema, RiskResultSchema } from "./actions.js";
import {
  FeedbackAnswersSchema,
  FeedbackSchema,
  ProductEventNameSchema,
  ProductEventPropsSchema,
  RemoteFeedbackPayloadSchema
} from "./feedback.js";
import {
  AppSettingsSchema,
  SettingsPatchSchema,
  HardwareInfoSchema,
  LearningStateSchema,
  MenuBarStatusSchema,
  PermissionsStatusSchema
} from "./settings.js";
import { ModelEndpointConfigSchema, ModelHealthSchema, ModelStatusSchema } from "./model.js";
import { ExtensionStatusSchema } from "./extension-protocol.js";

const Void = z.undefined().or(z.null()).optional();

export const ActivityQuerySchema = z.object({
  fromTs: TimestampMsSchema.optional(),
  toTs: TimestampMsSchema.optional(),
  app: z.string().max(256).optional(),
  domain: z.string().max(253).optional(),
  types: z.array(z.string().max(48)).optional(),
  limit: z.number().int().min(1).max(5000).default(500)
});

export const TeachRangeSchema = z.object({
  startTs: TimestampMsSchema,
  endTs: TimestampMsSchema,
  excludedEventIds: z.array(IdSchema).default([])
});

export const PrivacyStatsSchema = z.object({
  eventCount: z.number().int().nonnegative(),
  screenshotCount: z.number().int().nonnegative(),
  ocrCount: z.number().int().nonnegative(),
  episodeCount: z.number().int().nonnegative(),
  candidateCount: z.number().int().nonnegative(),
  skillCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
  feedbackCount: z.number().int().nonnegative(),
  storedBytes: z.number().int().nonnegative(),
  screenshotBytes: z.number().int().nonnegative(),
  databaseBytes: z.number().int().nonnegative(),
  dataDirectory: z.string(),
  activeExclusions: z.array(z.string().max(256)),
  queuedUploads: z.number().int().nonnegative()
});
export type PrivacyStats = z.infer<typeof PrivacyStatsSchema>;

export const OverviewSchema = z.object({
  learningState: LearningStateSchema,
  menuBarStatus: MenuBarStatusSchema,
  modelStatus: ModelStatusSchema,
  hoursObserved: z.number().nonnegative(),
  candidateCount: z.number().int().nonnegative(),
  skillCount: z.number().int().nonnegative(),
  estimatedWeeklyMinutes: z.number().nonnegative(),
  recentCandidate: WorkflowCandidateSchema.nullable(),
  recentRun: RunSchema.nullable(),
  permissions: PermissionsStatusSchema,
  demoMode: z.boolean(),
  helperConnected: z.boolean(),
  extensionPaired: z.boolean(),
  pendingPulseDay: z.union([z.literal(1), z.literal(3), z.literal(7)]).nullable()
});
export type Overview = z.infer<typeof OverviewSchema>;

export const ApprovalRequestSchema = z.object({
  runId: IdSchema,
  stepId: IdSchema,
  stepIndex: z.number().int().nonnegative(),
  subtaskIndex: z.number().int().nonnegative(),
  subtaskTitle: z.string().max(120),
  proposed: ProposedActionSchema,
  risk: RiskResultSchema,
  screenshotPngBase64: z.string(),
  screenshotWidth: z.number().int().positive(),
  screenshotHeight: z.number().int().positive(),
  /** Annotated target in screenshot pixel coordinates when applicable. */
  target: z.object({ x: z.number(), y: z.number(), label: z.string().max(160).optional() }).nullable(),
  actionSummary: z.string().max(300),
  rationale: z.string().max(500),
  canApproveRunLowRisk: z.boolean(),
  requestedAt: TimestampMsSchema
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const RunDetailSchema = z.object({
  run: RunSchema,
  steps: z.array(RunStepSchema),
  pendingApproval: ApprovalRequestSchema.nullable(),
  pendingQuestion: z.object({ stepId: IdSchema, question: z.string().max(500) }).nullable()
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const ExportResultSchema = z.object({
  path: z.string(),
  byteLength: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  includesScreenshots: z.boolean()
});

export const DemoStatusSchema = z.object({
  loaded: z.boolean(),
  daysSimulated: z.number().int().nonnegative(),
  scenario: z.array(z.string().max(64))
});

export const DiagnosticsPreviewSchema = z.object({
  files: z.array(z.object({ name: z.string(), byteLength: z.number().int().nonnegative(), preview: z.string().max(4000) })),
  redactedFields: z.array(z.string().max(64))
});

/**
 * Each entry: request schema and response schema. Keys are channel names.
 */
export const ipcContract = {
  "app:version": { request: Void, response: z.object({ version: z.string(), productName: z.string(), helperVersion: z.string().optional() }) },
  "app:overview": { request: Void, response: OverviewSchema },
  "app:hardware": { request: Void, response: HardwareInfoSchema },
  "app:openDataFolder": { request: Void, response: z.object({ ok: z.boolean() }) },
  "app:openExternal": { request: z.object({ url: z.string().url() }), response: z.object({ ok: z.boolean() }) },
  "app:revealPath": { request: z.object({ path: z.string() }), response: z.object({ ok: z.boolean() }) },

  "settings:get": { request: Void, response: AppSettingsSchema },
  "settings:update": { request: SettingsPatchSchema, response: AppSettingsSchema },
  "settings:completeOnboarding": { request: Void, response: AppSettingsSchema },

  "permissions:status": { request: Void, response: PermissionsStatusSchema },
  "permissions:request": { request: z.object({ kind: z.enum(["accessibility", "screenRecording"]) }), response: PermissionsStatusSchema },
  "permissions:openSettings": { request: z.object({ kind: z.enum(["accessibility", "screenRecording"]) }), response: z.object({ ok: z.boolean() }) },

  "learning:setState": {
    request: z.object({ state: LearningStateSchema, pauseMinutes: z.number().int().min(1).max(1440).optional() }),
    response: z.object({ state: LearningStateSchema, menuBarStatus: MenuBarStatusSchema, pausedUntil: z.number().int().optional() })
  },
  "learning:status": { request: Void, response: z.object({ state: LearningStateSchema, menuBarStatus: MenuBarStatusSchema, pausedUntil: z.number().int().optional() }) },

  "activity:list": { request: ActivityQuerySchema, response: z.object({ events: z.array(ActivityEventSchema), screenshots: z.array(ScreenshotRecordSchema) }) },
  "activity:deleteEvents": { request: z.object({ eventIds: z.array(IdSchema).min(1).max(5000) }), response: z.object({ deleted: z.number().int() }) },
  "activity:deleteRange": { request: z.object({ fromTs: TimestampMsSchema, toTs: TimestampMsSchema }), response: z.object({ deleted: z.number().int() }) },
  "screenshot:get": { request: z.object({ id: IdSchema }), response: z.object({ pngBase64: z.string(), width: z.number().int(), height: z.number().int() }) },

  "episodes:list": { request: z.object({ limit: z.number().int().min(1).max(500).default(100) }), response: z.array(EpisodeSchema) },
  "episodes:resegment": { request: Void, response: z.object({ episodes: z.number().int(), candidates: z.number().int() }) },

  "teach:openRange": {
    request: z.object({ minutes: z.number().int().min(1).max(240).default(15) }),
    response: z.object({ startTs: TimestampMsSchema, endTs: TimestampMsSchema, events: z.array(ActivityEventSchema), screenshots: z.array(ScreenshotRecordSchema) })
  },
  "teach:draft": { request: TeachRangeSchema, response: z.object({ draft: SkillDraftSchema, retained: z.object({ eventCount: z.number().int(), screenshotCount: z.number().int(), fields: z.array(z.string()) }) }) },
  "teach:save": { request: z.object({ draft: SkillDraftSchema, range: TeachRangeSchema, mode: ActionPolicyModeSchema.default("guide") }), response: SkillSchema },

  "candidates:list": { request: z.object({ includeSuppressed: z.boolean().default(false) }), response: z.array(WorkflowCandidateSchema) },
  "candidates:get": { request: z.object({ id: IdSchema }), response: z.object({ candidate: WorkflowCandidateSchema, evidence: z.array(z.object({ episode: EpisodeSchema, events: z.array(ActivityEventSchema) })) }) },
  "candidates:act": { request: z.object({ id: IdSchema, action: CandidateUserActionSchema }), response: z.object({ candidate: WorkflowCandidateSchema, skill: SkillSchema.nullable(), run: RunSchema.nullable() }) },
  "candidates:draft": { request: z.object({ id: IdSchema }), response: SkillDraftSchema },

  "skills:list": { request: Void, response: z.array(SkillSchema) },
  "skills:get": { request: z.object({ id: IdSchema }), response: z.object({ skill: SkillSchema, history: z.array(SkillSchema) }) },
  "skills:save": { request: z.object({ skill: SkillSchema, correctionNote: z.string().max(500).optional() }), response: SkillSchema },
  "skills:delete": { request: z.object({ id: IdSchema }), response: z.object({ deleted: z.boolean() }) },

  "runs:start": { request: z.object({ skillId: IdSchema, mode: ActionPolicyModeSchema.optional(), variables: z.record(z.string(), z.string().max(500)).default({}) }), response: RunSchema },
  "runs:list": { request: z.object({ limit: z.number().int().min(1).max(200).default(50) }), response: z.array(RunSchema) },
  "runs:get": { request: z.object({ id: IdSchema }), response: RunDetailSchema },
  "runs:approve": { request: z.object({ runId: IdSchema, stepId: IdSchema, decision: z.enum(["approved", "rejected"]), scope: ApprovalScopeSchema.default("once") }), response: RunDetailSchema },
  "runs:answer": { request: z.object({ runId: IdSchema, stepId: IdSchema, answer: z.string().max(500), confirmSubtask: z.boolean().default(false) }), response: RunDetailSchema },
  "runs:stop": { request: z.object({ runId: IdSchema }), response: RunDetailSchema },
  "runs:exportDiagnostics": { request: z.object({ runId: IdSchema }), response: ExportResultSchema },
  "runs:previewDiagnostics": { request: z.object({ runId: IdSchema }), response: DiagnosticsPreviewSchema },

  "feedback:submit": { request: z.object({ contextType: z.enum(["candidate", "run", "pulse", "general"]), contextId: IdSchema, answers: FeedbackAnswersSchema, comment: z.string().max(2000).optional() }), response: FeedbackSchema },
  "feedback:list": { request: Void, response: z.array(FeedbackSchema) },
  "feedback:previewPayload": { request: Void, response: z.object({ payload: RemoteFeedbackPayloadSchema, removedFields: z.array(z.string()), byteLength: z.number().int() }) },
  "feedback:upload": { request: Void, response: z.object({ ok: z.boolean(), uploaded: z.number().int(), message: z.string().max(500).optional() }) },
  "feedback:export": { request: z.object({ includeRunId: IdSchema.optional(), screenshotIds: z.array(IdSchema).default([]) }), response: ExportResultSchema },
  "feedback:dismissPulse": { request: z.object({ day: z.union([z.literal(1), z.literal(3), z.literal(7)]) }), response: z.object({ ok: z.boolean() }) },

  "privacy:stats": { request: Void, response: PrivacyStatsSchema },
  "privacy:deleteToday": { request: Void, response: z.object({ deletedEvents: z.number().int(), deletedScreenshots: z.number().int() }) },
  "privacy:deleteSkillData": { request: z.object({ skillId: IdSchema }), response: z.object({ ok: z.boolean() }) },
  "privacy:deleteAll": { request: z.object({ confirmPhrase: z.string(), includeSharedModelFiles: z.boolean().default(false) }), response: z.object({ ok: z.boolean(), removedPaths: z.array(z.string()) }) },
  "privacy:retentionRun": { request: Void, response: z.object({ deletedScreenshots: z.number().int(), deletedOcr: z.number().int(), deletedEvents: z.number().int() }) },

  "model:status": { request: Void, response: ModelStatusSchema },
  "model:testConnection": { request: ModelEndpointConfigSchema.omit({ hasApiKey: true }).extend({ apiKey: z.string().max(512).optional() }), response: ModelHealthSchema },
  "model:configure": { request: z.object({ providerType: z.enum(["mock", "openai_compatible", "uimate"]), endpoint: ModelEndpointConfigSchema.omit({ hasApiKey: true, providerType: true }).extend({ apiKey: z.string().max(512).optional() }).optional(), managedRuntime: z.boolean().default(false) }), response: ModelStatusSchema },
  "model:runtime": { request: z.object({ action: z.enum(["installRuntime", "installModel", "start", "stop", "restart", "cancelDownload"]), confirmed: z.boolean().default(false) }), response: ModelStatusSchema },
  "model:runtimeInfo": { request: Void, response: z.object({ runtimeRelease: z.string(), runtimeSha256: z.string(), modelRepo: z.string(), modelQuant: z.string(), modelFile: z.string(), modelSha256: z.string(), mmprojFile: z.string(), mmprojSha256: z.string(), expectedBytes: z.number(), license: z.string(), sourceUrl: z.string(), runtimeUrl: z.string() }) },
  "model:stopAll": { request: Void, response: ModelStatusSchema },

  "demo:load": { request: z.object({ days: z.number().int().min(1).max(14).default(3), scenarios: z.array(z.enum(["post_meeting_followup", "invoice_processing", "candidate_review"])).optional() }), response: DemoStatusSchema },
  "demo:reset": { request: Void, response: DemoStatusSchema },
  "demo:status": { request: Void, response: DemoStatusSchema },

  "extension:status": { request: Void, response: ExtensionStatusSchema },
  "extension:pairingCode": { request: Void, response: z.object({ code: z.string(), expiresAt: TimestampMsSchema, port: z.number().int() }) },
  "extension:unpair": { request: Void, response: ExtensionStatusSchema },

  "analytics:track": { request: z.object({ name: ProductEventNameSchema, props: ProductEventPropsSchema.default({}) }), response: z.object({ ok: z.boolean() }) },
  "analytics:list": { request: z.object({ limit: z.number().int().min(1).max(1000).default(200) }), response: z.array(z.unknown()) },
  "perf:metrics": { request: Void, response: z.record(z.string(), z.number()) }
} as const;

export type IpcContract = typeof ipcContract;
export type IpcChannel = keyof IpcContract;
export type IpcRequest<C extends IpcChannel> = z.input<IpcContract[C]["request"]>;
export type IpcResponse<C extends IpcChannel> = z.output<IpcContract[C]["response"]>;

/** Events pushed from main to renderer. */
export const ipcEvents = {
  "event:learning": z.object({ state: LearningStateSchema, menuBarStatus: MenuBarStatusSchema, pausedUntil: z.number().int().optional() }),
  "event:activity": z.object({ events: z.array(ActivityEventSchema) }),
  "event:candidate": z.object({ candidate: WorkflowCandidateSchema }),
  "event:run": z.object({ detail: RunDetailSchema }),
  "event:approvalRequest": ApprovalRequestSchema,
  "event:model": ModelStatusSchema,
  "event:modelHealth": ModelHealthSchema,
  "event:teachShortcut": z.object({ ts: TimestampMsSchema }),
  "event:helper": z.object({ connected: z.boolean(), restarts: z.number().int(), message: z.string().max(300).optional() }),
  "event:extension": ExtensionStatusSchema,
  "event:navigate": z.object({ route: z.string().max(64) }),
  "event:toast": z.object({ kind: z.enum(["info", "success", "warning", "error"]), message: z.string().max(300) })
} as const;
export type IpcEvents = typeof ipcEvents;
export type IpcEventName = keyof IpcEvents;
export type IpcEventPayload<E extends IpcEventName> = z.output<IpcEvents[E]>;

export const IPC_CHANNELS = Object.keys(ipcContract) as IpcChannel[];
export const IPC_EVENT_NAMES = Object.keys(ipcEvents) as IpcEventName[];
