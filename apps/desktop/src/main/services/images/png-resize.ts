import { decodePngToPixels, encodePixelsToPng, perceptualHash } from "@apprentice/core";
import type { ImageResizer } from "@apprentice/model-adapters";
import { uimate } from "@apprentice/model-adapters";

export interface ResizedPng {
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
}

/** Area-averaging RGBA downscale (pure Node, used in tests, smoke, and as the fallback resizer). */
export function resizePixels(source: ReturnType<typeof decodePngToPixels>, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const { data, width: sw, height: sh } = source;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor((y * sh) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / height));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor((x * sw) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / width));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const offset = (sy * sw + sx) * 4;
          r += data[offset] ?? 0;
          g += data[offset + 1] ?? 0;
          b += data[offset + 2] ?? 0;
          a += data[offset + 3] ?? 255;
          count += 1;
        }
      }
      const target = (y * width + x) * 4;
      out[target] = Math.round(r / count);
      out[target + 1] = Math.round(g / count);
      out[target + 2] = Math.round(b / count);
      out[target + 3] = Math.round(a / count);
    }
  }
  return out;
}

export function resizePngNode(png: Buffer, width: number, height: number): ResizedPng {
  if (width <= 0 || height <= 0) throw new Error("resizePngNode: target size must be positive");
  const pixels = decodePngToPixels(png);
  if (pixels.width === width && pixels.height === height) return { png, width, height };
  const data = resizePixels(pixels, width, height);
  return { png: encodePixelsToPng({ data, width, height, channels: 4 }), width, height };
}

/** Injectable resize primitive; Electron supplies a nativeImage-backed one. */
export type PngResizer = (png: Buffer, width: number, height: number) => Promise<ResizedPng>;

export const nodePngResizer: PngResizer = async (png, width, height) => resizePngNode(png, width, height);

/** Adapter to the provider package's ImageResizer signature. */
export function toImageResizer(resizer: PngResizer): ImageResizer {
  return async (png, width, height) => (await resizer(png, width, height)).png;
}

/** Resize so the long edge is at most `maxLongEdge`, keeping the aspect ratio. */
export async function resizeToLongEdge(resizer: PngResizer, png: Buffer, width: number, height: number, maxLongEdge: number): Promise<ResizedPng> {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { png, width, height };
  const scale = maxLongEdge / longEdge;
  return resizer(png, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
}

/** Resize to the official UI-Mate processing dimensions (the size the model actually sees). */
export async function resizeForModel(resizer: PngResizer, png: Buffer, width: number, height: number): Promise<ResizedPng> {
  const target = uimate.processImageDims(width, height);
  if (target.width === width && target.height === height) return { png, width, height };
  return resizer(png, target.width, target.height);
}

export function pngDimensions(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.toString("ascii", 12, 16) !== "IHDR") throw new Error("Not a PNG buffer");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export function hashPng(png: Buffer): string {
  return perceptualHash(decodePngToPixels(png));
}
