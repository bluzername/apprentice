import { desktopCapturer, nativeImage, screen } from "electron";
import type { HelperClient } from "../services/helper/types.js";
import type { PngResizer } from "../services/images/png-resize.js";
import type { ScreenCapture, ScreenSource } from "../services/observation/screen-source.js";

/** nativeImage-backed resize used for model inputs and OCR downscaling. */
export const electronPngResizer: PngResizer = async (png, width, height) => {
  const image = nativeImage.createFromBuffer(png);
  const resized = image.resize({ width, height, quality: "best" });
  const size = resized.getSize();
  return { png: resized.toPNG(), width: size.width, height: size.height };
};

/**
 * Default capture path (ADR 0002): desktopCapturer grabs the display that hosts
 * the frontmost window, then the image is cropped to the helper-reported
 * window bounds so only the frontmost window is kept.
 */
export class ElectronScreenSource implements ScreenSource {
  constructor(private readonly helper: HelperClient) {}

  async captureFrontmost(): Promise<ScreenCapture> {
    const context = this.helper.connected ? await this.helper.frontmostContext().catch(() => null) : null;
    const bounds = context?.window?.bounds;
    const display = bounds ? screen.getDisplayMatching({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) }) : screen.getPrimaryDisplay();
    const scale = display.scaleFactor;
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) }
    });
    const source = sources.find((entry) => entry.display_id === String(display.id)) ?? sources[0];
    if (!source) throw new Error("No display source available for capture (Screen Recording permission?)");
    let image = source.thumbnail;
    if (image.isEmpty()) throw new Error("Display capture returned an empty image (Screen Recording permission?)");
    let origin = { x: display.bounds.x, y: display.bounds.y };
    if (bounds) {
      const x = Math.max(0, Math.round((bounds.x - display.bounds.x) * scale));
      const y = Math.max(0, Math.round((bounds.y - display.bounds.y) * scale));
      const width = Math.min(image.getSize().width - x, Math.round(bounds.width * scale));
      const height = Math.min(image.getSize().height - y, Math.round(bounds.height * scale));
      if (width > 0 && height > 0) {
        image = image.crop({ x, y, width, height });
        origin = { x: bounds.x, y: bounds.y };
      }
    }
    const size = image.getSize();
    return {
      png: image.toPNG(),
      width: size.width,
      height: size.height,
      displayScale: scale,
      bounds: { x: origin.x, y: origin.y, width: size.width / scale, height: size.height / scale },
      windowId: context?.window?.id,
      displayId: String(display.id),
      capturedAt: Date.now()
    };
  }
}
