import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { SCREEN_HEIGHT, SCREEN_WIDTH, TEMPLATE_NAMES } from "../types.js";
import { COLORS, SCREEN_TEMPLATES, TARGETS, renderSvgToPng, renderTemplatePng, renderTemplateSvg } from "./index.js";

function hexToRgb(hex: string): readonly [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function pixel(png: PNG, x: number, y: number): readonly [number, number, number] {
  const offset = (png.width * y + x) * 4;
  return [png.data[offset] ?? -1, png.data[offset + 1] ?? -1, png.data[offset + 2] ?? -1];
}

const ACCENT = hexToRgb(COLORS.accent);
const HIGHLIGHT = hexToRgb(COLORS.highlight);

describe("screen templates", () => {
  it("exposes every template name exactly once", () => {
    expect(Object.keys(SCREEN_TEMPLATES).sort()).toEqual([...TEMPLATE_NAMES].sort());
    expect(Object.keys(TARGETS).sort()).toEqual([...TEMPLATE_NAMES].sort());
  });

  it.each(TEMPLATE_NAMES)("%s renders a 1440x900 PNG", (name) => {
    const png = PNG.sync.read(renderTemplatePng(name));
    expect(png.width).toBe(SCREEN_WIDTH);
    expect(png.height).toBe(SCREEN_HEIGHT);
  });

  it.each(TEMPLATE_NAMES)("%s target lies inside the primary button and the button is painted", (name) => {
    const { primaryButton, primaryLabel } = SCREEN_TEMPLATES[name];
    const target = TARGETS[name];
    expect(target.label).toBe(primaryLabel);
    expect(target.x).toBeGreaterThan(primaryButton.x);
    expect(target.x).toBeLessThan(primaryButton.x + primaryButton.width);
    expect(target.y).toBeGreaterThan(primaryButton.y);
    expect(target.y).toBeLessThan(primaryButton.y + primaryButton.height);
    const png = PNG.sync.read(renderTemplatePng(name));
    const inset = 8;
    const corners = [
      [primaryButton.x + inset, primaryButton.y + inset],
      [primaryButton.x + primaryButton.width - inset, primaryButton.y + inset],
      [primaryButton.x + inset, primaryButton.y + primaryButton.height - inset],
      [primaryButton.x + primaryButton.width - inset, primaryButton.y + primaryButton.height - inset]
    ] as const;
    corners.forEach(([x, y]) => expect(pixel(png, x, y)).toEqual(ACCENT));
  });

  it.each(TEMPLATE_NAMES)("%s honours title, label, and highlight variants", (name) => {
    const { primaryButton } = SCREEN_TEMPLATES[name];
    const svg = renderTemplateSvg(name, { title: "Variant Title ZZ", primaryLabel: "Do it", highlight: primaryButton });
    expect(svg).toContain("Variant Title ZZ");
    expect(svg).toContain("Do it");
    const png = PNG.sync.read(renderSvgToPng(svg));
    const ringX = primaryButton.x - 6;
    const ringY = primaryButton.y + Math.round(primaryButton.height / 2);
    expect(pixel(png, ringX, ringY)).toEqual(HIGHLIGHT);
  });

  it("escapes markup in variant text", () => {
    const svg = renderTemplateSvg("genericBlank", { title: "<script>alert(1)</script>" });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("rejects SVGs that do not rasterize to the fixture size", () => {
    expect(() => renderSvgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')).toThrow(/expected 1440x900/);
  });
});
