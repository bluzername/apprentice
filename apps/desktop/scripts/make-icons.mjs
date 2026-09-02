#!/usr/bin/env node
/** Renders resources/icon.svg into icon.icns (via iconutil) and icon.png. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Resvg } = require("@resvg/resvg-js");
const dir = join(new URL("..", import.meta.url).pathname, "resources");
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
const iconset = join(dir, "icon.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
const render = (size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
for (const base of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${base}x${base}.png`), render(base));
  writeFileSync(join(iconset, `icon_${base}x${base}@2x.png`), render(base * 2));
}
writeFileSync(join(dir, "icon.png"), render(1024));
writeFileSync(join(dir, "trayTemplate.png"), render(22));
writeFileSync(join(dir, "trayTemplate@2x.png"), render(44));
execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(dir, "icon.icns")]);
rmSync(iconset, { recursive: true, force: true });
console.log(JSON.stringify({ icns: existsSync(join(dir, "icon.icns")), png: join(dir, "icon.png") }));
