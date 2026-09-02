import { app, ipcMain, type BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createEventEmitter, registerIpcHandlers } from "../ipc/registry.js";
import { createIpcHandlers } from "../ipc/handlers.js";
import { createFakeProtector, type KeyProtector } from "../security/keys.js";
import { composeServices, type Services } from "../services/composition.js";
import { createFixtureSource, resolveFixturesDir } from "../services/demo/fixture-source.js";
import { FakeHelperClient } from "../services/helper/fake-helper-client.js";
import { ProcessHelperClient, resolveHelperExecutable } from "../services/helper/helper-client.js";
import type { HelperClient } from "../services/helper/types.js";
import { nodePngResizer } from "../services/images/png-resize.js";
import { FixtureScreenSource, type ScreenSource } from "../services/observation/screen-source.js";
import { createGrantedPermissionSystem } from "../services/permissions.js";
import { ElectronScreenSource, electronPngResizer } from "./capture.js";
import { createElectronPowerProbe } from "./power.js";
import { createSafeStorageProtector } from "./protector.js";
import { createShortcutController } from "./shortcuts.js";
import { createElectronPermissionSystem, createElectronShell } from "./system.js";
import { createTray } from "./tray.js";
import { createMainWindow, rendererHtmlPath, showWindow } from "./window.js";

export interface BootOptions {
  readonly mainDir: string;
  readonly resourcesDir: string;
  readonly e2e: boolean;
}

export interface BootedApp {
  readonly services: Services;
  showWindow(): void;
  shutdown(): Promise<void>;
}

function chooseProtector(allowFake: boolean): KeyProtector {
  const real = createSafeStorageProtector();
  if (real.isEncryptionAvailable()) return real;
  if (allowFake) return createFakeProtector();
  return real;
}

/** Wires Electron adapters into the service graph, then window, tray, shortcuts, and IPC. */
export async function bootApp(options: BootOptions): Promise<BootedApp> {
  const resourcesPath = app.isPackaged ? process.resourcesPath : undefined;
  const fixturesDir = resolveFixturesDir({ resourcesPath, startDir: options.mainDir });
  const helperPath = resolveHelperExecutable({ resourcesPath, devResourcesDir: options.resourcesDir });
  const helper: HelperClient = options.e2e
    ? new FakeHelperClient({ fixtureDelayScale: 0 })
    : new ProcessHelperClient({ executablePath: helperPath, logPath: join(process.env.APPRENTICE_DATA_DIR ?? app.getPath("appData"), "Apprentice", "logs", "helper.log") });
  const fixtures = createFixtureSource(fixturesDir);
  const screenSource: ScreenSource = options.e2e ? new FixtureScreenSource({ readPng: (name) => fixtures.readScreenshotPng(name), initial: "genericBlank" }) : new ElectronScreenSource(helper);
  const services = composeServices({
    protector: chooseProtector(options.e2e),
    helper,
    screenSource,
    permissionSystem: options.e2e ? createGrantedPermissionSystem() : createElectronPermissionSystem(),
    power: createElectronPowerProbe(),
    resizer: options.e2e ? nodePngResizer : electronPngResizer,
    fixturesDir,
    shell: createElectronShell(),
    settleMs: options.e2e ? 0 : undefined
  });
  const logger = services.context.logger.child("electron");
  if (!options.e2e && !existsSync(helperPath)) logger.warn("helper binary missing", { helperPath });

  let mainWindow: BrowserWindow | null = null;
  const windows = (): BrowserWindow[] => (mainWindow && !mainWindow.isDestroyed() ? [mainWindow] : []);
  services.hub.setSink(createEventEmitter(windows));
  const handlers = createIpcHandlers(services);
  registerIpcHandlers(ipcMain, handlers, (event) => windows().some((win) => win.webContents.id === event.sender.id));

  let quitting = false;
  const createWindow = (): BrowserWindow => {
    const win = createMainWindow({
      preloadPath: join(options.mainDir, "../preload/index.js"),
      rendererUrl: process.env.ELECTRON_RENDERER_URL,
      rendererHtml: rendererHtmlPath(options.mainDir),
      hideOnClose: () => !quitting && services.learning.state() === "learning"
    });
    win.on("closed", () => {
      if (mainWindow === win) mainWindow = null;
    });
    mainWindow = win;
    return win;
  };
  const show = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    showWindow(mainWindow);
  };
  const navigate = (route: string): void => {
    show();
    services.hub.emit("event:navigate", { route });
  };

  const shortcuts = createShortcutController({
    onTeach: () => {
      services.pipeline.insertTeachMarker();
      services.hub.emit("event:teachShortcut", { ts: Date.now() });
      navigate("teach");
    },
    onEscape: () => void services.runEngine.stopActive("user_escape")
  });
  const applyTeachShortcut = (): void => {
    const result = shortcuts.registerTeach(services.context.settings.get().shortcuts.teach);
    if (!result.ok) logger.warn("teach shortcut not registered", { message: result.message });
  };
  services.context.settings.onChange((next, previous) => {
    if (next.shortcuts.teach !== previous.shortcuts.teach) applyTeachShortcut();
  });

  const tray = createTray({
    iconPath: join(options.resourcesDir, "trayTemplate.png"),
    onAction: (action) => {
      const { learning, runEngine, model } = services;
      switch (action) {
        case "pause15":
          void learning.setState("paused", 15);
          break;
        case "pauseUntilResumed":
          void learning.setState("paused");
          break;
        case "private":
          void learning.setState("private");
          break;
        case "resume":
          void learning.setState("learning");
          break;
        case "teach":
          services.pipeline.insertTeachMarker();
          services.hub.emit("event:teachShortcut", { ts: Date.now() });
          navigate("teach");
          break;
        case "openDashboard":
          navigate("dashboard");
          break;
        case "stopRun":
          void runEngine.stopActive("menu_bar");
          break;
        case "stopModel":
          void model.stopAll();
          break;
        case "quit":
          quitting = true;
          app.quit();
          break;
      }
    }
  });
  const refreshTray = (): void => tray.update(services.learning.menuBarStatus(), services.runEngine.isActive());
  services.learning.onChange(refreshTray);
  services.hub.subscribe((name) => {
    if (name === "event:model" || name === "event:modelHealth") refreshTray();
  });
  services.onRunActiveChange((active) => {
    if (active) shortcuts.registerEscape();
    else shortcuts.unregisterEscape();
    refreshTray();
  });

  await services.start();
  applyTeachShortcut();
  refreshTray();
  createWindow();

  app.on("activate", () => show());
  app.on("before-quit", () => {
    quitting = true;
  });

  return {
    services,
    showWindow: show,
    shutdown: async () => {
      quitting = true;
      shortcuts.unregisterAll();
      tray.destroy();
      await services.shutdown();
    }
  };
}
