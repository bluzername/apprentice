import { desktopCapturer, shell, systemPreferences } from "electron";
import type { ShellAdapter } from "../services/composition.js";
import { settingsUrlFor, type PermissionState, type PermissionSystem } from "../services/permissions.js";

const MEDIA_STATUS: Readonly<Record<string, PermissionState>> = {
  granted: "granted",
  denied: "denied",
  restricted: "denied",
  "not-determined": "not_determined",
  unknown: "unknown"
};

/** TCC status through the APIs that share desktopCapturer's identity (ADR 0002). */
export function createElectronPermissionSystem(): PermissionSystem {
  return {
    screenAccessStatus: () => MEDIA_STATUS[systemPreferences.getMediaAccessStatus("screen")] ?? "unknown",
    isTrustedAccessibilityClient: (prompt) => systemPreferences.isTrustedAccessibilityClient(prompt),
    requestScreenAccess: async () => {
      // A capture attempt is what makes macOS show the Screen Recording prompt.
      await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } }).catch(() => []);
    },
    openSettings: (kind) => shell.openExternal(settingsUrlFor(kind))
  };
}

export function createElectronShell(): ShellAdapter {
  return {
    openExternal: (url) => shell.openExternal(url),
    openPath: async (path) => {
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
    },
    showItemInFolder: (path) => shell.showItemInFolder(path)
  };
}
