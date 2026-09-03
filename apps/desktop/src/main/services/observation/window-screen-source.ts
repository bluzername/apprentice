import type { FrontmostContextResult, Rect } from "@apprentice/schemas";
import type { HelperClient } from "../helper/types.js";
import type { Logger } from "../logger.js";
import { bundleIdOf, hasCapturableWindow, type ScreenCapture, type ScreenSource } from "./screen-source.js";

/** The `nativeImage` surface used by the capture ladder. Injected so tests never import electron. */
export interface CaptureImage {
  isEmpty(): boolean;
  getSize(): { readonly width: number; readonly height: number };
  crop(rect: { x: number; y: number; width: number; height: number }): CaptureImage;
  toPNG(): Buffer;
}

/**
 * The subset of Electron's `DesktopCapturerSource` this module may touch.
 * `name` is deliberately absent: for `types: ["window"]` it is the title of
 * every window on the system, and reading or logging those titles would leak
 * context from apps the user never allowlisted.
 */
export interface CaptureSource {
  readonly id: string;
  readonly thumbnail: CaptureImage;
  readonly display_id?: string;
}

export interface DesktopCapturerLike {
  getSources(options: { types: readonly string[]; thumbnailSize: { width: number; height: number } }): Promise<readonly CaptureSource[]>;
}

export interface DisplayLike {
  readonly id: number;
  readonly scaleFactor: number;
  readonly bounds: Rect;
  readonly size: { readonly width: number; readonly height: number };
}

export interface ScreenLike {
  getDisplayMatching(rect: { x: number; y: number; width: number; height: number }): DisplayLike;
  getPrimaryDisplay(): DisplayLike;
}

/** A window source image may differ from bounds x scale by rounding, never by more than this. */
export const WINDOW_SIZE_TOLERANCE_PX = 8;

/**
 * macOS window source ids are `window:<CGWindowID>:0`. Returns the CGWindowID,
 * or null for any other shape (other platforms, screen sources).
 */
export function parseWindowSourceId(id: string): number | null {
  const match = /^window:(\d+)(?::|$)/.exec(id);
  if (match === null) return null;
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** True when the returned thumbnail really is the requested window and not a scaled or empty stand-in. */
export function isPlausibleWindowImage(
  size: { readonly width: number; readonly height: number },
  expected: { readonly width: number; readonly height: number },
  tolerancePx: number = WINDOW_SIZE_TOLERANCE_PX
): boolean {
  if (size.width <= 0 || size.height <= 0) return false;
  return Math.abs(size.width - expected.width) <= tolerancePx && Math.abs(size.height - expected.height) <= tolerancePx;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}

/** All the ladder needs from the helper: whether it is up, and the frontmost window. */
export type FrontmostContextProvider = Pick<HelperClient, "connected" | "frontmostContext">;

export interface WindowScreenSourceDeps {
  readonly helper: FrontmostContextProvider;
  readonly capturer: DesktopCapturerLike;
  readonly screen: ScreenLike;
  readonly logger: Logger;
  /** Ladder step (b): the helper's own ScreenCaptureKit / CGWindowList capture. */
  readonly helperSource: ScreenSource;
  /** The `captureViaHelper` setting: when true, step (b) is tried before the window source. */
  readonly preferHelper: () => boolean;
  readonly now?: () => number;
}

/**
 * Window-scoped capture (ADR 0002, amended). The ladder is:
 *
 * a. `desktopCapturer` window source matched by the helper's CGWindowID. The
 *    image is just that window, free of anything stacked on top of it, and is
 *    captured under the app's own Screen Recording grant.
 * b. the helper's `captureFrontmostWindow` when the helper is connected
 *    (forced first by the `captureViaHelper` setting).
 * c. a whole-display capture cropped to the window bounds when known. This rung
 *    is always flagged `isDisplayFallback`, so the passive path drops it and a
 *    run refuses to act on it; it exists only so a run can report why.
 */
export class WindowScreenSource implements ScreenSource {
  constructor(private readonly deps: WindowScreenSourceDeps) {}

  async captureFrontmost(): Promise<ScreenCapture> {
    const context = this.deps.helper.connected ? await this.deps.helper.frontmostContext().catch(() => null) : null;
    const bounds = hasCapturableWindow(context) ? context?.window?.bounds : undefined;
    const windowId = context?.window?.id;
    const display = this.displayFor(bounds);
    const viaWindowSource = async (): Promise<ScreenCapture | null> =>
      bounds === undefined || windowId === undefined ? null : this.captureWindowSource(context, bounds, windowId, display);
    const viaHelper = (): Promise<ScreenCapture | null> => this.captureViaHelper();
    const ladder = this.deps.preferHelper() ? [viaHelper, viaWindowSource] : [viaWindowSource, viaHelper];
    for (const step of ladder) {
      const capture = await step();
      if (capture !== null) {
        this.deps.logger.debug("frontmost capture", { method: capture.method, windowId: capture.windowId, displayId: capture.displayId });
        return capture;
      }
    }
    const fallback = await this.captureDisplayCrop(context, bounds, display);
    this.deps.logger.debug("frontmost capture", { method: fallback.method, displayId: fallback.displayId, cropped: bounds !== undefined });
    return fallback;
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private displayFor(bounds: Rect | undefined): DisplayLike {
    if (bounds === undefined) return this.deps.screen.getPrimaryDisplay();
    return this.deps.screen.getDisplayMatching({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height))
    });
  }

  /** Ladder step (a). Returns null whenever the window source cannot be trusted; never throws. */
  private async captureWindowSource(
    context: FrontmostContextResult | null,
    bounds: Rect,
    windowId: number,
    display: DisplayLike
  ): Promise<ScreenCapture | null> {
    const scale = display.scaleFactor;
    const expected = { width: Math.max(1, Math.round(bounds.width * scale)), height: Math.max(1, Math.round(bounds.height * scale)) };
    let sources: readonly CaptureSource[];
    try {
      sources = await this.deps.capturer.getSources({ types: ["window"], thumbnailSize: expected });
    } catch (error) {
      this.deps.logger.debug("window source enumeration failed", { error: errorMessage(error) });
      return null;
    }
    // Match on the id alone. Nothing else on a source may be read before the
    // match: every other window's `name` is its title.
    const source = sources.find((entry) => parseWindowSourceId(entry.id) === windowId);
    if (source === undefined) {
      this.deps.logger.debug("no window source for the frontmost window", { windowId });
      return null;
    }
    const image = source.thumbnail;
    if (image.isEmpty()) {
      this.deps.logger.debug("window source returned an empty image", { windowId });
      return null;
    }
    const size = image.getSize();
    if (!isPlausibleWindowImage(size, expected)) {
      this.deps.logger.debug("window source size does not match the window bounds", { windowId, width: size.width, height: size.height, expectedWidth: expected.width, expectedHeight: expected.height });
      return null;
    }
    return {
      png: image.toPNG(),
      width: size.width,
      height: size.height,
      displayScale: scale,
      // Origin comes from the helper's window bounds; the extent comes from the
      // image so that bounds x scale is exactly the pixel size the coordinate
      // transform maps through.
      bounds: { x: bounds.x, y: bounds.y, width: size.width / scale, height: size.height / scale },
      bundleId: bundleIdOf(context),
      windowId,
      displayId: nonEmpty(source.display_id) ?? nonEmpty(context?.displayId) ?? String(display.id),
      isDisplayFallback: false,
      method: "window_source",
      capturedAt: this.now()
    };
  }

  /** Ladder step (b). Returns null when the helper is down, fails, or has no window either. */
  private async captureViaHelper(): Promise<ScreenCapture | null> {
    if (!this.deps.helper.connected) return null;
    try {
      const capture = await this.deps.helperSource.captureFrontmost();
      if (capture.isDisplayFallback) return null;
      return capture;
    } catch (error) {
      this.deps.logger.debug("helper window capture failed", { error: errorMessage(error) });
      return null;
    }
  }

  /** Ladder step (c). Always a display fallback, whether or not it could be cropped. */
  private async captureDisplayCrop(context: FrontmostContextResult | null, bounds: Rect | undefined, display: DisplayLike): Promise<ScreenCapture> {
    const scale = display.scaleFactor;
    const image = await this.displayImage(display, scale);
    const cropped = bounds === undefined ? null : this.cropTo(image, bounds, display, scale);
    const final = cropped ?? image;
    const size = final.getSize();
    const origin = cropped === null ? { x: display.bounds.x, y: display.bounds.y } : { x: bounds!.x, y: bounds!.y };
    return {
      png: final.toPNG(),
      width: size.width,
      height: size.height,
      displayScale: scale,
      bounds: { x: origin.x, y: origin.y, width: size.width / scale, height: size.height / scale },
      bundleId: bundleIdOf(context),
      displayId: String(display.id),
      isDisplayFallback: true,
      method: "display_crop",
      capturedAt: this.now()
    };
  }

  private async displayImage(display: DisplayLike, scale: number): Promise<CaptureImage> {
    const sources = await this.deps.capturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) }
    });
    const source = sources.find((entry) => entry.display_id === String(display.id)) ?? sources[0];
    if (source === undefined) throw new Error("No display source available for capture (Screen Recording permission?)");
    const image = source.thumbnail;
    if (image.isEmpty()) throw new Error("Display capture returned an empty image (Screen Recording permission?)");
    return image;
  }

  private cropTo(image: CaptureImage, bounds: Rect, display: DisplayLike, scale: number): CaptureImage | null {
    const x = Math.max(0, Math.round((bounds.x - display.bounds.x) * scale));
    const y = Math.max(0, Math.round((bounds.y - display.bounds.y) * scale));
    const size = image.getSize();
    const width = Math.min(size.width - x, Math.round(bounds.width * scale));
    const height = Math.min(size.height - y, Math.round(bounds.height * scale));
    if (width <= 0 || height <= 0) return null;
    return image.crop({ x, y, width, height });
  }
}
