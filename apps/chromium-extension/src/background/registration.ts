/** Pure helpers for dynamic content-script registration decisions. */
import { CONTENT_SCRIPT_FILE, CONTENT_SCRIPT_ID_PREFIX } from "../shared/constants.js";
import { originPatternsForDomain, registrableDomain } from "../shared/url.js";

export interface RegistrationDiff {
  readonly toRegister: readonly string[];
  readonly toUnregister: readonly string[];
}

export function scriptIdForDomain(domain: string): string {
  return `${CONTENT_SCRIPT_ID_PREFIX}${registrableDomain(domain)}`;
}

export function domainFromScriptId(scriptId: string): string | null {
  return scriptId.startsWith(CONTENT_SCRIPT_ID_PREFIX) ? scriptId.slice(CONTENT_SCRIPT_ID_PREFIX.length) : null;
}

/** Compares the domains we want registered against the currently registered script ids. */
export function diffRegistrations(desiredDomains: readonly string[], registeredIds: readonly string[]): RegistrationDiff {
  const desiredIds = new Set(desiredDomains.map(scriptIdForDomain));
  const ours = registeredIds.filter((id) => id.startsWith(CONTENT_SCRIPT_ID_PREFIX));
  const registered = new Set(ours);
  return {
    toRegister: [...desiredIds].filter((id) => !registered.has(id)),
    toUnregister: ours.filter((id) => !desiredIds.has(id))
  };
}

export function contentScriptForDomain(domain: string): chrome.scripting.RegisteredContentScript {
  return {
    id: scriptIdForDomain(domain),
    js: [CONTENT_SCRIPT_FILE],
    matches: [...originPatternsForDomain(domain)],
    runAt: "document_idle",
    allFrames: false,
    persistAcrossSessions: true
  };
}

export interface CaptureGate {
  readonly paired: boolean;
  readonly captureEnabled: boolean;
  readonly learningState: string | null;
  readonly localPaused: boolean;
}

/** Capture is only allowed while paired, enabled by the app, learning, and not paused locally. */
export function captureAllowed(gate: CaptureGate): boolean {
  return gate.paired && gate.captureEnabled && gate.learningState === "learning" && !gate.localPaused;
}
