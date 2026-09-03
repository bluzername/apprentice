import { describe, expect, it } from "vitest";
import type { FrontmostContextResult, Rect } from "@apprentice/schemas";
import { systemClock } from "../src/main/services/clock.js";
import { FakeHelperClient } from "../src/main/services/helper/fake-helper-client.js";
import { nodePngResizer } from "../src/main/services/images/png-resize.js";
import { silentLogger } from "../src/main/services/logger.js";
import { CaptureService } from "../src/main/services/observation/capture-service.js";
import { createContextClassifier } from "../src/main/services/observation/context-classifier.js";
import type { ScreenCapture, ScreenSource } from "../src/main/services/observation/screen-source.js";
import {
  WindowScreenSource,
  isPlausibleWindowImage,
  parseWindowSourceId,
  type CaptureImage,
  type CaptureSource,
  type DesktopCapturerLike,
  type DisplayLike,
  type FrontmostContextProvider,
  type ScreenLike
} from "../src/main/services/observation/window-screen-source.js";
import { fixtures, makeContext } from "./helpers.js";

const CHROME = "com.google.Chrome";
const WINDOW_BOUNDS: Rect = { x: 100, y: 50, width: 800, height: 600 };
const SCALE = 2;

const DISPLAY: DisplayLike = { id: 7, scaleFactor: SCALE, bounds: { x: 0, y: 0, width: 1440, height: 900 }, size: { width: 1440, height: 900 } };
const fakeScreen: ScreenLike = { getDisplayMatching: () => DISPLAY, getPrimaryDisplay: () => DISPLAY };

/** A nativeImage stand-in that only tracks its own size and a marker payload. */
function image(width: number, height: number, marker: string): CaptureImage {
  return {
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    crop: (rect) => image(rect.width, rect.height, `${marker}:crop`),
    toPNG: () => Buffer.from(marker, "utf8")
  };
}

interface CapturerCall {
  readonly types: readonly string[];
  readonly thumbnailSize: { width: number; height: number };
}

/** Records every getSources call so a test can assert what was enumerated. */
function fakeCapturer(byType: { window?: readonly CaptureSource[]; screen?: readonly CaptureSource[]; failWindow?: boolean }): DesktopCapturerLike & { calls: CapturerCall[] } {
  const calls: CapturerCall[] = [];
  return {
    calls,
    getSources: async (options) => {
      calls.push({ types: options.types, thumbnailSize: options.thumbnailSize });
      if (options.types.includes("window")) {
        if (byType.failWindow === true) throw new Error("getSources failed");
        return byType.window ?? [];
      }
      return byType.screen ?? [];
    }
  };
}

function windowSource(cgWindowId: number, width: number, height: number, marker = "window"): CaptureSource {
  return { id: `window:${cgWindowId}:0`, thumbnail: image(width, height, marker) };
}

function screenSourceEntry(displayId: string, marker = "display"): CaptureSource {
  return { id: `screen:${displayId}:0`, display_id: displayId, thumbnail: image(DISPLAY.size.width * SCALE, DISPLAY.size.height * SCALE, marker) };
}

function context(overrides: { windowId?: number; bounds?: Rect | undefined; bundleId?: string } = {}): FrontmostContextResult {
  return {
    app: { bundleId: overrides.bundleId ?? CHROME, name: "Google Chrome", pid: 42 },
    window: { id: overrides.windowId ?? 1234, title: "secret window title", bounds: "bounds" in overrides ? overrides.bounds : WINDOW_BOUNDS },
    isSecureInput: false,
    isFullscreen: false,
    displayId: "7",
    displayScale: SCALE
  };
}

function helperReturning(result: FrontmostContextResult | null, connected = true): FrontmostContextProvider {
  return {
    connected,
    frontmostContext: async () => {
      if (result === null) throw new Error("helper is down");
      return result;
    }
  };
}

function makeSource(options: {
  helper: FrontmostContextProvider;
  capturer: DesktopCapturerLike;
  helperSource?: ScreenSource;
  preferHelper?: boolean;
}): WindowScreenSource {
  const failing: ScreenSource = {
    captureFrontmost: async () => {
      throw new Error("helper capture unavailable");
    }
  };
  return new WindowScreenSource({
    helper: options.helper,
    capturer: options.capturer,
    screen: fakeScreen,
    logger: silentLogger,
    helperSource: options.helperSource ?? failing,
    preferHelper: () => options.preferHelper === true,
    now: () => 1_700_000_000_000
  });
}

function helperCapture(overrides: Partial<ScreenCapture> = {}): ScreenCapture {
  return {
    png: Buffer.from("helper", "utf8"),
    width: 1600,
    height: 1200,
    displayScale: SCALE,
    bounds: WINDOW_BOUNDS,
    bundleId: CHROME,
    windowId: 1234,
    displayId: "7",
    isDisplayFallback: false,
    method: "helper_window",
    capturedAt: 1,
    ...overrides
  };
}

describe("window source ids", () => {
  it("reads the CGWindowID out of a macOS window source id", () => {
    expect(parseWindowSourceId("window:1234:0")).toBe(1234);
    expect(parseWindowSourceId("window:9")).toBe(9);
    expect(parseWindowSourceId("screen:1:0")).toBeNull();
    expect(parseWindowSourceId("window:abc:0")).toBeNull();
    expect(parseWindowSourceId("")).toBeNull();
  });

  it("accepts only an image the size of the window", () => {
    expect(isPlausibleWindowImage({ width: 1600, height: 1200 }, { width: 1600, height: 1200 })).toBe(true);
    expect(isPlausibleWindowImage({ width: 1596, height: 1204 }, { width: 1600, height: 1200 })).toBe(true);
    expect(isPlausibleWindowImage({ width: 800, height: 600 }, { width: 1600, height: 1200 })).toBe(false);
    expect(isPlausibleWindowImage({ width: 0, height: 0 }, { width: 0, height: 0 })).toBe(false);
  });
});

describe("capture ladder", () => {
  it("captures the frontmost window as a window source and never touches another window's entry", async () => {
    const other = { id: "window:1:0", get thumbnail(): CaptureImage { throw new Error("must not read another window's thumbnail"); } };
    const capturer = fakeCapturer({ window: [other as unknown as CaptureSource, windowSource(1234, 1600, 1200)] });
    const source = makeSource({ helper: helperReturning(context()), capturer });
    const capture = await source.captureFrontmost();
    expect(capture.method).toBe("window_source");
    expect(capture.isDisplayFallback).toBe(false);
    expect(capture.windowId).toBe(1234);
    expect(capture.bundleId).toBe(CHROME);
    expect(capture.width).toBe(1600);
    expect(capture.height).toBe(1200);
    expect(capture.displayScale).toBe(SCALE);
    expect(capture.bounds).toEqual({ x: 100, y: 50, width: 800, height: 600 });
    expect(capturer.calls).toEqual([{ types: ["window"], thumbnailSize: { width: 1600, height: 1200 } }]);
  });

  it("falls back to the helper window capture when no window source matches", async () => {
    const capturer = fakeCapturer({ window: [windowSource(999, 1600, 1200)], screen: [screenSourceEntry("7")] });
    const source = makeSource({ helper: helperReturning(context()), capturer, helperSource: { captureFrontmost: async () => helperCapture() } });
    const capture = await source.captureFrontmost();
    expect(capture.method).toBe("helper_window");
    expect(capture.isDisplayFallback).toBe(false);
    expect(capturer.calls.map((call) => call.types)).toEqual([["window"]]);
  });

  it("falls back to the helper when the window source image is not the size of the window", async () => {
    const capturer = fakeCapturer({ window: [windowSource(1234, 400, 300)], screen: [screenSourceEntry("7")] });
    const source = makeSource({ helper: helperReturning(context()), capturer, helperSource: { captureFrontmost: async () => helperCapture() } });
    expect((await source.captureFrontmost()).method).toBe("helper_window");
  });

  it("falls back to the helper when the window source image is empty", async () => {
    const capturer = fakeCapturer({ window: [windowSource(1234, 0, 0)], screen: [screenSourceEntry("7")] });
    const source = makeSource({ helper: helperReturning(context()), capturer, helperSource: { captureFrontmost: async () => helperCapture() } });
    expect((await source.captureFrontmost()).method).toBe("helper_window");
  });

  it("tries the helper first when captureViaHelper is set", async () => {
    const capturer = fakeCapturer({ window: [windowSource(1234, 1600, 1200)] });
    const source = makeSource({ helper: helperReturning(context()), capturer, helperSource: { captureFrontmost: async () => helperCapture() }, preferHelper: true });
    const capture = await source.captureFrontmost();
    expect(capture.method).toBe("helper_window");
    expect(capturer.calls).toEqual([]);
  });

  it("still uses the window source when the forced helper path fails", async () => {
    const capturer = fakeCapturer({ window: [windowSource(1234, 1600, 1200)] });
    const source = makeSource({ helper: helperReturning(context()), capturer, preferHelper: true });
    expect((await source.captureFrontmost()).method).toBe("window_source");
  });

  it("returns a display crop flagged as a fallback when no window can be captured", async () => {
    const capturer = fakeCapturer({ window: [], screen: [screenSourceEntry("7")] });
    const source = makeSource({ helper: helperReturning(context()), capturer });
    const capture = await source.captureFrontmost();
    expect(capture.method).toBe("display_crop");
    expect(capture.isDisplayFallback).toBe(true);
    expect(capture.windowId).toBeUndefined();
    // Cropped to the known window bounds so the whole desktop is not held in memory.
    expect(capture.width).toBe(1600);
    expect(capture.height).toBe(1200);
  });

  it("returns the whole display as a fallback when the helper is down", async () => {
    const capturer = fakeCapturer({ screen: [screenSourceEntry("7")] });
    const source = makeSource({ helper: helperReturning(null, false), capturer });
    const capture = await source.captureFrontmost();
    expect(capture.method).toBe("display_crop");
    expect(capture.isDisplayFallback).toBe(true);
    expect(capture.bundleId).toBeUndefined();
    expect(capturer.calls.map((call) => call.types)).toEqual([["screen"]]);
  });

  it("does not enumerate window sources when the frontmost app has no window", async () => {
    const capturer = fakeCapturer({ screen: [screenSourceEntry("7")] });
    const source = makeSource({ helper: helperReturning(context({ bounds: undefined })), capturer });
    const capture = await source.captureFrontmost();
    expect(capture.method).toBe("display_crop");
    expect(capturer.calls.map((call) => call.types)).toEqual([["screen"]]);
  });

  it("falls back when enumerating window sources throws", async () => {
    const capturer = fakeCapturer({ failWindow: true, screen: [screenSourceEntry("7")] });
    const source = makeSource({ helper: helperReturning(context()), capturer, helperSource: { captureFrontmost: async () => helperCapture() } });
    expect((await source.captureFrontmost()).method).toBe("helper_window");
  });

  it("ignores a helper capture that is itself a display fallback", async () => {
    const capturer = fakeCapturer({ window: [], screen: [screenSourceEntry("7")] });
    const source = makeSource({
      helper: helperReturning(context()),
      capturer,
      helperSource: { captureFrontmost: async () => helperCapture({ isDisplayFallback: true, windowId: undefined }) }
    });
    expect((await source.captureFrontmost()).method).toBe("display_crop");
  });
});

interface PassiveHarness {
  readonly capture: CaptureService;
  readonly storedCount: () => number;
  readonly ocrCount: () => number;
  readonly counters: () => Readonly<Record<string, number>>;
}

async function passiveHarness(capture: ScreenCapture): Promise<PassiveHarness> {
  const appContext = makeContext();
  appContext.settings.update({ allowlist: { apps: [{ bundleId: CHROME, name: "Google Chrome" }], domains: ["crm.example"] } });
  const helper = new FakeHelperClient({ ocr: () => ({ width: 10, height: 10, blocks: [] }) });
  await helper.start();
  const service = new CaptureService({
    storage: appContext.storage,
    screenSource: { captureFrontmost: async () => capture },
    ocr: (png) => helper.ocrImage(png),
    resizer: nodePngResizer,
    metrics: appContext.metrics,
    clock: systemClock,
    logger: silentLogger,
    sessionId: appContext.sessionId,
    classify: createContextClassifier(appContext.settings, () => true)
  });
  return {
    capture: service,
    storedCount: () => appContext.storage.current.screenshots.count(),
    ocrCount: () => appContext.storage.current.screenshots.ocrCount(),
    counters: () => appContext.metrics.counters()
  };
}

function realCapture(overrides: Partial<ScreenCapture> = {}): ScreenCapture {
  const png = fixtures.readScreenshotPng("crmContact");
  return { png, width: 1280, height: 800, displayScale: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 }, bundleId: CHROME, windowId: 3, displayId: "1", isDisplayFallback: false, method: "window_source", capturedAt: 1, ...overrides };
}

describe("passive capture refusals", () => {
  it("stores a window capture of an allowlisted app", async () => {
    const harness = await passiveHarness(realCapture());
    harness.capture.request("interval", { app: { bundleId: CHROME } });
    await harness.capture.idle();
    expect(harness.storedCount()).toBe(1);
    expect(harness.counters()["capture.refused"]).toBeUndefined();
  });

  it("never stores or OCRs a display fallback", async () => {
    const harness = await passiveHarness(realCapture({ isDisplayFallback: true, windowId: undefined, method: "display_crop" }));
    harness.capture.request("interval", { app: { bundleId: CHROME } });
    await harness.capture.idle();
    expect(harness.storedCount()).toBe(0);
    expect(harness.ocrCount()).toBe(0);
    expect(harness.capture.stats().refused).toBe(1);
    expect(harness.counters()["capture.refused.display_fallback"]).toBe(1);
  });

  it("never stores a capture whose owner is unknown", async () => {
    const harness = await passiveHarness(realCapture({ bundleId: undefined }));
    harness.capture.request("interval", {});
    await harness.capture.idle();
    expect(harness.storedCount()).toBe(0);
    expect(harness.counters()["capture.refused.unknown_app"]).toBe(1);
  });

  it("refuses a capture whose app is no longer allowlisted at the shutter", async () => {
    // The request was made while Chrome was frontmost; the shutter caught Mail.
    const harness = await passiveHarness(realCapture({ bundleId: "com.apple.mail" }));
    harness.capture.request("interval", { app: { bundleId: CHROME }, domain: "crm.example" });
    await harness.capture.idle();
    expect(harness.storedCount()).toBe(0);
    expect(harness.counters()["capture.refused.not_allowed"]).toBe(1);
  });

  it("keeps a capture of the same app that was requested", async () => {
    const harness = await passiveHarness(realCapture({ bundleId: CHROME }));
    harness.capture.request("interval", { app: { bundleId: CHROME }, domain: "crm.example" });
    await harness.capture.idle();
    expect(harness.storedCount()).toBe(1);
  });
});
