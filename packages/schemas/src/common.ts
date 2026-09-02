import { z } from "zod";

export const IdSchema = z.string().min(1).max(128);
export const TimestampMsSchema = z.number().int().nonnegative();
export const DurationMsSchema = z.number().int().nonnegative();
export const UnitIntervalSchema = z.number().min(0).max(1);
export const ShortTextSchema = z.string().max(512);
export const MediumTextSchema = z.string().max(4000);

export const EventSourceSchema = z.enum(["native_helper", "extension", "user", "model", "system"]);
export type EventSource = z.infer<typeof EventSourceSchema>;

export const PrivacyClassificationSchema = z.enum([
  "allowed",
  "privacy_gap",
  "sensitive",
  "excluded"
]);
export type PrivacyClassification = z.infer<typeof PrivacyClassificationSchema>;

export const RedactionStateSchema = z.enum(["none_needed", "redacted", "raw_pending"]);
export type RedactionState = z.infer<typeof RedactionStateSchema>;

export const AppRefSchema = z.object({
  bundleId: z.string().max(256).optional(),
  name: z.string().max(128).optional()
});
export type AppRef = z.infer<typeof AppRefSchema>;

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative()
});
export type Rect = z.infer<typeof RectSchema>;

export const PointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof PointSchema>;

export const SizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive()
});
export type Size = z.infer<typeof SizeSchema>;

/**
 * Describes how a screenshot was resized for the model and how to map
 * coordinates back to display points.
 */
export const ImageTransformSchema = z.object({
  originalWidth: z.number().int().positive(),
  originalHeight: z.number().int().positive(),
  resizedWidth: z.number().int().positive(),
  resizedHeight: z.number().int().positive(),
  /** Backing scale factor of the display (2 on Retina). */
  displayScale: z.number().positive(),
  /** Window or display origin in display points. */
  originX: z.number(),
  originY: z.number(),
  displayId: z.string().optional(),
  windowId: z.number().int().optional()
});
export type ImageTransform = z.infer<typeof ImageTransformSchema>;

export const SemanticElementSchema = z.object({
  role: z.string().max(64).optional(),
  tag: z.string().max(32).optional(),
  ariaLabel: z.string().max(160).optional(),
  name: z.string().max(160).optional(),
  text: z.string().max(80).optional(),
  identifier: z.string().max(160).optional(),
  fingerprint: z.string().max(128).optional()
});
export type SemanticElement = z.infer<typeof SemanticElementSchema>;
