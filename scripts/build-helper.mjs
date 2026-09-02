#!/usr/bin/env node
/**
 * Builds the Swift helper for arm64 and copies it into the desktop app's
 * resources so electron-builder can bundle it.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const helperDir = join(ROOT, "native", "mac-helper");
const outDir = join(ROOT, "apps", "desktop", "resources", "helper");
const binaryName = "apprentice-helper";

if (process.platform !== "darwin") {
  console.error("The native helper can only be built on macOS.");
  process.exit(1);
}
execFileSync("swift", ["build", "-c", "release", "--arch", "arm64", "--package-path", helperDir], { stdio: "inherit" });
const candidates = [
  join(helperDir, ".build", "arm64-apple-macosx", "release", binaryName),
  join(helperDir, ".build", "release", binaryName)
];
const built = candidates.find((p) => existsSync(p));
if (!built) {
  console.error(`Built helper binary not found. Looked in: ${candidates.join(", ")}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const dest = join(outDir, binaryName);
copyFileSync(built, dest);
execFileSync("chmod", ["755", dest]);
// Copy any resource bundles produced by SwiftPM next to the binary.
const releaseDir = join(built, "..");
for (const entry of readdirSync(releaseDir)) {
  if (entry.endsWith(".bundle") && statSync(join(releaseDir, entry)).isDirectory()) {
    execFileSync("cp", ["-R", join(releaseDir, entry), outDir]);
  }
}
const size = statSync(dest).size;
console.log(JSON.stringify({ helper: dest, bytes: size }));
