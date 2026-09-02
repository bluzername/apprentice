/**
 * Typed message contract between content scripts, the popup, and the
 * background service worker. Every message crossing a boundary is validated
 * with these schemas before it is acted on.
 */
import { z } from "zod";
import { AllowlistResponseSchema, ExtensionEventSchema } from "@apprentice/schemas";

export const LearningStateSchema = AllowlistResponseSchema.shape.learningState;
export type LearningState = z.infer<typeof LearningStateSchema>;

const DomainSchema = z.string().min(1).max(253);
const PathSchema = z.string().max(512);

/** Messages sent from a content script to the background worker. */
export const ContentToBackgroundMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("content:hello"), domain: DomainSchema, path: PathSchema }).strict(),
  z.object({ type: z.literal("content:event"), event: ExtensionEventSchema }).strict(),
  z
    .object({
      type: z.literal("content:dom-state"),
      marker: z.string().max(160),
      present: z.boolean(),
      domain: DomainSchema.optional(),
      path: PathSchema.optional()
    })
    .strict()
]);

/** Messages sent from the popup to the background worker. */
export const PopupToBackgroundMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("popup:status") }).strict(),
  z.object({ type: z.literal("popup:pair"), code: z.string().regex(/^[0-9]{6}$/) }).strict(),
  z.object({ type: z.literal("popup:unpair") }).strict(),
  z.object({ type: z.literal("popup:set-local-pause"), paused: z.boolean() }).strict(),
  z.object({ type: z.literal("popup:sync") }).strict()
]);

export const InboundMessageSchema = z.union([ContentToBackgroundMessageSchema, PopupToBackgroundMessageSchema]);
export type ContentToBackgroundMessage = z.infer<typeof ContentToBackgroundMessageSchema>;
export type PopupToBackgroundMessage = z.infer<typeof PopupToBackgroundMessageSchema>;
export type InboundMessage = z.infer<typeof InboundMessageSchema>;

/** Messages sent from the background worker to content scripts. */
export const BackgroundToContentMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("content:start") }).strict(),
  z.object({ type: z.literal("content:stop") }).strict(),
  z.object({ type: z.literal("content:dom-query"), marker: z.string().max(160) }).strict()
]);
export type BackgroundToContentMessage = z.infer<typeof BackgroundToContentMessageSchema>;

/** Response to `content:hello`. */
export const HelloResponseSchema = z.object({ ok: z.literal(true), capture: z.boolean() });
export type HelloResponse = z.infer<typeof HelloResponseSchema>;

/** Response to `content:dom-query`, produced by the content script. */
export const DomQueryReplySchema = z.object({
  present: z.boolean(),
  domain: DomainSchema.optional(),
  path: PathSchema.optional()
});
export type DomQueryReply = z.infer<typeof DomQueryReplySchema>;

export const PopupStatusSchema = z.object({
  ok: z.literal(true),
  paired: z.boolean(),
  port: z.number().int().nullable(),
  browser: z.string(),
  extensionId: z.string().nullable(),
  learningState: LearningStateSchema.nullable(),
  captureEnabled: z.boolean(),
  localPaused: z.boolean(),
  allowlist: z.array(DomainSchema),
  grantedDomains: z.array(DomainSchema),
  lastSync: z.number().int().nullable(),
  productName: z.string(),
  stats: z.object({
    eventsSent: z.number().int().nonnegative(),
    eventsDropped: z.number().int().nonnegative(),
    batchesFailed: z.number().int().nonnegative(),
    lastError: z.string().nullable()
  })
});
export type PopupStatus = z.infer<typeof PopupStatusSchema>;

export const ErrorResponseSchema = z.object({ ok: z.literal(false), error: z.string() });
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const GenericOkSchema = z.object({ ok: z.literal(true) });

export function errorResponse(error: string): ErrorResponse {
  return { ok: false, error };
}

export function isErrorResponse(value: unknown): value is ErrorResponse {
  return ErrorResponseSchema.safeParse(value).success;
}
