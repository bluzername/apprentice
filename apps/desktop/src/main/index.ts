/**
 * Electron entry point. Keeps the Electron surface thin: single instance,
 * hardened web-contents policy, then either the headless smoke test or the
 * full app boot (`electron/boot.ts`).
 */
import { app, session } from "electron";
import { join } from "node:path";
import { createFakeProtector } from "./security/keys.js";
import { resolveDataPaths } from "./paths.js";
import { createSafeStorageProtector } from "./electron/protector.js";
import { bootApp, type BootedApp } from "./electron/boot.js";
import { detectLaunchMode } from "./headless/mode.js";
import { runSmokeTest } from "./headless/smoke.js";
import { resolveFixturesDir } from "./services/demo/fixture-source.js";
import { resolveHelperExecutable } from "./services/helper/helper-client.js";

const MAIN_DIR = __dirname;
const RESOURCES_DIR = app.isPackaged ? process.resourcesPath : join(MAIN_DIR, "../../resources");
const mode = detectLaunchMode(process.argv, process.env);

function hardenWebContents(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, url) => {
      const allowedDev = process.env.ELECTRON_RENDERER_URL;
      if (!(allowedDev && url.startsWith(allowedDev)) && !url.startsWith("file://")) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
}

async function runHeadlessSmoke(): Promise<never> {
  const paths = resolveDataPaths();
  const real = createSafeStorageProtector();
  const protector = real.isEncryptionAvailable() ? real : createFakeProtector();
  const result = await runSmokeTest({
    dataDir: paths.root,
    fixturesDir: resolveFixturesDir({ resourcesPath: app.isPackaged ? process.resourcesPath : undefined, startDir: MAIN_DIR }),
    protector,
    helperBinaryPath: resolveHelperExecutable({ resourcesPath: app.isPackaged ? process.resourcesPath : undefined, devResourcesDir: RESOURCES_DIR })
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  app.exit(result.ok ? 0 : 1);
  return new Promise<never>(() => undefined);
}

if (mode !== "smoke" && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let booted: BootedApp | null = null;
  app.on("second-instance", () => booted?.showWindow());
  app.on("window-all-closed", () => {
    // The tray keeps the app alive while learning; otherwise quit like a regular app.
    if (booted && booted.services.learning.state() !== "learning") app.quit();
  });
  let shuttingDown = false;
  app.on("before-quit", (event) => {
    if (shuttingDown || !booted) return;
    event.preventDefault();
    shuttingDown = true;
    void booted.shutdown().finally(() => app.quit());
  });
  void app.whenReady().then(async () => {
    hardenWebContents();
    if (mode === "smoke") {
      await runHeadlessSmoke();
      return;
    }
    try {
      booted = await bootApp({ mainDir: MAIN_DIR, resourcesDir: RESOURCES_DIR, e2e: mode === "e2e" });
    } catch (error) {
      console.error("[main] boot failed:", error instanceof Error ? error.stack ?? error.message : String(error));
      app.exit(1);
    }
  });
}
