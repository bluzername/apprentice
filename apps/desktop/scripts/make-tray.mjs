#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Resvg } = require("@resvg/resvg-js");
const dir = join(new URL("..", import.meta.url).pathname, "resources");
const svg = readFileSync(join(dir, "tray.svg"), "utf8");
writeFileSync(join(dir, "trayTemplate.png"), new Resvg(svg, { fitTo: { mode: "width", value: 22 } }).render().asPng());
writeFileSync(join(dir, "trayTemplate@2x.png"), new Resvg(svg, { fitTo: { mode: "width", value: 44 } }).render().asPng());
console.log("tray icons written");
