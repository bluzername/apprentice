import type { Rect } from "@apprentice/schemas";
import type { HelperClient } from "../helper/types.js";
import { hashPng, pngDimensions } from "../images/png-resize.js";

export interface ScreenCapture {
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
  readonly displayScale: number;
  readonly bounds: Rect;
  readonly windowId?: number;
  readonly displayId?: string;
  readonly capturedAt: number;
}

/** Produces a PNG of the frontmost window plus the geometry needed to map coordinates back. */
export interface ScreenSource {
  captureFrontmost(): Promise<ScreenCapture>;
}

/** Secondary capture path through the helper (ScreenCaptureKit / CGWindowList). */
export class HelperScreenSource implements ScreenSource {
  constructor(
    private readonly helper: HelperClient,
    private readonly now: () => number = Date.now
  ) {}

  async captureFrontmost(): Promise<ScreenCapture> {
    const result = await this.helper.captureFrontmostWindow();
    return {
      png: Buffer.from(result.pngBase64, "base64"),
      width: result.width,
      height: result.height,
      displayScale: result.displayScale,
      bounds: result.bounds,
      windowId: result.windowId,
      displayId: result.displayId,
      capturedAt: this.now()
    };
  }
}

export interface FixtureScreenSourceOptions {
  readonly readPng: (name: string) => Buffer;
  readonly initial: string;
  readonly displayScale?: number;
  readonly now?: () => number;
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
    return {
      png: entry.png,
      width: entry.width,
      height: entry.height,
      displayScale: scale,
      bounds: { x: 0, y: 0, width: entry.width / scale, height: entry.height / scale },
      windowId: 1,
      displayId: "fixture-display",
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
