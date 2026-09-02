/**
 * Ported from Tencent/UI-Mate agents/ui_mate_agent.py at commit 1cb9e1e, Apache-2.0.
 *
 * `smart_resize` picks a factor-aligned (height, width) inside a pixel budget
 * while keeping the aspect ratio; `process_image` calls it with factor 32 and a
 * 16*16*4*12800 pixel budget before sending a screenshot to the model. The
 * resulting dimensions are the pixel space the model's 0-999 coordinates map to.
 */
import {
  PROCESS_IMAGE_FACTOR,
  PROCESS_IMAGE_MAX_PIXELS,
  SMART_RESIZE_DEFAULT_FACTOR,
  SMART_RESIZE_DEFAULT_MAX_LONG_SIDE,
  SMART_RESIZE_DEFAULT_MAX_PIXELS,
  SMART_RESIZE_DEFAULT_MIN_PIXELS
} from "./constants.js";
import { pyInt, pyRoundHalfEven } from "./python-compat.js";

export interface SmartResizeOptions {
  readonly factor?: number;
  readonly minPixels?: number;
  readonly maxPixels?: number;
  readonly maxLongSide?: number;
}

export interface ImageDims {
  readonly width: number;
  readonly height: number;
}

function roundByFactor(value: number, factor: number): number {
  return pyRoundHalfEven(value / factor) * factor;
}

function ceilByFactor(value: number, factor: number): number {
  return Math.ceil(value / factor) * factor;
}

function floorByFactor(value: number, factor: number): number {
  return Math.floor(value / factor) * factor;
}

/**
 * Returns `[height, width]` exactly like the Python `smart_resize(height, width, ...)`.
 * Throws RangeError for the same inputs Python raises ValueError on.
 */
export function smartResize(height: number, width: number, options: SmartResizeOptions = {}): readonly [number, number] {
  const factor = options.factor ?? SMART_RESIZE_DEFAULT_FACTOR;
  const minPixels = options.minPixels ?? SMART_RESIZE_DEFAULT_MIN_PIXELS;
  const maxPixels = options.maxPixels ?? SMART_RESIZE_DEFAULT_MAX_PIXELS;
  const maxLongSide = options.maxLongSide ?? SMART_RESIZE_DEFAULT_MAX_LONG_SIDE;

  if (height < 2 || width < 2) {
    throw new RangeError(`height:${height} or width:${width} must be larger than factor:${factor}`);
  }
  if (Math.max(height, width) / Math.min(height, width) > 200) {
    throw new RangeError(`absolute aspect ratio must be smaller than 200, got ${height} / ${width}`);
  }

  let h = height;
  let w = width;
  if (Math.max(h, w) > maxLongSide) {
    const beta = Math.max(h, w) / maxLongSide;
    h = pyInt(h / beta);
    w = pyInt(w / beta);
  }

  let hBar = roundByFactor(h, factor);
  let wBar = roundByFactor(w, factor);
  if (hBar * wBar > maxPixels) {
    const beta = Math.sqrt((h * w) / maxPixels);
    hBar = floorByFactor(h / beta, factor);
    wBar = floorByFactor(w / beta, factor);
  } else if (hBar * wBar < minPixels) {
    const beta = Math.sqrt(minPixels / (h * w));
    hBar = ceilByFactor(h * beta, factor);
    wBar = ceilByFactor(w * beta, factor);
  }
  return [hBar, wBar];
}

/** Target dimensions `process_image` resizes a screenshot to before encoding. */
export function processImageDims(width: number, height: number): ImageDims {
  const [targetHeight, targetWidth] = smartResize(height, width, {
    factor: PROCESS_IMAGE_FACTOR,
    maxPixels: PROCESS_IMAGE_MAX_PIXELS
  });
  return { width: targetWidth, height: targetHeight };
}
