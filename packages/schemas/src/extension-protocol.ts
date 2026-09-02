/**
 * Loopback protocol between the Chromium extension and the desktop app.
 * The app binds only to 127.0.0.1. Every non-pairing request carries a bearer
 * token issued during pairing and is validated against the extension origin.
 */
import { z } from "zod";
import { EXTENSION_PROTOCOL_VERSION } from "./branding.js";
import { SemanticElementSchema } from "./common.js";

export const PairRequestSchema = z
  .object({
    code: z.string().regex(/^[0-9]{6}$/),
    extensionId: z.string().regex(/^[a-p]{32}$/),
    browser: z.enum(["chrome", "arc", "brave", "edge", "chromium", "unknown"]),
    protocolVersion: z.literal(EXTENSION_PROTOCOL_VERSION)
  })
  .strict();
export type PairRequest = z.infer<typeof PairRequestSchema>;

export const PairResponseSchema = z.object({
  token: z.string().min(32),
  protocolVersion: z.literal(EXTENSION_PROTOCOL_VERSION),
  productName: z.string()
});
export type PairResponse = z.infer<typeof PairResponseSchema>;

export const ExtensionEventTypeSchema = z.enum([
  "navigation",
  "page_title",
  "click",
  "form_submit",
  "field_input",
  "copy",
  "paste",
  "download",
  "sensitive_pause",
  "sensitive_resume"
]);
export type ExtensionEventType = z.infer<typeof ExtensionEventTypeSchema>;

export const ExtensionEventSchema = z
  .object({
    id: z.string().min(1).max(64),
    ts: z.number().int().nonnegative(),
    type: ExtensionEventTypeSchema,
    /** Registrable domain, already lower-cased. */
    domain: z.string().min(1).max(253),
    /** Path with query/fragment stripped; the app normalizes further. */
    path: z.string().max(512).optional(),
    /** Truncated page title; encrypted at rest by the app. */
    title: z.string().max(160).optional(),
    element: SemanticElementSchema.optional(),
    formPurpose: z.enum(["search", "login", "message", "create", "update", "checkout", "upload", "unknown"]).optional(),
    fieldLabel: z.string().max(80).optional(),
    valueLength: z.number().int().nonnegative().max(100000).optional(),
    filenameMeta: z
      .object({ extension: z.string().max(16), length: z.number().int().nonnegative() })
      .optional(),
    sensitiveReason: z.enum(["password_field", "sensitive_page", "private_window", "denied_domain"]).optional()
  })
  .strict();
export type ExtensionEvent = z.infer<typeof ExtensionEventSchema>;

export const ExtensionEventBatchSchema = z
  .object({
    protocolVersion: z.literal(EXTENSION_PROTOCOL_VERSION),
    events: z.array(ExtensionEventSchema).min(1).max(200)
  })
  .strict();
export type ExtensionEventBatch = z.infer<typeof ExtensionEventBatchSchema>;

export const ExtensionEventBatchResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative()
});

export const AllowlistResponseSchema = z.object({
  domains: z.array(z.string().max(253)),
  learningState: z.enum(["learning", "paused", "private", "stopped"]),
  captureEnabled: z.boolean(),
  productName: z.string(),
  /** True while an assisted run is active, so the extension polls for DOM queries. */
  runActive: z.boolean().default(false)
});
export type AllowlistResponse = z.infer<typeof AllowlistResponseSchema>;

export const ExtensionStatusSchema = z.object({
  paired: z.boolean(),
  extensionId: z.string().optional(),
  browser: z.string().optional(),
  lastSeenTs: z.number().int().optional(),
  eventsReceived: z.number().int().nonnegative(),
  port: z.number().int().optional()
});
export type ExtensionStatus = z.infer<typeof ExtensionStatusSchema>;

/** DOM state probe used by run verification. */
export const DomStateQuerySchema = z.object({
  marker: z.string().max(160)
});
export const DomStateResultSchema = z.object({
  marker: z.string().max(160),
  present: z.boolean(),
  domain: z.string().max(253).optional(),
  path: z.string().max(512).optional()
});
export type DomStateResult = z.infer<typeof DomStateResultSchema>;

/** GET /v1/dom-query response: the pending query for the extension, or null. */
export const DomQueryResponseSchema = z.object({ query: DomStateQuerySchema.nullable() });
/** POST /v1/dom-state response. */
export const DomStateAckSchema = z.object({ ok: z.boolean() });
