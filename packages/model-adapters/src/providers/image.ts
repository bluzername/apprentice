/**
 * Screenshot preparation shared by the network providers. Resizing itself is
 * injected (`ImageResizer`) so the Electron main process can plug in
 * nativeImage; the default identity resizer sends the screenshot unchanged
 * and the recorded source dimensions always describe the image actually sent.
 */
import type { ModelImage } from "@apprentice/schemas";
import { processImageDims, type ImageDims } from "../uimate/resize.js";

export type ImageResizer = (png: Buffer, targetWidth: number, targetHeight: number) => Promise<Buffer>;

/** Default: return the input untouched (same Buffer reference). */
export const identityResizer: ImageResizer = (png) => Promise.resolve(png);

export class ImagePrepareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImagePrepareError";
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Read width/height from a PNG IHDR chunk; null when the buffer is not a PNG. */
export function readPngDimensions(png: Buffer): ImageDims | null {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  if (png.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width === 0 || height === 0) {
    return null;
  }
  return { width, height };
}

export interface PreparedImage {
  readonly base64: string;
  /** Dimensions of the image that is sent to the model. */
  readonly width: number;
  readonly height: number;
  /** Dimensions `process_image` asked for (the official smart_resize target). */
  readonly target: ImageDims;
  readonly resized: boolean;
}

/**
 * Compute the official target dims and resize through the injected resizer.
 * When the resizer returns its input (identity), the original image and dims
 * are kept so coordinate scaling stays consistent with what the model saw.
 */
export async function prepareModelImage(image: ModelImage, resizer: ImageResizer): Promise<PreparedImage> {
  const target = processImageDims(image.width, image.height);
  if (target.width === image.width && target.height === image.height) {
    return { base64: image.pngBase64, width: image.width, height: image.height, target, resized: false };
  }
  const input = Buffer.from(image.pngBase64, "base64");
  const output = await resizer(input, target.width, target.height);
  if (output === input) {
    return { base64: image.pngBase64, width: image.width, height: image.height, target, resized: false };
  }
  const dims = readPngDimensions(output);
  if (!dims) {
    throw new ImagePrepareError("image resizer returned a buffer that is not a PNG");
  }
  return { base64: output.toString("base64"), width: dims.width, height: dims.height, target, resized: true };
}

export function toDataUrl(base64: string): string {
  return `data:image/png;base64,${base64}`;
}
