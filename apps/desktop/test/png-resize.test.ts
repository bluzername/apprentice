import { describe, expect, it } from "vitest";
import { encodePixelsToPng } from "@apprentice/core";
import { MODEL_MAX_LONG_EDGE, nodePngResizer, pngDimensions, resizeForModel } from "../src/main/services/images/png-resize.js";

function blankPng(width: number, height: number): Buffer {
  return encodePixelsToPng({ data: new Uint8Array(width * height * 4).fill(200), width, height, channels: 4 });
}

describe("resizeForModel", () => {
  it("caps a full-screen Retina capture at the model long edge before the official rounding", async () => {
    const resized = await resizeForModel(nodePngResizer, blankPng(3456, 2234), 3456, 2234);
    expect(MODEL_MAX_LONG_EDGE).toBe(1920);
    expect(resized.width).toBe(1920);
    // 2234 * (1920 / 3456) = 1241.1, rounded to the 32 px grid by process_image.
    expect(resized.height).toBe(1248);
    expect(pngDimensions(resized.png)).toEqual({ width: 1920, height: 1248 });
  });

  it("leaves a normal window capture below the cap on the official grid only", async () => {
    const resized = await resizeForModel(nodePngResizer, blankPng(1840, 984), 1840, 984);
    expect(resized.width).toBe(1856);
    expect(resized.height).toBe(992);
  });

  it("returns the input untouched when it already matches", async () => {
    const png = blankPng(1280, 800);
    const resized = await resizeForModel(nodePngResizer, png, 1280, 800);
    expect(resized.png).toBe(png);
  });
});
