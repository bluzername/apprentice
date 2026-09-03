import { app, BrowserWindow } from "electron";
import { join } from "node:path";

export interface MainWindowOptions {
  readonly preloadPath: string;
  readonly rendererUrl?: string;
  readonly rendererHtml: string;
  /** While true, closing hides the window to the tray instead of quitting. */
  readonly hideOnClose: () => boolean;
  readonly onHidden?: () => void;
}

/** Hardened BrowserWindow: context isolation, sandbox, no Node, no remote content. */
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: process.env.NODE_ENV === "development" || process.env.ELECTRON_RENDERER_URL !== undefined
    }
  });
  win.once("ready-to-show", () => win.show());
  win.on("close", (event) => {
    if (options.hideOnClose()) {
      event.preventDefault();
      win.hide();
      options.onHidden?.();
    }
  });
  if (options.rendererUrl) void win.loadURL(options.rendererUrl);
  else void win.loadFile(options.rendererHtml);
  return win;
}

export function rendererHtmlPath(mainDir: string): string {
  return join(mainDir, "../renderer/index.html");
}

/** Restores the main window (activate / dock click / tray). */
export function showWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

/**
 * Brings the window in front of the app the run is acting on: a run that
 * needs an approval or an answer must be seen even though another app is
 * active. The run engine re-activates the target app afterwards.
 */
export function raiseWindow(win: BrowserWindow | null): void {
  showWindow(win);
  if (!win || win.isDestroyed()) return;
  app.focus({ steal: true });
  win.moveTop();
}
