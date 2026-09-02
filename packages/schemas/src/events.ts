import { z } from "zod";
import {
  AppRefSchema,
  DurationMsSchema,
  EventSourceSchema,
  IdSchema,
  PrivacyClassificationSchema,
  RedactionStateSchema,
  SemanticElementSchema,
  TimestampMsSchema
} from "./common.js";

export const ActivityEventTypeSchema = z.enum([
  "session_start",
  "session_end",
  "app_activated",
  "window_title_changed",
  "mouse_down",
  "shortcut",
  "clipboard_changed",
  "idle_changed",
  "secure_field_focused",
  "navigation",
  "click",
  "form_submit",
  "field_input",
  "copy",
  "paste",
  "download",
  "page_title",
  "teach_marker",
  "privacy_gap",
  "screenshot_captured",
  "run_step",
  "learning_state_changed"
]);
export type ActivityEventType = z.infer<typeof ActivityEventTypeSchema>;

/** Small, bounded primitive payload. Never free text longer than a label. */
export const EventPayloadValueSchema = z.union([
  z.string().max(160),
  z.number(),
  z.boolean(),
  z.array(z.string().max(32)).max(8)
]);

export const EventPayloadSchema = z.record(z.string().max(48), EventPayloadValueSchema);
export type EventPayload = z.infer<typeof EventPayloadSchema>;

export const ActivityEventSchema = z.object({
  id: IdSchema,
  ts: TimestampMsSchema,
  seq: z.number().int().nonnegative(),
  sessionId: IdSchema,
  source: EventSourceSchema,
  type: ActivityEventTypeSchema,
  app: AppRefSchema.optional(),
  domain: z.string().max(253).optional(),
  routePattern: z.string().max(256).optional(),
  element: SemanticElementSchema.optional(),
  screenshotRef: IdSchema.optional(),
  ocrRef: IdSchema.optional(),
  privacy: PrivacyClassificationSchema,
  redaction: RedactionStateSchema,
  activeDurationMs: DurationMsSchema.optional(),
  parentEventId: IdSchema.optional(),
  payload: EventPayloadSchema.optional()
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const ActivityEventListSchema = z.array(ActivityEventSchema);

export const ScreenshotReasonSchema = z.enum([
  "app_change",
  "window_change",
  "navigation",
  "click",
  "form_submit",
  "teach_marker",
  "run_step",
  "interval",
  "demo"
]);
export type ScreenshotReason = z.infer<typeof ScreenshotReasonSchema>;

/** Screenshot metadata stored in the index (file content is encrypted separately). */
export const ScreenshotRecordSchema = z.object({
  id: IdSchema,
  ts: TimestampMsSchema,
  sessionId: IdSchema,
  eventId: IdSchema.optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  displayScale: z.number().positive(),
  perceptualHash: z.string().max(64),
  byteLength: z.number().int().nonnegative(),
  reason: ScreenshotReasonSchema,
  analyzed: z.boolean().default(false),
  app: AppRefSchema.optional(),
  domain: z.string().max(253).optional()
});
export type ScreenshotRecord = z.infer<typeof ScreenshotRecordSchema>;

export const OcrBlockSchema = z.object({
  text: z.string().max(512),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  confidence: z.number().min(0).max(1)
});
export type OcrBlock = z.infer<typeof OcrBlockSchema>;

export const OcrResultSchema = z.object({
  id: IdSchema,
  screenshotId: IdSchema,
  ts: TimestampMsSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blocks: z.array(OcrBlockSchema).max(2000)
});
export type OcrResult = z.infer<typeof OcrResultSchema>;
