/**
 * JSON Lines protocol between the Electron main process and the native Swift
 * helper. Every line on stdout is exactly one JSON object: a response to a
 * request, or a streamed event. Logs never appear on stdout.
 */
import { z } from "zod";
import { HELPER_PROTOCOL_VERSION } from "./branding.js";
import { ExecutableActionSchema } from "./actions.js";
import { OcrBlockSchema } from "./events.js";
import { RectSchema } from "./common.js";

export const HelperCommandSchema = z.enum([
  "ping",
  "capabilities",
  "permissionStatus",
  "requestAccessibilityPermission",
  "requestScreenRecordingPermission",
  "startObservation",
  "stopObservation",
  "frontmostContext",
  "captureFrontmostWindow",
  "ocrImage",
  "focusedElement",
  "accessibilityContextAtPoint",
  "performAction",
  "emergencyStop",
  "shutdown"
]);
export type HelperCommand = z.infer<typeof HelperCommandSchema>;

export const HelperRequestSchema = z.object({
  id: z.string().min(1).max(64),
  v: z.literal(HELPER_PROTOCOL_VERSION),
  cmd: HelperCommandSchema,
  params: z.record(z.string(), z.unknown()).optional()
});
export type HelperRequest = z.infer<typeof HelperRequestSchema>;

export const HelperErrorCodeSchema = z.enum([
  "invalid_request",
  "unknown_command",
  "permission_denied",
  "not_available",
  "capture_failed",
  "ocr_failed",
  "action_rejected",
  "emergency_stopped",
  "internal"
]);

export const HelperResponseSchema = z.object({
  type: z.literal("response"),
  id: z.string().min(1).max(64),
  v: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: HelperErrorCodeSchema,
      message: z.string().max(1000)
    })
    .optional()
});
export type HelperResponse = z.infer<typeof HelperResponseSchema>;

export const HelperEventNameSchema = z.enum([
  "frontmostAppChanged",
  "windowTitleChanged",
  "mouseDown",
  "shortcut",
  "clipboardChanged",
  "idleChanged",
  "secureFieldFocused",
  "helperReady",
  "observationState"
]);
export type HelperEventName = z.infer<typeof HelperEventNameSchema>;

export const HelperEventSchema = z.object({
  type: z.literal("event"),
  v: z.string(),
  event: HelperEventNameSchema,
  ts: z.number().nonnegative(),
  seq: z.number().int().nonnegative(),
  data: z.record(z.string(), z.unknown()).default({})
});
export type HelperEvent = z.infer<typeof HelperEventSchema>;

export const HelperMessageSchema = z.discriminatedUnion("type", [HelperResponseSchema, HelperEventSchema]);
export type HelperMessage = z.infer<typeof HelperMessageSchema>;

// ---- Event payloads --------------------------------------------------------
export const FrontmostAppChangedDataSchema = z.object({
  bundleId: z.string().max(256).default(""),
  name: z.string().max(128).default(""),
  pid: z.number().int().nonnegative()
});
export const WindowTitleChangedDataSchema = z.object({
  bundleId: z.string().max(256).default(""),
  windowId: z.number().int().optional(),
  title: z.string().max(512).default("")
});
export const MouseDownDataSchema = z.object({
  x: z.number(),
  y: z.number(),
  button: z.enum(["left", "right", "middle"]),
  bundleId: z.string().max(256).default("")
});
export const ShortcutDataSchema = z.object({
  keys: z.array(z.string().max(16)).min(1).max(6),
  bundleId: z.string().max(256).default("")
});
export const ClipboardChangedDataSchema = z.object({ changeCount: z.number().int() });
export const IdleChangedDataSchema = z.object({ idle: z.boolean(), idleSeconds: z.number().nonnegative() });
export const SecureFieldFocusedDataSchema = z.object({
  bundleId: z.string().max(256).default(""),
  role: z.string().max(64).default("")
});

// ---- Command results -------------------------------------------------------
export const CapabilitiesResultSchema = z.object({
  helperVersion: z.string(),
  protocolVersion: z.string(),
  arch: z.string(),
  macosVersion: z.string(),
  features: z.object({
    accessibility: z.boolean(),
    screenCaptureKit: z.boolean(),
    cgEvents: z.boolean(),
    visionOcr: z.boolean(),
    fixtureStream: z.boolean()
  })
});
export type CapabilitiesResult = z.infer<typeof CapabilitiesResultSchema>;

export const PermissionStateSchema = z.enum(["granted", "denied", "not_determined", "unknown"]);
export const PermissionStatusResultSchema = z.object({
  accessibility: PermissionStateSchema,
  screenRecording: PermissionStateSchema,
  inputMonitoring: PermissionStateSchema.optional()
});
export type PermissionStatusResult = z.infer<typeof PermissionStatusResultSchema>;

export const FrontmostContextResultSchema = z.object({
  app: z.object({ bundleId: z.string().default(""), name: z.string().default(""), pid: z.number().int() }),
  window: z
    .object({
      id: z.number().int().optional(),
      title: z.string().max(512).default(""),
      bounds: RectSchema.optional()
    })
    .optional(),
  isSecureInput: z.boolean().default(false),
  isFullscreen: z.boolean().default(false),
  displayId: z.string().optional(),
  displayScale: z.number().positive().default(2)
});
export type FrontmostContextResult = z.infer<typeof FrontmostContextResultSchema>;

export const CaptureResultSchema = z.object({
  pngBase64: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  displayScale: z.number().positive(),
  bounds: RectSchema,
  windowId: z.number().int().optional(),
  displayId: z.string().optional(),
  method: z.enum(["screencapturekit", "cgwindowlist", "fixture"])
});
export type CaptureResult = z.infer<typeof CaptureResultSchema>;

export const OcrImageParamsSchema = z.object({ pngBase64: z.string().min(1) });
export const OcrImageResultSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blocks: z.array(OcrBlockSchema)
});
export type OcrImageResult = z.infer<typeof OcrImageResultSchema>;

/** Where AxElement.name came from: "self" is the element's own label; the others are neighbours in the AX tree. */
export const AxNameSourceSchema = z.enum(["self", "descendant", "ancestor"]);
export type AxNameSource = z.infer<typeof AxNameSourceSchema>;

export const AxElementSchema = z.object({
  role: z.string().max(64).default(""),
  subrole: z.string().max(64).optional(),
  title: z.string().max(256).optional(),
  description: z.string().max(256).optional(),
  identifier: z.string().max(256).optional(),
  /** Display name chosen by the helper (own label, labelled descendant, or titled ancestor). Never a field value. */
  name: z.string().max(256).optional(),
  nameSource: AxNameSourceSchema.optional(),
  value: z.string().max(0).optional(),
  valueLength: z.number().int().nonnegative().optional(),
  isSecure: z.boolean().default(false),
  enabled: z.boolean().default(true),
  bounds: RectSchema.optional()
});
export type AxElement = z.infer<typeof AxElementSchema>;

export const FocusedElementResultSchema = z.object({
  element: AxElementSchema.nullable(),
  bundleId: z.string().default("")
});

export const AccessibilityContextAtPointParamsSchema = z.object({ x: z.number(), y: z.number() });
export const AccessibilityContextAtPointResultSchema = z.object({
  element: AxElementSchema.nullable(),
  ancestors: z.array(z.object({ role: z.string().max(64), title: z.string().max(256).optional() })).max(12),
  bundleId: z.string().default("")
});
export type AccessibilityContextAtPointResult = z.infer<typeof AccessibilityContextAtPointResultSchema>;

export const PerformActionParamsSchema = z.object({
  action: ExecutableActionSchema,
  /** Token issued by the app when the action was approved. The helper refuses without it. */
  approvalToken: z.string().min(8).max(128)
});
export type PerformActionParams = z.infer<typeof PerformActionParamsSchema>;

export const PerformActionResultSchema = z.object({
  performed: z.boolean(),
  durationMs: z.number().nonnegative()
});

export const StartObservationParamsSchema = z.object({
  /** When set, the helper replays this JSONL fixture instead of observing. */
  fixturePath: z.string().optional(),
  idleThresholdSeconds: z.number().positive().default(240)
});
