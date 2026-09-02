import { Menu, Tray, nativeImage } from "electron";
import type { MenuBarStatus } from "@apprentice/schemas";
import { PRODUCT_NAME } from "@apprentice/schemas";

export type TrayAction = "pause15" | "pauseUntilResumed" | "private" | "resume" | "teach" | "openDashboard" | "stopRun" | "stopModel" | "quit";

export interface TrayController {
  update(status: MenuBarStatus, runActive: boolean): void;
  destroy(): void;
}

const STATUS_LABEL: Readonly<Record<MenuBarStatus, string>> = {
  learning: "Learning",
  paused: "Paused",
  private: "Private",
  processing_locally: "Processing locally",
  model_unavailable: "Model unavailable",
  stopped: "Stopped"
};

/** Menu bar item: status line plus the immediate actions from spec 4.2. */
export function createTray(options: { iconPath: string; onAction: (action: TrayAction) => void }): TrayController {
  const icon = nativeImage.createFromPath(options.iconPath);
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  const render = (status: MenuBarStatus, runActive: boolean): void => {
    const label = STATUS_LABEL[status];
    tray.setToolTip(`${PRODUCT_NAME}: ${label}`);
    tray.setTitle(status === "learning" ? "" : label);
    const menu = Menu.buildFromTemplate([
      { label: `${PRODUCT_NAME}: ${label}`, enabled: false },
      { type: "separator" },
      { label: "Pause for 15 minutes", click: () => options.onAction("pause15"), enabled: status !== "paused" && status !== "stopped" },
      { label: "Pause until resumed", click: () => options.onAction("pauseUntilResumed"), enabled: status !== "stopped" },
      { label: "Enter Private mode", click: () => options.onAction("private"), enabled: status !== "private" && status !== "stopped" },
      { label: "Resume learning", click: () => options.onAction("resume"), enabled: status !== "learning" && status !== "processing_locally" },
      { type: "separator" },
      { label: "Learn what I just did", click: () => options.onAction("teach") },
      { label: "Open dashboard", click: () => options.onAction("openDashboard") },
      ...(runActive ? [{ label: "Stop run", click: () => options.onAction("stopRun") }] : []),
      { label: "Stop all local model work", click: () => options.onAction("stopModel") },
      { type: "separator" as const },
      { label: `Quit ${PRODUCT_NAME}`, click: () => options.onAction("quit") }
    ]);
    tray.setContextMenu(menu);
  };
  render("stopped", false);
  return { update: render, destroy: () => tray.destroy() };
}
