export interface PixelBuffer {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly channels: 3 | 4;
}

const HASH_COLS = 9;
const HASH_ROWS = 8;
const HEX_LENGTH = 16;

function validatePixels(pixels: PixelBuffer): void {
  if (!Number.isInteger(pixels.width) || pixels.width <= 0) throw new Error("perceptualHash: invalid width");
  if (!Number.isInteger(pixels.height) || pixels.height <= 0) throw new Error("perceptualHash: invalid height");
  if (pixels.channels !== 3 && pixels.channels !== 4) throw new Error("perceptualHash: channels must be 3 or 4");
  const expected = pixels.width * pixels.height * pixels.channels;
  if (pixels.data.length < expected) throw new Error(`perceptualHash: buffer too small (${pixels.data.length} < ${expected})`);
}

/** Box-filter grayscale downsample to a cols x rows grid of luminance values. */
export function downsampleGray(pixels: PixelBuffer, cols: number, rows: number): Float64Array {
  validatePixels(pixels);
  const grid = new Float64Array(cols * rows);
  const { data, width, height, channels } = pixels;
  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.floor((row * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / rows));
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor((col * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * width) / cols));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * width + x) * channels;
          const r = data[offset] ?? 0;
          const g = data[offset + 1] ?? 0;
          const b = data[offset + 2] ?? 0;
          sum += 0.299 * r + 0.587 * g + 0.114 * b;
          count += 1;
        }
      }
      grid[row * cols + col] = count === 0 ? 0 : sum / count;
    }
  }
  return grid;
}

/** 64-bit difference hash (9x8 grayscale, left-vs-right comparisons) as 16 hex chars. */
export function perceptualHash(pixels: PixelBuffer): string {
  const grid = downsampleGray(pixels, HASH_COLS, HASH_ROWS);
  let bits = 0n;
  for (let row = 0; row < HASH_ROWS; row += 1) {
    for (let col = 0; col < HASH_COLS - 1; col += 1) {
      const left = grid[row * HASH_COLS + col] ?? 0;
      const right = grid[row * HASH_COLS + col + 1] ?? 0;
      bits = (bits << 1n) | (left < right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(HEX_LENGTH, "0");
}

const HEX_RE = /^[0-9a-f]{16}$/;

function popcount(value: number): number {
  let count = 0;
  let rest = value;
  while (rest !== 0) {
    rest &= rest - 1;
    count += 1;
  }
  return count;
}

export function hammingDistance(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (!HEX_RE.test(left) || !HEX_RE.test(right)) throw new Error("hammingDistance: expected 16 hex chars");
  let distance = 0;
  for (let index = 0; index < HEX_LENGTH; index += 1) {
    const x = parseInt(left[index]!, 16) ^ parseInt(right[index]!, 16);
    distance += popcount(x);
  }
  return distance;
}

export const DEFAULT_NEAR_DUPLICATE_THRESHOLD = 6;

export function isNearDuplicate(a: string, b: string, threshold = DEFAULT_NEAR_DUPLICATE_THRESHOLD): boolean {
  return hammingDistance(a, b) <= threshold;
}
