import { z } from "zod";
import {
  ActivityEventSchema,
  AppRefSchema,
  IdSchema,
  ScreenshotReasonSchema,
  TimestampMsSchema
} from "@apprentice/schemas";

export const SCENARIO_NAMES = ["postMeetingFollowup", "invoiceProcessing", "candidateReview"] as const;
export const ScenarioNameSchema = z.enum(SCENARIO_NAMES);
export type ScenarioName = z.infer<typeof ScenarioNameSchema>;

export const TEMPLATE_NAMES = [
  "crmContact",
  "crmLogActivity",
  "mailCompose",
  "taskBoard",
  "notesPage",
  "invoiceEmail",
  "finderWindow",
  "previewPdf",
  "accountingUpload",
  "atsCandidate",
  "atsStatusDialog",
  "calendarSchedule",
  "chatMessage",
  "newsFeed",
  "genericBlank"
] as const;
export const TemplateNameSchema = z.enum(TEMPLATE_NAMES);
export type TemplateName = z.infer<typeof TemplateNameSchema>;

export const SCREEN_WIDTH = 1440;
export const SCREEN_HEIGHT = 900;

/** Links a generated event to the SVG fixture that stands in for its screenshot. */
export const ScreenshotFixtureRefSchema = z.object({
  id: IdSchema,
  eventId: IdSchema,
  ts: TimestampMsSchema,
  sessionId: IdSchema,
  fixtureName: TemplateNameSchema,
  reason: ScreenshotReasonSchema,
  app: AppRefSchema.optional(),
  domain: z.string().max(253).optional()
});
export type ScreenshotFixtureRef = z.infer<typeof ScreenshotFixtureRefSchema>;

export const ScreenshotFixtureSchema = ScreenshotFixtureRefSchema.extend({
  width: z.number().int().positive(),
  height: z.number().int().positive()
});
export type ScreenshotFixture = z.infer<typeof ScreenshotFixtureSchema>;

export const EpisodeExpectationSchema = z.object({
  apps: z.array(z.string()),
  domains: z.array(z.string()),
  outcomeType: z.string(),
  activeDurationMs: z.number().int().nonnegative()
});
export type EpisodeExpectation = z.infer<typeof EpisodeExpectationSchema>;

export const GeneratedEpisodeSchema = z.object({
  events: z.array(ActivityEventSchema),
  screenshotRefs: z.array(ScreenshotFixtureRefSchema),
  expected: EpisodeExpectationSchema
});
export type GeneratedEpisode = z.infer<typeof GeneratedEpisodeSchema>;

export interface GenerateEpisodeOptions {
  readonly seed: number;
  readonly occurrence: number;
  readonly startTs: number;
  readonly sessionId: string;
  readonly seqStart: number;
  readonly variant?: number;
}

export type ScenarioGenerator = (opts: GenerateEpisodeOptions) => GeneratedEpisode;

export const ScenarioOccurrenceSchema = z.object({
  scenario: ScenarioNameSchema,
  occurrence: z.number().int().positive(),
  variant: z.number().int().nonnegative(),
  sessionId: IdSchema,
  startTs: TimestampMsSchema,
  endTs: TimestampMsSchema,
  firstSeq: z.number().int().nonnegative(),
  lastSeq: z.number().int().nonnegative(),
  expected: EpisodeExpectationSchema
});
export type ScenarioOccurrence = z.infer<typeof ScenarioOccurrenceSchema>;

export const DemoSessionSchema = z.object({
  id: IdSchema,
  dayIndex: z.number().int().nonnegative(),
  startTs: TimestampMsSchema,
  endTs: TimestampMsSchema
});
export type DemoSession = z.infer<typeof DemoSessionSchema>;

export const DemoDatasetSchema = z.object({
  version: z.literal(1),
  seed: z.number().int(),
  days: z.number().int().positive(),
  startTs: TimestampMsSchema,
  endTs: TimestampMsSchema,
  sessions: z.array(DemoSessionSchema),
  events: z.array(ActivityEventSchema),
  screenshots: z.array(ScreenshotFixtureSchema),
  occurrences: z.array(ScenarioOccurrenceSchema),
  episodesExpected: z.record(ScenarioNameSchema, z.number().int().nonnegative()),
  fillerExpected: z.object({
    consumption: z.number().int().nonnegative(),
    sensitive: z.number().int().nonnegative(),
    privacyGapRuns: z.number().int().nonnegative()
  })
});
export type DemoDataset = z.infer<typeof DemoDatasetSchema>;

export const FixtureManifestEntrySchema = z.object({
  name: TemplateNameSchema,
  file: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  target: z.object({ label: z.string(), x: z.number(), y: z.number() })
});
export type FixtureManifestEntry = z.infer<typeof FixtureManifestEntrySchema>;

export const FixtureManifestSchema = z.object({
  version: z.literal(1),
  screenshots: z.array(FixtureManifestEntrySchema)
});
export type FixtureManifest = z.infer<typeof FixtureManifestSchema>;
