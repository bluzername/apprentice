import type { PermissionsStatus } from "@apprentice/schemas";
import type { Analytics } from "./analytics.js";
import type { HelperClient } from "./helper/types.js";
import type { Logger } from "./logger.js";

export type PermissionKind = "accessibility" | "screenRecording";
export type PermissionState = PermissionsStatus["accessibility"];

/** OS-level permission probes; Electron supplies systemPreferences/desktopCapturer/shell. */
export interface PermissionSystem {
  screenAccessStatus(): PermissionState;
  isTrustedAccessibilityClient(prompt: boolean): boolean;
  requestScreenAccess(): Promise<void>;
  openSettings(kind: PermissionKind): Promise<void>;
}

/** Test/headless system: everything granted, settings never opened. */
export function createGrantedPermissionSystem(): PermissionSystem & { opened: PermissionKind[] } {
  const opened: PermissionKind[] = [];
  return {
    opened,
    screenAccessStatus: () => "granted",
    isTrustedAccessibilityClient: () => true,
    requestScreenAccess: async () => undefined,
    openSettings: async (kind) => {
      opened.push(kind);
    }
  };
}

const SETTINGS_URLS: Readonly<Record<PermissionKind, string>> = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screenRecording: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
};

export function settingsUrlFor(kind: PermissionKind): string {
  return SETTINGS_URLS[kind];
}

function merge(primary: PermissionState, secondary: PermissionState | undefined): PermissionState {
  if (primary === "granted" || secondary === "granted") return "granted";
  if (primary === "denied" || secondary === "denied") return "denied";
  if (primary === "not_determined" || secondary === "not_determined") return "not_determined";
  return "unknown";
}

/** Combines Electron's view of TCC with the helper's, and records grant/deny transitions. */
export class PermissionsService {
  private last: Partial<Record<PermissionKind, PermissionState>> = {};

  constructor(
    private readonly deps: {
      readonly helper: HelperClient;
      readonly system: PermissionSystem;
      readonly analytics: Analytics;
      readonly logger: Logger;
    }
  ) {}

  async status(): Promise<PermissionsStatus> {
    const helperStatus = this.deps.helper.connected
      ? await this.deps.helper.permissionStatus().catch((error: unknown) => {
          this.deps.logger.warn("helper permissionStatus failed", { error: error instanceof Error ? error.message : String(error) });
          return null;
        })
      : null;
    const accessibility = merge(this.deps.system.isTrustedAccessibilityClient(false) ? "granted" : "not_determined", helperStatus?.accessibility);
    const screenRecording = merge(this.deps.system.screenAccessStatus(), helperStatus?.screenRecording);
    const status: PermissionsStatus = { accessibility, screenRecording, helperAvailable: this.deps.helper.connected };
    this.trackTransitions(status);
    return status;
  }

  async request(kind: PermissionKind): Promise<PermissionsStatus> {
    if (kind === "accessibility") {
      if (this.deps.helper.connected) {
        await this.deps.helper.requestAccessibilityPermission().catch((error: unknown) => {
          this.deps.logger.warn("helper accessibility prompt failed", { error: error instanceof Error ? error.message : String(error) });
        });
      }
      this.deps.system.isTrustedAccessibilityClient(true);
    } else {
      if (this.deps.helper.connected) {
        await this.deps.helper.requestScreenRecordingPermission().catch((error: unknown) => {
          this.deps.logger.warn("helper screen recording prompt failed", { error: error instanceof Error ? error.message : String(error) });
        });
      }
      await this.deps.system.requestScreenAccess();
    }
    return this.status();
  }

  async openSettings(kind: PermissionKind): Promise<void> {
    await this.deps.system.openSettings(kind);
  }

  private trackTransitions(status: PermissionsStatus): void {
    for (const kind of ["accessibility", "screenRecording"] as const) {
      const previous = this.last[kind];
      const next = status[kind];
      if (previous !== next && (next === "granted" || next === "denied")) {
        this.deps.analytics.track(next === "granted" ? "permission_granted" : "permission_denied", { kind });
      }
      this.last = { ...this.last, [kind]: next };
    }
  }
}
