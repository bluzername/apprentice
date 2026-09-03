import type { FrontmostContextResult, Rect } from "@apprentice/schemas";
import type { HelperClient } from "../helper/types.js";
import { hashPng, pngDimensions } from "../images/png-resize.js";

/**
 * How the image was obtained. `window_source` (a desktopCapturer window
 * source) is the default; `helper_window` is the helper's ScreenCaptureKit
 * path; `display_crop` is the last-resort whole-display capture, which is
 * always flagged as a display fallback so nothing stores it, OCRs it, or shows
 * it to a model.
 */
export type CaptureMethod = "window_source" | "helper_window" | "display_crop" | "fixture";

export interface ScreenCapture {
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
  readonly displayScale: number;
  readonly bounds: Rect;
  /** Bundle id of the app owning the captured window (the frontmost app when known). */
  readonly bundleId?: string;
  readonly windowId?: number;
  readonly displayId?: string;
  /**
   * True when no frontmost window could be captured and the image is the whole
   * display instead. Fine for passive observation; a run must never propose,
   * store, or send such an image to a model.
   */
  readonly isDisplayFallback: boolean;
  /** Which rung of the capture ladder produced this image. */
  readonly method: CaptureMethod;
  readonly capturedAt: number;
}

/** Produces a PNG of the frontmost window plus the geometry needed to map coordinates back. */
export interface ScreenSource {
  captureFrontmost(): Promise<ScreenCapture>;
}

/** A frontmost context names a capturable window only when it has non-empty bounds. */
export function hasCapturableWindow(context: FrontmostContextResult | null | undefined): boolean {
  const bounds = context?.window?.bounds;
  return bounds !== undefined && bounds.width > 0 && bounds.height > 0;
}

/** Bundle id of the app owning the frontmost window, or undefined when unknown. */
export function bundleIdOf(context: FrontmostContextResult | null | undefined): string | undefined {
  const bundleId = context?.app.bundleId ?? "";
  return bundleId.length > 0 ? bundleId : undefined;
}

/** Secondary capture path through the helper (ScreenCaptureKit / CGWindowList). */
export class HelperScreenSource implements ScreenSource {
  constructor(
    private readonly helper: HelperClient,
    private readonly now: () => number = Date.now
  ) {}

  async captureFrontmost(): Promise<ScreenCapture> {
    const context = await this.helper.frontmostContext().catch(() => null);
    const result = await this.helper.captureFrontmostWindow();
    return {
      png: Buffer.from(result.pngBase64, "base64"),
      width: result.width,
      height: result.height,
      displayScale: result.displayScale,
      bounds: result.bounds,
      bundleId: bundleIdOf(context),
      windowId: result.windowId ?? context?.window?.id,
      displayId: result.displayId,
      isDisplayFallback: result.windowId === undefined && !hasCapturableWindow(context),
      method: "helper_window",
      capturedAt: this.now()
    };
  }
}

export interface FixtureScreenSourceOptions {
  readonly readPng: (name: string) => Buffer;
  readonly initial: string;
  readonly displayScale?: number;
  readonly now?: () => number;
  /** Scripted owner of the captured window (tests and demo). */
  readonly bundleId?: () => string | undefined;
  /** Scripted "no window to capture": the fixture is then reported as a display fallback. */
  readonly displayFallback?: () => boolean;
}

/** Deterministic source returning fixture PNGs by template name (demo, e2e, smoke, tests). */
export class FixtureScreenSource implements ScreenSource {
  private current: string;
  private readonly cache = new Map<string, { png: Buffer; width: number; height: number; hash: string }>();

  constructor(private readonly options: FixtureScreenSourceOptions) {
    this.current = options.initial;
  }

  get template(): string {
    return this.current;
  }

  setTemplate(name: string): void {
    this.current = name;
  }

  hashOf(name: string): string {
    return this.load(name).hash;
  }

  private load(name: string): { png: Buffer; width: number; height: number; hash: string } {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const png = this.options.readPng(name);
    const dims = pngDimensions(png);
    const entry = { png, width: dims.width, height: dims.height, hash: hashPng(png) };
    this.cache.set(name, entry);
    return entry;
  }

  async captureFrontmost(): Promise<ScreenCapture> {
    const entry = this.load(this.current);
    const scale = this.options.displayScale ?? 1;
    const fallback = this.options.displayFallback?.() ?? false;
    return {
      png: entry.png,
      width: entry.width,
      height: entry.height,
      displayScale: scale,
      bounds: { x: 0, y: 0, width: entry.width / scale, height: entry.height / scale },
      bundleId: this.options.bundleId?.(),
      windowId: fallback ? undefined : 1,
      displayId: "fixture-display",
      isDisplayFallback: fallback,
      method: "fixture",
      capturedAt: (this.options.now ?? Date.now)()
    };
  }
}

/** Lets the app swap the active source (real capture vs demo simulator) without rewiring consumers. */
export class SwitchableScreenSource implements ScreenSource {
  constructor(private source: ScreenSource) {}

  use(source: ScreenSource): void {
    this.source = source;
  }

  current(): ScreenSource {
    return this.source;
  }

  captureFrontmost(): Promise<ScreenCapture> {
    return this.source.captureFrontmost();
  }
}
