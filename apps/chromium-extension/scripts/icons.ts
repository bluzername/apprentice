/**
 * Original, minimal icon: a rounded navy tile with a light ring and a center
 * dot (an "attentive lens" motif). Rendered with @resvg/resvg-js when it is
 * available in the workspace, otherwise rasterized by a tiny built-in PNG writer.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { ICON_SIZES } from "./generate-manifest";

const TILE = { r: 0x1f, g: 0x2a, b: 0x44 };
const RING = { r: 0x7d, g: 0xd3, b: 0xfc };

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect x="4" y="4" width="120" height="120" rx="28" fill="#1f2a44"/>
  <circle cx="64" cy="64" r="34" fill="none" stroke="#7dd3fc" stroke-width="10"/>
  <circle cx="64" cy="64" r="12" fill="#7dd3fc"/>
</svg>
`;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Returns the color (or null for transparent) at unit coordinates in [0,1]. */
function sample(u: number, v: number): Rgb | null {
  const x = u * 128;
  const y = v * 128;
  const inset = 4;
  const radius = 28;
  const cx = Math.min(Math.max(x, inset + radius), 128 - inset - radius);
  const cy = Math.min(Math.max(y, inset + radius), 128 - inset - radius);
  const insideTile = (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  if (!insideTile) {
    return null;
  }
  const d = Math.hypot(x - 64, y - 64);
  if (d <= 12 || (d >= 29 && d <= 39)) {
    return RING;
  }
  return TILE;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.length);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(crcInput));
  return new Uint8Array([...length, ...typeBytes, ...data, ...crc]);
}

/** Encodes an RGBA raster as a PNG using zlib from Node; no external dependency. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    raw.set(rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array([
    ...signature,
    ...chunk("IHDR", header),
    ...chunk("IDAT", new Uint8Array(deflateSync(raw))),
    ...chunk("IEND", new Uint8Array(0))
  ]);
}

/** Rasterizes the icon design with 3x3 supersampling. */
export function rasterizeIcon(size: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const samples = 3;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const color = sample((px + (sx + 0.5) / samples) / size, (py + (sy + 0.5) / samples) / size);
          if (color !== null) {
            r += color.r;
            g += color.g;
            b += color.b;
            a += 1;
          }
        }
      }
      const offset = (py * size + px) * 4;
      const total = samples * samples;
      rgba[offset] = a === 0 ? 0 : Math.round(r / a);
      rgba[offset + 1] = a === 0 ? 0 : Math.round(g / a);
      rgba[offset + 2] = a === 0 ? 0 : Math.round(b / a);
      rgba[offset + 3] = Math.round((a / total) * 255);
    }
  }
  return rgba;
}

type ResvgModule = {
  Resvg: new (svg: string, options?: { fitTo?: { mode: "width"; value: number } }) => {
    render(): { asPng(): Uint8Array };
  };
};

/** Native addon: load through Node's real require so it also works when this file runs inside Vite's module runner. */
async function loadResvg(): Promise<ResvgModule | null> {
  const specifier = "@resvg/resvg-js";
  try {
    const mod = createRequire(import.meta.url)(specifier) as Partial<ResvgModule>;
    return typeof mod.Resvg === "function" ? (mod as ResvgModule) : null;
  } catch {
    try {
      const mod = (await import(specifier)) as Partial<ResvgModule>;
      return typeof mod.Resvg === "function" ? (mod as ResvgModule) : null;
    } catch {
      return null;
    }
  }
}

export async function renderIconPng(size: number, resvg: ResvgModule | null): Promise<Uint8Array> {
  if (resvg !== null) {
    const renderer = new resvg.Resvg(ICON_SVG, { fitTo: { mode: "width", value: size } });
    return renderer.render().asPng();
  }
  return encodePng(size, size, rasterizeIcon(size));
}

export async function writeIcons(distDir: string): Promise<{ renderer: "resvg" | "builtin"; files: readonly string[] }> {
  const resvg = await loadResvg();
  const iconsDir = join(distDir, "icons");
  await mkdir(iconsDir, { recursive: true });
  await writeFile(join(iconsDir, "icon.svg"), ICON_SVG, "utf8");
  const files: string[] = [];
  for (const size of ICON_SIZES) {
    const target = join(iconsDir, `icon-${size}.png`);
    await writeFile(target, await renderIconPng(size, resvg));
    files.push(target);
  }
  return { renderer: resvg === null ? "builtin" : "resvg", files };
}
