import type {
  AccessibilityContextAtPointResult,
  ActivateAppResult,
  CapabilitiesResult,
  CaptureResult,
  ExecutableAction,
  FrontmostContextResult,
  HelperCommand,
  HelperEvent,
  OcrImageResult,
  PermissionStatusResult
} from "@apprentice/schemas";
import { z } from "zod";

export type HelperConnectionState = "stopped" | "starting" | "connected" | "restarting" | "failed";

export interface HelperStateSnapshot {
  readonly state: HelperConnectionState;
  readonly connected: boolean;
  readonly restarts: number;
  readonly message?: string;
}

export const PingResultSchema = z.object({ pong: z.boolean().default(true), ts: z.number().optional(), stopped: z.boolean().default(false) });
export type PingResult = z.infer<typeof PingResultSchema>;

export const FocusedElementSchemaLoose = z.object({ element: z.unknown().nullable(), bundleId: z.string().default("") });

export interface StartObservationParams {
  readonly fixturePath?: string;
  readonly idleThresholdSeconds?: number;
}

export class HelperError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "HelperError";
  }
}

export interface HelperRequestOptions {
  readonly timeoutMs?: number;
}

/** What every service sees; implemented by the process client and the in-process fake. */
export interface HelperClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly connected: boolean;
  readonly restarts: number;
  readonly available: boolean;
  /** Hex session secret shared with the running helper; approval tokens are HMACs under it. Null when this helper cannot verify tokens. */
  readonly approvalSecret: string | null;
  snapshot(): HelperStateSnapshot;
  onEvent(listener: (event: HelperEvent) => void): () => void;
  onState(listener: (snapshot: HelperStateSnapshot) => void): () => void;
  request(cmd: HelperCommand, params?: Record<string, unknown>, options?: HelperRequestOptions): Promise<unknown>;
  ping(): Promise<PingResult>;
  capabilities(): Promise<CapabilitiesResult>;
  permissionStatus(): Promise<PermissionStatusResult>;
  requestAccessibilityPermission(): Promise<PermissionStatusResult>;
  requestScreenRecordingPermission(): Promise<PermissionStatusResult>;
  startObservation(params?: StartObservationParams): Promise<unknown>;
  stopObservation(): Promise<unknown>;
  frontmostContext(): Promise<FrontmostContextResult>;
  captureFrontmostWindow(): Promise<CaptureResult>;
  ocrImage(pngBase64: string): Promise<OcrImageResult>;
  focusedElement(): Promise<z.infer<typeof FocusedElementSchemaLoose>>;
  accessibilityContextAtPoint(x: number, y: number): Promise<AccessibilityContextAtPointResult>;
  performAction(action: ExecutableAction, approvalToken: string): Promise<{ performed: boolean; durationMs: number }>;
  /** Brings `bundleId` to the front (launching it when installed but not running). Never performs input. */
  activateApp(bundleId: string): Promise<ActivateAppResult>;
  emergencyStop(clear?: boolean): Promise<{ stopped: boolean }>;
}
