import { describe, expect, it } from "vitest";
import { BackpressureQueue } from "./backpressure.js";
import { hammingDistance, isNearDuplicate, perceptualHash, type PixelBuffer } from "./phash.js";
import { decodePngToPixels, encodePixelsToPng } from "./png.js";
import { CaptureThrottle } from "./throttle.js";

function gradient(width: number, height: number, seed = 0): PixelBuffer {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = Math.floor(((x + seed) / width) * 255);
      data[offset] = value;
      data[offset + 1] = Math.floor((y / height) * 255);
      data[offset + 2] = 128;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height, channels: 4 };
}

function noisy(source: PixelBuffer, amplitude: number): PixelBuffer {
  let state = 12345;
  const data = new Uint8Array(source.data);
  for (let index = 0; index < data.length; index += 1) {
    if (index % 4 === 3) continue;
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const delta = (state % (amplitude * 2 + 1)) - amplitude;
    data[index] = Math.max(0, Math.min(255, data[index]! + delta));
  }
  return { ...source, data };
}

function checkerboard(width: number, height: number): PixelBuffer {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const on = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      data[offset] = data[offset + 1] = data[offset + 2] = on ? 255 : 0;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height, channels: 4 };
}

describe("perceptualHash", () => {
  it("returns 16 hex chars and is stable", () => {
    const hash = perceptualHash(gradient(64, 48));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(perceptualHash(gradient(64, 48))).toBe(hash);
  });

  it("treats identical and slightly noisy images as near duplicates", () => {
    const base = gradient(128, 96);
    const a = perceptualHash(base);
    const b = perceptualHash(noisy(base, 6));
    expect(hammingDistance(a, a)).toBe(0);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(6);
    expect(isNearDuplicate(a, b)).toBe(true);
  });

  it("separates very different images", () => {
    const a = perceptualHash(gradient(128, 96));
    const b = perceptualHash(checkerboard(128, 96));
    expect(hammingDistance(a, b)).toBeGreaterThan(12);
    expect(isNearDuplicate(a, b)).toBe(false);
    expect(isNearDuplicate(a, b, 64)).toBe(true);
  });

  it("handles RGB buffers and validates input", () => {
    const rgba = gradient(32, 24);
    const rgb = new Uint8Array(32 * 24 * 3);
    for (let pixel = 0; pixel < 32 * 24; pixel += 1) {
      rgb[pixel * 3] = rgba.data[pixel * 4]!;
      rgb[pixel * 3 + 1] = rgba.data[pixel * 4 + 1]!;
      rgb[pixel * 3 + 2] = rgba.data[pixel * 4 + 2]!;
    }
    expect(perceptualHash({ data: rgb, width: 32, height: 24, channels: 3 })).toBe(perceptualHash(rgba));
    expect(() => perceptualHash({ data: new Uint8Array(3), width: 10, height: 10, channels: 4 })).toThrow(/too small/);
    expect(() => hammingDistance("zz", "aa")).toThrow();
  });

  it("round-trips through PNG encoding", () => {
    const source = gradient(40, 30);
    const png = encodePixelsToPng(source);
    const decoded = decodePngToPixels(png);
    expect(decoded.width).toBe(40);
    expect(decoded.height).toBe(30);
    expect(perceptualHash(decoded)).toBe(perceptualHash(source));
    expect(() => decodePngToPixels(new Uint8Array([1, 2, 3]))).toThrow(/decodePngToPixels/);
  });
});

describe("CaptureThrottle", () => {
  it("allows one capture per interval outside a run", () => {
    let now = 0;
    const throttle = new CaptureThrottle({ now: () => now });
    expect(throttle.request("click").allowed).toBe(true);
    now = 1000;
    const throttled = throttle.request("navigation");
    expect(throttled.allowed).toBe(false);
    expect(throttled.reason).toBe("throttled");
    expect(throttled.waitMs).toBe(4000);
    now = 5000;
    expect(throttle.request("app_change").allowed).toBe(true);
    now = 5001;
    expect(throttle.request("window_change").allowed).toBe(false);
  });

  it("lets teach markers and run steps bypass, never the interval fallback", () => {
    let now = 0;
    const throttle = new CaptureThrottle({ now: () => now });
    expect(throttle.request("click").allowed).toBe(true);
    now = 100;
    expect(throttle.request("teach_marker")).toEqual({ allowed: true, reason: "bypass", waitMs: 0 });
    now = 200;
    expect(throttle.request("run_step").reason).toBe("bypass");
    now = 4999;
    expect(throttle.request("interval").allowed).toBe(false);
    now = 5300;
    expect(throttle.request("interval").allowed).toBe(true);
    expect(() => new CaptureThrottle({ now: () => 0, minIntervalMs: 0 })).toThrow();
  });
});

interface Item {
  readonly kind: "screenshot" | "event";
  readonly id: string;
  readonly hash?: string;
}

function queue(capacity: number): BackpressureQueue<Item> {
  return new BackpressureQueue<Item>({ capacity, classify: (item) => ({ kind: item.kind, hash: item.hash }) });
}

describe("BackpressureQueue", () => {
  it("drops redundant screenshots with the same hash first", () => {
    const q = queue(10);
    expect(q.push({ kind: "screenshot", id: "s1", hash: "aaaa" })).toBe("queued");
    expect(q.push({ kind: "screenshot", id: "s2", hash: "aaaa" })).toBe("dropped_redundant");
    expect(q.push({ kind: "screenshot", id: "s3", hash: "bbbb" })).toBe("queued");
    expect(q.size).toBe(2);
    expect(q.stats().drops.redundant).toBe(1);
  });

  it("evicts screenshots before dropping semantic events when full", () => {
    const q = queue(3);
    q.push({ kind: "event", id: "e1" });
    q.push({ kind: "screenshot", id: "s1", hash: "1111" });
    q.push({ kind: "event", id: "e2" });
    expect(q.push({ kind: "event", id: "e3" })).toBe("queued");
    expect(q.drain().map((item) => item.id)).toEqual(["e1", "e2", "e3"]);
    const stats = q.stats();
    expect(stats.drops.screenshot).toBe(1);
    expect(stats.drops.event).toBe(0);
    expect(stats.peakSize).toBe(3);
  });

  it("drops the incoming event only when no screenshot can be evicted", () => {
    const q = queue(2);
    q.push({ kind: "event", id: "e1" });
    q.push({ kind: "event", id: "e2" });
    expect(q.push({ kind: "event", id: "e3" })).toBe("dropped_event");
    expect(q.stats().drops.event).toBe(1);
    expect(q.shift()?.id).toBe("e1");
    expect(q.size).toBe(1);
    expect(() => queue(0)).toThrow();
  });
});
