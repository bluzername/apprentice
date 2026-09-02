/**
 * Placeholder boot used while the full main process is assembled. It opens a
 * secure BrowserWindow so the renderer can be built and previewed.
 */
import { app, BrowserWindow } from "electron";
import { join } from "node:path";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  win.once("ready-to-show", () => win.show());
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

void app.whenReady().then(() => {
  createWindow();
});
app.on("window-all-closed", () => app.quit());
