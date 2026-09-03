import { desktopCapturer, nativeImage, screen } from "electron";
import type { HelperClient } from "../services/helper/types.js";
import type { PngResizer } from "../services/images/png-resize.js";
import type { Logger } from "../services/logger.js";
import { HelperScreenSource, type ScreenSource } from "../services/observation/screen-source.js";
import type { SettingsStore } from "../services/settings-store.js";
import { WindowScreenSource, type DesktopCapturerLike, type ScreenLike } from "../services/observation/window-screen-source.js";

/** nativeImage-backed resize used for model inputs and OCR downscaling. */
export const electronPngResizer: PngResizer = async (png, width, height) => {
  const image = nativeImage.createFromBuffer(png);
  const resized = image.resize({ width, height, quality: "best" });
  const size = resized.getSize();
  return { png: resized.toPNG(), width: size.width, height: size.height };
};

export interface ElectronScreenSourceOptions {
  readonly helper: HelperClient;
  readonly settings: SettingsStore;
  readonly logger: Logger;
}

/**
 * The real capture path: the injectable ladder in
 * `services/observation/window-screen-source.ts` bound to Electron's
 * `desktopCapturer` and `screen`. Nothing else in the app imports those, so the
 * ladder stays unit testable.
 */
export function createElectronScreenSource(options: ElectronScreenSourceOptions): ScreenSource {
  return new WindowScreenSource({
    helper: options.helper,
    capturer: desktopCapturer as unknown as DesktopCapturerLike,
    screen: screen as unknown as ScreenLike,
    logger: options.logger,
    helperSource: new HelperScreenSource(options.helper),
    preferHelper: () => options.settings.get().captureViaHelper
  });
}
