import { PNG } from "pngjs";
import type { PixelBuffer } from "./phash.js";

/** Decodes a PNG buffer into RGBA pixels (Node-side use and tests). */
export function decodePngToPixels(buffer: Uint8Array): PixelBuffer {
  let png: PNG;
  try {
    png = PNG.sync.read(Buffer.from(buffer));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`decodePngToPixels: ${message}`, { cause: error });
  }
  return { data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength), width: png.width, height: png.height, channels: 4 };
}

/** Encodes RGBA pixels into a PNG buffer (fixtures and tests). */
export function encodePixelsToPng(pixels: PixelBuffer): Buffer {
  if (pixels.channels !== 4) throw new Error("encodePixelsToPng: expects RGBA pixels");
  const png = new PNG({ width: pixels.width, height: pixels.height });
  png.data = Buffer.from(pixels.data);
  return PNG.sync.write(png);
}
