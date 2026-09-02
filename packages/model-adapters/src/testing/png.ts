/**
 * Test-only synthetic PNG builder (pngjs): a flat background with one filled
 * rectangle, so image-plumbing tests and the local smoke test never touch a
 * real screen capture.
 */
import { PNG } from "pngjs";

export interface SyntheticPngOptions {
  readonly width: number;
  readonly height: number;
  readonly background?: readonly [number, number, number];
  readonly rect?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly color: readonly [number, number, number] };
}

export function makeSyntheticPng(options: SyntheticPngOptions): Buffer {
  const png = new PNG({ width: options.width, height: options.height });
  const background = options.background ?? [200, 200, 200];
  const rect = options.rect;
  for (let y = 0; y < options.height; y += 1) {
    for (let x = 0; x < options.width; x += 1) {
      const inside = rect !== undefined && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const [r, g, b] = inside && rect ? rect.color : background;
      const offset = (options.width * y + x) * 4;
      png.data[offset] = r;
      png.data[offset + 1] = g;
      png.data[offset + 2] = b;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

export function makeSyntheticPngBase64(options: SyntheticPngOptions): string {
  return makeSyntheticPng(options).toString("base64");
}
