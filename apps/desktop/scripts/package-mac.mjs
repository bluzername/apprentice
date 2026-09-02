#!/usr/bin/env node
/**
 * Packages the arm64 .dmg and .zip. Detects a Developer ID identity and uses
 * it when present; otherwise falls back to ad hoc signing. Notarization runs
 * only when APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID are set.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const appDir = new URL("..", import.meta.url).pathname;
const root = join(appDir, "..", "..");

function detectIdentity() {
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false") return null;
  if (process.env.APPRENTICE_ADHOC_SIGN === "1") return null;
  try {
    const out = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
    const match = out.match(/"(Developer ID Application: [^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const identity = detectIdentity();
const notarize = Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);
const helper = join(appDir, "resources", "helper", "apprentice-helper");
if (!existsSync(helper)) {
  console.log("Helper binary missing; building it first.");
  execFileSync("node", [join(root, "scripts", "build-helper.mjs")], { stdio: "inherit" });
}
if (!existsSync(join(appDir, "out", "main", "index.js"))) {
  console.log("Renderer/main bundle missing; running electron-vite build.");
  execFileSync("pnpm", ["exec", "electron-vite", "build"], { stdio: "inherit", cwd: appDir });
}

const env = { ...process.env };
if (identity) {
  env.CSC_NAME = identity;
  console.log(`Signing with: ${identity}`);
} else {
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  console.log("No Developer ID identity found or ad hoc requested: electron-builder will ad hoc sign (identity '-').");
}
if (!notarize) {
  console.log("Notarization credentials not set (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID); skipping notarization.");
  delete env.APPLE_ID;
  delete env.APPLE_APP_SPECIFIC_PASSWORD;
  delete env.APPLE_TEAM_ID;
} else {
  console.log("Notarization credentials detected; electron-builder will notarize.");
}

const result = spawnSync("pnpm", ["exec", "electron-builder", "--mac", "--arm64", "--config", "electron-builder.yml"], { stdio: "inherit", cwd: appDir, env });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(JSON.stringify({ signed: identity ? "developer-id" : "ad-hoc", notarized: notarize, output: join(appDir, "release") }));
