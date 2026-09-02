#!/usr/bin/env node
/**
 * Installs the pinned llama.cpp arm64 release into the app support directory.
 * No sudo, nothing system-wide, nothing executed before its checksum matches.
 *
 *   node scripts/install-local-runtime.mjs [--check] [--force] [--json]
 */
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { CliError, formatBytes, logProgress, parseCli, printResult, progressReporter, runMain } from "./lib/cli.mjs";
import { DownloadError, VerificationError, downloadWithResume, verifyFile } from "./lib/download.mjs";
import { LLAMA_SERVER_ENV, runtimePaths, runtimeStatus } from "./lib/locate.mjs";
import { loadManifest } from "./lib/manifest.mjs";
import { execFileAsync } from "./lib/spawn.mjs";

const options = {
  check: { type: "boolean", default: false },
  force: { type: "boolean", default: false },
  json: { type: "boolean", default: false }
};

export function homebrewFallbackText() {
  return [
    "Could not obtain the verified llama.cpp runtime.",
    "Fallback (your choice, nothing is run for you):",
    "  1. Install llama.cpp yourself, for example with Homebrew:  brew install llama.cpp",
    "  2. Point the app at that binary:",
    `       export ${LLAMA_SERVER_ENV}="$(brew --prefix)/bin/llama-server"`,
    "  3. Re-run: node scripts/start-local-model.mjs",
    "Any llama-server on PATH is also picked up automatically."
  ].join("\n");
}

async function runVersionCheck(serverPath, cwd, expected) {
  const { stdout, stderr } = await execFileAsync(serverPath, ["--version"], { cwd, timeout: 30000 });
  const output = `${stdout}\n${stderr}`;
  if (!output.includes(expected)) {
    throw new CliError(`llama-server --version did not report build ${expected}. Output: ${output.trim().slice(0, 300)}`);
  }
  return output.trim();
}

async function extractTarball(tarballPath, destDir) {
  await mkdir(destDir, { recursive: true });
  await execFileAsync("tar", ["-xzf", tarballPath, "-C", destDir], { timeout: 120000 });
}

async function install(manifest, { force, json }) {
  const paths = runtimePaths(manifest);
  const pin = manifest.llamaCpp;
  const before = await runtimeStatus(manifest);
  if (before.installed && !force) {
    return { ok: true, alreadyInstalled: true, ...before };
  }

  await mkdir(paths.downloadsDir, { recursive: true });
  logProgress(`Downloading llama.cpp ${pin.release} (${formatBytes(pin.size)}) from ${pin.url}`);
  let download;
  try {
    download = await downloadWithResume(pin.url, paths.tarballPath, {
      expectedSize: pin.size,
      expectedSha256: pin.sha256,
      onProgress: progressReporter("runtime download")
    });
  } catch (error) {
    if (error instanceof VerificationError || error instanceof DownloadError || error.name === "TypeError" || error.name === "AbortError") {
      throw new CliError(`Runtime download failed: ${error.message}`, { fallback: homebrewFallbackText() });
    }
    throw error;
  }
  logProgress(`Verified ${paths.tarballPath} (sha256 ${download.sha256}, ${download.size} bytes)`);

  // Verify again immediately before extraction so a swapped file cannot slip in.
  await verifyFile(paths.tarballPath, pin.sha256, pin.size);

  if (existsSync(paths.dir)) {
    logProgress(`Removing previous install at ${paths.dir}`);
    await rm(paths.dir, { recursive: true, force: true });
  }
  logProgress(`Extracting into ${paths.base}`);
  await extractTarball(paths.tarballPath, paths.base);
  if (!existsSync(paths.serverPath)) {
    throw new CliError(`Extraction did not produce ${paths.serverPath}; the release layout may have changed`);
  }

  const versionOutput = await runVersionCheck(paths.serverPath, paths.dir, pin.expectedVersionSubstring);
  const installedRecord = {
    release: pin.release,
    sha256: pin.sha256,
    size: pin.size,
    asset: pin.assetName,
    source: pin.url,
    verifiedAt: new Date().toISOString(),
    versionOutput
  };
  await writeFile(paths.installedJson, `${JSON.stringify(installedRecord, null, 2)}\n`);
  const after = await runtimeStatus(manifest);
  if (!json) {
    logProgress(`Installed llama.cpp ${pin.release} at ${paths.dir}`);
  }
  return { ok: true, alreadyInstalled: false, versionOutput, installedJson: paths.installedJson, ...after };
}

function humanStatus(status) {
  return [
    `llama.cpp runtime: ${status.installed ? `installed (${status.release})` : "not installed"}`,
    `  managed dir:   ${status.installDir}`,
    `  env override:  ${status.envOverride ?? "(none)"}${status.envOverride && !status.envOverrideValid ? " (missing!)" : ""}`,
    `  on PATH:       ${status.pathServer ?? "(none)"}`,
    ...(status.versionOutput ? [`  version:       ${status.versionOutput.split("\n")[0]}`] : [])
  ];
}

const args = parseCli(options);
await runMain(
  async () => {
    const manifest = loadManifest();
    if (args.check) {
      const status = await runtimeStatus(manifest);
      printResult({ ok: true, ...status, expected: { release: manifest.llamaCpp.release, sha256: manifest.llamaCpp.sha256 } }, { json: args.json, human: humanStatus });
      return;
    }
    const result = await install(manifest, args);
    printResult(result, { json: args.json, human: humanStatus });
  },
  { json: args.json }
);
