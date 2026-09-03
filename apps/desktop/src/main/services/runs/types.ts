import type { ActivateAppResult, AxElement, DomStateResult, ExecutableAction, OcrBlock, ProposedActionResult, ProviderType, Skill, StepVerification, VerifyStepInput, NextActionInput } from "@apprentice/schemas";
import type { MetricsRecorder } from "@apprentice/core";
import type { StorageRef } from "../app-context.js";
import type { Clock } from "../clock.js";
import type { Emit } from "../events.js";
import type { Analytics } from "../analytics.js";
import type { PngResizer } from "../images/png-resize.js";
import type { Logger } from "../logger.js";
import type { ScreenSource } from "../observation/screen-source.js";
import type { SettingsStore } from "../settings-store.js";

/** Executes an approved action; the token is an HMAC over that exact action under the helper session secret. */
export interface Actuator {
  perform(action: ExecutableAction, approvalToken: string): Promise<{ performed: boolean; durationMs: number }>;
}

export interface RunContextSnapshot {
  readonly bundleId?: string;
  readonly appName?: string;
  readonly windowTitle?: string;
  readonly isSecureInput: boolean;
  readonly domain?: string;
  readonly path?: string;
  readonly domMarkers?: readonly string[];
}

export interface RunContextSource {
  frontmost(): Promise<RunContextSnapshot>;
}

/** Brings an app to the front so the run acts on it, not on the Apprentice window. Performs no input. */
export interface AppActivator {
  activate(bundleId: string): Promise<ActivateAppResult>;
}

/** OCR of an image; blocks are in that image's pixel space. */
export interface OcrSource {
  ocr(png: Buffer, width: number, height: number): Promise<readonly OcrBlock[]>;
}

export interface AxSource {
  elementAt(displayX: number, displayY: number): Promise<AxElement | null>;
}

export interface DomStateSource {
  query(marker: string, timeoutMs: number): Promise<DomStateResult | null>;
}

export interface ModelPort {
  propose(input: NextActionInput): Promise<ProposedActionResult>;
  verify(input: VerifyStepInput): Promise<StepVerification>;
  resetSession(sessionId: string): Promise<void>;
  providerType(): ProviderType;
  modelName(): string | undefined;
}

export interface RunEngineHooks {
  /** Lets demo mode install a scripted provider and screen timeline before the loop starts. */
  readonly beforeStart?: (skill: Skill, runId: string) => Promise<void> | void;
  readonly onActiveChange?: (active: boolean) => void;
  /** Fired when the run moves to the next subtask (demo mode advances its screen timeline). */
  readonly onSubtaskAdvance?: (runId: string, subtaskIndex: number) => void;
}

export interface RunEngineDeps {
  readonly storage: StorageRef;
  readonly settings: SettingsStore;
  readonly sessionId: string;
  readonly screenSource: ScreenSource;
  readonly actuator: () => Actuator;
  /** Current helper session secret used to mint approval tokens; null when no helper session can verify them. */
  readonly approvalSecret: () => string | null;
  readonly context: RunContextSource;
  readonly appActivator: AppActivator;
  /** Raises the Apprentice window on the run's detail view when an approval or a question needs the user. */
  readonly raiseWindow?: (runId: string) => void;
  readonly ocr: OcrSource;
  readonly ax: AxSource;
  readonly dom: DomStateSource;
  readonly model: ModelPort;
  readonly resizer: PngResizer;
  readonly emit: Emit;
  readonly analytics: Analytics;
  readonly metrics: MetricsRecorder;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly emergencyStop?: () => Promise<void>;
  readonly hooks?: RunEngineHooks;
  /** Delay after an action before the "after" capture (600 ms in production). */
  readonly settleMs?: number;
  readonly domQueryTimeoutMs?: number;
  /** How long to wait for the target app to come to the front after activateApp (1500 ms in production). */
  readonly activationWaitMs?: number;
  readonly activationPollMs?: number;
}

export type StopReason =
  | { readonly kind: "user"; readonly by: "user_escape" | "menu_bar" | "ui_stop" }
  | { readonly kind: "timeout" }
  | { readonly kind: "max_steps" };
