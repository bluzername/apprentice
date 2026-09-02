import {
  AccessibilityContextAtPointResultSchema,
  CapabilitiesResultSchema,
  CaptureResultSchema,
  FrontmostContextResultSchema,
  OcrImageResultSchema,
  PerformActionResultSchema,
  PermissionStatusResultSchema,
  type AccessibilityContextAtPointResult,
  type CapabilitiesResult,
  type CaptureResult,
  type ExecutableAction,
  type FrontmostContextResult,
  type HelperCommand,
  type HelperEvent,
  type OcrImageResult,
  type PermissionStatusResult
} from "@apprentice/schemas";
import { z } from "zod";
import {
  FocusedElementSchemaLoose,
  PingResultSchema,
  type HelperClient,
  type HelperRequestOptions,
  type HelperStateSnapshot,
  type PingResult,
  type StartObservationParams
} from "./types.js";

const EmergencyStopResultSchema = z.object({ stopped: z.boolean() });

/** Typed command surface shared by the process client and the fake. Subclasses provide `request`. */
export abstract class HelperClientBase implements HelperClient {
  protected eventListeners: ReadonlyArray<(event: HelperEvent) => void> = [];
  protected stateListeners: ReadonlyArray<(snapshot: HelperStateSnapshot) => void> = [];

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract get connected(): boolean;
  abstract get restarts(): number;
  abstract get available(): boolean;
  abstract snapshot(): HelperStateSnapshot;
  abstract request(cmd: HelperCommand, params?: Record<string, unknown>, options?: HelperRequestOptions): Promise<unknown>;

  onEvent(listener: (event: HelperEvent) => void): () => void {
    this.eventListeners = [...this.eventListeners, listener];
    return () => {
      this.eventListeners = this.eventListeners.filter((entry) => entry !== listener);
    };
  }

  onState(listener: (snapshot: HelperStateSnapshot) => void): () => void {
    this.stateListeners = [...this.stateListeners, listener];
    return () => {
      this.stateListeners = this.stateListeners.filter((entry) => entry !== listener);
    };
  }

  protected dispatchEvent(event: HelperEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  protected dispatchState(): void {
    const snapshot = this.snapshot();
    for (const listener of this.stateListeners) listener(snapshot);
  }

  private async typed<T>(schema: z.ZodType<T>, cmd: HelperCommand, params?: Record<string, unknown>, options?: HelperRequestOptions): Promise<T> {
    const raw = await this.request(cmd, params, options);
    return schema.parse(raw);
  }

  ping(): Promise<PingResult> {
    return this.typed(PingResultSchema, "ping", undefined, { timeoutMs: 3000 });
  }

  capabilities(): Promise<CapabilitiesResult> {
    return this.typed(CapabilitiesResultSchema, "capabilities");
  }

  permissionStatus(): Promise<PermissionStatusResult> {
    return this.typed(PermissionStatusResultSchema, "permissionStatus");
  }

  requestAccessibilityPermission(): Promise<PermissionStatusResult> {
    return this.typed(PermissionStatusResultSchema, "requestAccessibilityPermission", undefined, { timeoutMs: 60_000 });
  }

  requestScreenRecordingPermission(): Promise<PermissionStatusResult> {
    return this.typed(PermissionStatusResultSchema, "requestScreenRecordingPermission", undefined, { timeoutMs: 60_000 });
  }

  startObservation(params: StartObservationParams = {}): Promise<unknown> {
    return this.request("startObservation", { ...params });
  }

  stopObservation(): Promise<unknown> {
    return this.request("stopObservation");
  }

  frontmostContext(): Promise<FrontmostContextResult> {
    return this.typed(FrontmostContextResultSchema, "frontmostContext");
  }

  captureFrontmostWindow(): Promise<CaptureResult> {
    return this.typed(CaptureResultSchema, "captureFrontmostWindow", undefined, { timeoutMs: 20_000 });
  }

  ocrImage(pngBase64: string): Promise<OcrImageResult> {
    return this.typed(OcrImageResultSchema, "ocrImage", { pngBase64 }, { timeoutMs: 30_000 });
  }

  focusedElement(): Promise<z.infer<typeof FocusedElementSchemaLoose>> {
    return this.typed(FocusedElementSchemaLoose, "focusedElement");
  }

  accessibilityContextAtPoint(x: number, y: number): Promise<AccessibilityContextAtPointResult> {
    return this.typed(AccessibilityContextAtPointResultSchema, "accessibilityContextAtPoint", { x, y });
  }

  performAction(action: ExecutableAction, approvalToken: string): Promise<{ performed: boolean; durationMs: number }> {
    return this.typed(PerformActionResultSchema, "performAction", { action, approvalToken }, { timeoutMs: 30_000 });
  }

  emergencyStop(clear = false): Promise<{ stopped: boolean }> {
    return this.typed(EmergencyStopResultSchema, "emergencyStop", { clear }, { timeoutMs: 3000 });
  }
}
