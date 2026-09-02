#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const helperDir = join(ROOT, "native", "mac-helper");
if (!existsSync(join(helperDir, "Package.swift"))) {
  console.error("native/mac-helper/Package.swift not found");
  process.exit(1);
}
if (process.platform !== "darwin") {
  console.error("Swift helper tests require macOS; refusing to fake a pass.");
  process.exit(1);
}
execFileSync("swift", ["test", "--package-path", helperDir], { stdio: "inherit" });
