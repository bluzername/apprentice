#!/usr/bin/env node
/**
 * Downloads the pinned UI-Mate-9B Q6_K GGUF and mmproj with resume and
 * checksum verification. Prints source, license and disk use first and
 * refuses to download without --yes or an interactive confirmation.
 *
 *   node scripts/install-uimate-model.mjs [--check] [--yes] [--json] [--use-hf-cache] [--verify]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError, formatBytes, logProgress, parseCli, printResult, progressReporter, requireConsent, runMain } from "./lib/cli.mjs";
import { downloadWithResume, verifyFile } from "./lib/download.mjs";
import { modelPaths, modelStatus } from "./lib/locate.mjs";
import { loadManifest } from "./lib/manifest.mjs";

const options = {
  check: { type: "boolean", default: false },
  yes: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  verify: { type: "boolean", default: false },
  "use-hf-cache": { type: "boolean", default: false }
};

export function downloadPlan(manifest) {
  const m = manifest.model;
  return {
    name: m.name,
    repo: m.repo,
    upstreamRepo: m.upstreamRepo,
    uiMateCommit: manifest.uiMateCommit,
    license: m.license,
    licenseHolder: m.licenseHolder,
    sourceUrls: m.sourceUrls,
    files: [
      { file: m.files.weights.file, size: m.files.weights.size, sha256: m.files.weights.sha256, url: m.files.weights.url },
      { file: m.files.mmproj.file, size: m.files.mmproj.size, sha256: m.files.mmproj.sha256, url: m.files.mmproj.url }
    ],
    expectedDownloadBytes: m.expectedDownloadBytes,
    expectedDiskBytes: m.expectedDiskBytes,
    memory: m.memoryRecommendation
  };
}

function planText(plan, destDir) {
  return [
    `Model:      ${plan.name} (${plan.repo}, upstream ${plan.upstreamRepo} @ ${plan.uiMateCommit.slice(0, 12)})`,
    `License:    ${plan.license} (${plan.licenseHolder})`,
    `Sources:    ${plan.sourceUrls.join(", ")}`,
    `Download:   ${formatBytes(plan.expectedDownloadBytes)} total`,
    ...plan.files.map((f) => `  - ${f.file}  ${formatBytes(f.size)}  sha256 ${f.sha256}`),
    `Disk use:   ${formatBytes(plan.expectedDiskBytes)} in ${destDir}`,
    `Memory:     ${plan.memory.recommendedUnifiedMemoryGb} GB unified memory recommended. ${plan.memory.note}`
  ].join("\n");
}

async function writeModelRecord(path, record) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
}

async function recordHfCacheMode(manifest) {
  const paths = modelPaths(manifest);
  const record = {
    mode: "hf-cache",
    repo: manifest.model.repo,
    hfSpec: manifest.model.hfSpec,
    alias: manifest.model.alias,
    license: manifest.model.license,
    uiMateCommit: manifest.uiMateCommit,
    installedAt: new Date().toISOString(),
    note: "No files were downloaded by this script. start-local-model.mjs --hf passes -hf to llama-server, which downloads into its own cache on first start."
  };
  await writeModelRecord(paths.modelJson, record);
  return { ok: true, ...(await modelStatus(manifest)) };
}

async function downloadFiles(manifest, plan, paths) {
  await mkdir(paths.dir, { recursive: true });
  const targets = [
    { spec: plan.files[0], dest: paths.weightsPath },
    { spec: plan.files[1], dest: paths.mmprojPath }
  ];
  const results = [];
  for (const { spec, dest } of targets) {
    logProgress(`Downloading ${spec.file} (${formatBytes(spec.size)})`);
    const result = await downloadWithResume(spec.url, dest, {
      expectedSize: spec.size,
      expectedSha256: spec.sha256,
      onProgress: progressReporter(spec.file)
    });
    logProgress(`${result.alreadyPresent ? "Already present and verified" : "Downloaded and verified"}: ${dest}`);
    results.push({ file: spec.file, path: dest, sha256: result.sha256, size: result.size, resumedFrom: result.resumedFrom });
  }
  return results;
}

async function install(manifest, args) {
  const paths = modelPaths(manifest);
  const plan = downloadPlan(manifest);
  const before = await modelStatus(manifest);
  if (before.installed && before.mode === "local") {
    return { ok: true, alreadyInstalled: true, ...before };
  }
  logProgress(planText(plan, paths.dir));
  await requireConsent({
    yes: args.yes,
    question: `Download ${formatBytes(plan.expectedDownloadBytes)} from Hugging Face now?`,
    hint: "Re-run with --yes to download non-interactively, or --use-hf-cache to let llama-server fetch the model itself."
  });
  const files = await downloadFiles(manifest, plan, paths);
  const record = {
    mode: "local",
    repo: manifest.model.repo,
    hfSpec: manifest.model.hfSpec,
    alias: manifest.model.alias,
    license: manifest.model.license,
    uiMateCommit: manifest.uiMateCommit,
    files: { weights: files[0].file, mmproj: files[1].file },
    sha256s: { weights: files[0].sha256, mmproj: files[1].sha256 },
    sizes: { weights: files[0].size, mmproj: files[1].size },
    installedAt: new Date().toISOString()
  };
  await writeModelRecord(paths.modelJson, record);
  return { ok: true, alreadyInstalled: false, downloads: files, ...(await modelStatus(manifest)) };
}

async function check(manifest, args) {
  const status = await modelStatus(manifest);
  if (!args.verify || status.mode !== "local") {
    return { ok: true, ...status, hashesVerified: false };
  }
  const m = manifest.model.files;
  await verifyFile(status.files.weights.path, m.weights.sha256, m.weights.size);
  await verifyFile(status.files.mmproj.path, m.mmproj.sha256, m.mmproj.size);
  return { ok: true, ...status, hashesVerified: true };
}

function humanStatus(status) {
  const line = (label, f) => `  ${label}: ${f.exists ? `${f.sizeOk ? "ok" : "WRONG SIZE"} (${f.size} bytes)` : "missing"}  ${f.path}`;
  return [
    `UI-Mate model: ${status.installed ? `installed (${status.mode})` : "not installed"}`,
    line("weights", status.files.weights),
    line("mmproj ", status.files.mmproj),
    ...(status.hashesVerified ? ["  sha256: verified"] : [])
  ];
}

const args = parseCli(options);
await runMain(
  async () => {
    const manifest = loadManifest();
    if (args.check) {
      printResult(await check(manifest, args), { json: args.json, human: humanStatus });
      return;
    }
    if (args["use-hf-cache"]) {
      printResult(await recordHfCacheMode(manifest), { json: args.json, human: humanStatus });
      return;
    }
    if (args.verify) {
      throw new CliError("--verify only applies together with --check");
    }
    printResult(await install(manifest, args), { json: args.json, human: humanStatus });
  },
  { json: args.json }
);
