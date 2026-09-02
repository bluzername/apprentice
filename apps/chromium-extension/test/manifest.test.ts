import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EXTENSION_NAME } from "@apprentice/schemas";
import { buildManifest, chromeVersionFrom, readPackageVersion, writeManifest } from "../scripts/generate-manifest";
import { ICON_SVG, encodePng, rasterizeIcon, renderIconPng, writeIcons } from "../scripts/icons";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("manifest generation", () => {
  it("derives a Chrome-compatible version and keeps the alpha suffix as version_name", () => {
    expect(chromeVersionFrom("0.1.0-alpha.1")).toEqual({ version: "0.1.0", versionName: "0.1.0-alpha.1" });
    expect(chromeVersionFrom("1.2.3")).toEqual({ version: "1.2.3" });
    expect(() => chromeVersionFrom("nope")).toThrow();
  });

  it("builds a Manifest V3 that never requests incognito or static host access", async () => {
    const manifest = buildManifest(await readPackageVersion());
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe(EXTENSION_NAME);
    expect(manifest.incognito).toBe("not_allowed");
    expect(manifest.permissions).toEqual(["storage", "scripting", "downloads", "alarms", "tabs"]);
    expect(manifest.optional_host_permissions).toEqual(["https://*/*", "http://*/*"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest.background).toEqual({ service_worker: "background.js", type: "module" });
    expect(manifest.action.default_popup).toBe("popup.html");
    expect(manifest.icons).toEqual({ "16": "icons/icon-16.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" });
  });

  it("writes manifest.json and icons into a directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apprentice-ext-"));
    tempDirs.push(dir);
    const target = await writeManifest(dir);
    const written = JSON.parse(await readFile(target, "utf8")) as { name: string };
    expect(written.name).toBe(EXTENSION_NAME);
    const icons = await writeIcons(dir);
    expect(icons.files).toHaveLength(3);
    const png = await readFile(join(dir, "icons", "icon-16.png"));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await readFile(join(dir, "icons", "icon.svg"), "utf8")).toBe(ICON_SVG);
  });

  it("rasterizes the built-in fallback icon as a valid PNG", async () => {
    const rgba = rasterizeIcon(16);
    expect(rgba).toHaveLength(16 * 16 * 4);
    expect(rgba[3]).toBe(0);
    const centerAlpha = rgba[(8 * 16 + 8) * 4 + 3];
    expect(centerAlpha).toBe(255);
    const png = encodePng(16, 16, rgba);
    expect(png.subarray(12, 16).toString()).toBe(new TextEncoder().encode("IHDR").toString());
    const fallback = await renderIconPng(16, null);
    expect(fallback.length).toBeGreaterThan(50);
  });
});
