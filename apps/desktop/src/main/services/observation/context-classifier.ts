import { classifyContext } from "@apprentice/core";
import type { PrivacyClassification } from "@apprentice/schemas";
import type { SettingsStore } from "../settings-store.js";

export interface ContextClassifierInput {
  readonly bundleId?: string;
  readonly domain?: string;
  readonly isSecureInput?: boolean;
}

/** The allowlist decision for a focus context, evaluated against the settings of the moment. */
export type ContextClassifier = (input: ContextClassifierInput) => PrivacyClassification;

/**
 * One allowlist decision shared by the observation pipeline (which decides
 * whether a capture may be requested) and the capture service (which re-checks
 * at the shutter, because the frontmost app can change in between).
 */
export function createContextClassifier(settings: SettingsStore, isCapturing: () => boolean): ContextClassifier {
  return (input) =>
    classifyContext({
      bundleId: input.bundleId,
      domain: input.domain,
      isSecureInput: input.isSecureInput,
      learningState: isCapturing() ? "learning" : "stopped",
      allowlist: settings.get().allowlist
    });
}
