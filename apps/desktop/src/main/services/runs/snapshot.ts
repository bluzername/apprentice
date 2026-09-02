import { newId } from "@apprentice/core";
import type { ImageTransform, OcrBlock, OcrResult, ScreenshotRecord } from "@apprentice/schemas";
import { hashPng, resizeForModel, type PngResizer } from "../images/png-resize.js";
import type { ScreenCapture, ScreenSource } from "../observation/screen-source.js";
import type { StorageRef } from "../app-context.js";
import type { OcrSource, RunContextSnapshot, RunContextSource } from "./types.js";

/** One observation of the screen: capture, model-sized image, transform, OCR, semantic context. */
export interface ScreenSnapshot {
  readonly capture: ScreenCapture;
  readonly hash: string;
  readonly resized: { readonly png: Buffer; readonly width: number; readonly height: number };
  readonly transform: ImageTransform;
  readonly ocrBlocks: readonly OcrBlock[];
  readonly ocrText: string;
  readonly context: RunContextSnapshot;
  readonly screenshotId?: string;
}

export interface SnapshotDeps {
  readonly screenSource: ScreenSource;
  readonly context: RunContextSource;
  readonly ocr: OcrSource;
  readonly resizer: PngResizer;
  readonly storage: StorageRef;
  readonly sessionId: string;
}

export interface SnapshotOptions {
  /** Reuse OCR from a previous snapshot with the same perceptual hash. */
  readonly previous?: ScreenSnapshot;
  /** Persist the capture as a run_step screenshot (encrypted) and return its id. */
  readonly store?: boolean;
  readonly now: number;
}

export function transformFor(capture: ScreenCapture, resized: { width: number; height: number }): ImageTransform {
  return {
    originalWidth: capture.width,
    originalHeight: capture.height,
    resizedWidth: resized.width,
    resizedHeight: resized.height,
    displayScale: capture.displayScale,
    originX: capture.bounds.x,
    originY: capture.bounds.y,
    displayId: capture.displayId,
    windowId: capture.windowId
  };
}

export function ocrTextOf(blocks: readonly OcrBlock[]): string {
  return blocks.map((block) => block.text.trim()).filter((text) => text.length > 0).join("\n");
}

export async function takeSnapshot(deps: SnapshotDeps, options: SnapshotOptions): Promise<ScreenSnapshot> {
  const capture = await deps.screenSource.captureFrontmost();
  const hash = hashPng(capture.png);
  const resized = await resizeForModel(deps.resizer, capture.png, capture.width, capture.height);
  const transform = transformFor(capture, resized);
  const context = await deps.context.frontmost();
  const reusable = options.previous !== undefined && options.previous.hash === hash && options.previous.resized.width === resized.width;
  const ocrBlocks = reusable ? options.previous!.ocrBlocks : await deps.ocr.ocr(resized.png, resized.width, resized.height);
  const ocrText = ocrTextOf(ocrBlocks);
  let screenshotId: string | undefined;
  if (options.store) {
    const storage = deps.storage.current;
    screenshotId = newId("shot");
    const written = storage.blobs.write(screenshotId, capture.png);
    const record: ScreenshotRecord = {
      id: screenshotId,
      ts: capture.capturedAt,
      sessionId: deps.sessionId,
      width: capture.width,
      height: capture.height,
      displayScale: capture.displayScale,
      perceptualHash: hash,
      byteLength: written.byteLength,
      reason: "run_step",
      analyzed: true,
      app: context.bundleId ? { bundleId: context.bundleId, name: context.appName } : undefined,
      domain: context.domain
    };
    storage.screenshots.insert(record);
    const ocr: OcrResult = { id: newId("ocr"), screenshotId, ts: options.now, width: resized.width, height: resized.height, blocks: ocrBlocks.slice(0, 2000) };
    storage.screenshots.insertOcr(ocr);
  }
  return { capture, hash, resized, transform, ocrBlocks, ocrText, context, screenshotId };
}
