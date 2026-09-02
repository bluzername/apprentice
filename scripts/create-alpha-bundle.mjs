#!/usr/bin/env node
/**
 * Assembles dist/alpha/ with everything an alpha tester needs except model
 * weights: .dmg, .zip, extension zip, guides, checksums, release notes.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "dist", "alpha");
const releaseDir = join(ROOT, "apps", "desktop", "release");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = pkg.version;

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function find(dir, pattern) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => pattern.test(f)).map((f) => join(dir, f));
}

const dmgs = find(releaseDir, /arm64.*\.dmg$|\.dmg$/).filter((f) => !f.includes("blockmap"));
const zips = find(releaseDir, /arm64.*\.zip$|mac\.zip$|\.zip$/).filter((f) => !f.includes("blockmap"));
const extensionZip = join(ROOT, "apps", "chromium-extension", "dist", "apprentice-extension.zip");
const required = [
  { label: "desktop .dmg", files: dmgs },
  { label: "desktop .zip", files: zips },
  { label: "extension zip", files: existsSync(extensionZip) ? [extensionZip] : [] }
];
const missing = required.filter((r) => r.files.length === 0).map((r) => r.label);
if (missing.length > 0) {
  console.error(`Missing artifacts: ${missing.join(", ")}. Run pnpm build && pnpm package:mac first.`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const copied = [];
for (const src of [dmgs[0], zips[0], extensionZip]) {
  const dest = join(OUT, basename(src));
  copyFileSync(src, dest);
  copied.push(dest);
}
const docs = [
  ["docs/ALPHA_TEST_GUIDE.md", "ALPHA_TEST_GUIDE.md"],
  ["docs/KNOWN_LIMITATIONS.md", "KNOWN_LIMITATIONS.md"],
  ["docs/PRIVACY_MODEL.md", "PRIVACY_SUMMARY.md"],
  ["docs/RELEASE_NOTES.md", "RELEASE_NOTES.md"],
  ["docs/MODEL_SETUP.md", "MODEL_SETUP.md"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"]
];
for (const [src, name] of docs) {
  const full = join(ROOT, src);
  if (!existsSync(full)) {
    console.error(`Missing document ${src}`);
    process.exit(1);
  }
  const dest = join(OUT, name);
  copyFileSync(full, dest);
  copied.push(dest);
}
// Extension README travels with the zip so testers can install unpacked.
const extReadme = join(ROOT, "apps", "chromium-extension", "README.md");
if (existsSync(extReadme)) {
  const dest = join(OUT, "EXTENSION_INSTALL.md");
  copyFileSync(extReadme, dest);
  copied.push(dest);
}

const sums = copied.map((f) => `${sha256(f)}  ${basename(f)}`).join("\n") + "\n";
writeFileSync(join(OUT, "SHA256SUMS.txt"), sums);
const manifest = {
  product: "Apprentice",
  version,
  createdAt: new Date().toISOString(),
  arch: "arm64",
  minimumMacos: "14.0",
  files: copied.map((f) => ({ name: basename(f), bytes: statSync(f).size, sha256: sha256(f) })),
  modelWeightsIncluded: false,
  notarized: process.env.APPRENTICE_NOTARIZED === "1"
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ out: OUT, files: manifest.files.map((f) => `${f.name} (${f.bytes} bytes)`) }, null, 2));
