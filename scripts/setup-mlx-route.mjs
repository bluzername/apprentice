#!/usr/bin/env node
/**
 * Advanced MLX 6-bit route following the official UI-Mate MLX guidance.
 * Creates a private venv under the app support directory, installs pinned
 * packages, converts tencent/UI-Mate-9B to 6-bit MLX weights (only with
 * --yes or confirmation: multi-GB download) and starts mlx_vlm.server on a
 * loopback port. No upstream cache patch is applied unless --patch is given.
 *
 *   node scripts/setup-mlx-route.mjs [--env-only | --convert | --serve] [--yes] [--json]
 *   node scripts/setup-mlx-route.mjs --check | --dry-run | --resolve-pins
 *   node scripts/setup-mlx-route.mjs --patch <diff> --patch-sha256 <hex> --env-only
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CliError, formatBytes, logProgress, parseCli, printResult, requireConsent, runMain } from "./lib/cli.mjs";
import { sha256File } from "./lib/download.mjs";
import { readJsonIfExists } from "./lib/locate.mjs";
import { MANIFEST_PATH, loadManifest } from "./lib/manifest.mjs";
import { logsDir, mlxVenvDir, modelsDir } from "./lib/paths.mjs";
import { resolveMlxPins } from "./lib/pypi.mjs";
import { LOOPBACK_HOST, execFileAsync, findFreePort, runLogged, spawnLogged, waitForHttpOk, which } from "./lib/spawn.mjs";

const options = {
  check: { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false },
  "env-only": { type: "boolean", default: false },
  convert: { type: "boolean", default: false },
  serve: { type: "boolean", default: false },
  "resolve-pins": { type: "boolean", default: false },
  yes: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  port: { type: "string" },
  "mlx-path": { type: "string" },
  patch: { type: "string" },
  "patch-sha256": { type: "string" },
  timeout: { type: "string", default: "600000" }
};

const SYSTEM_PYTHON = "/usr/local/bin/python3";

function venvPaths() {
  const dir = mlxVenvDir();
  return {
    dir,
    python: join(dir, "bin", "python"),
    record: join(dir, "VENV.json"),
    patches: join(dir, "PATCHES.json")
  };
}

function pinSpecs(manifest) {
  return Object.entries(manifest.mlxPins).map(([name, version]) => `${name}==${version}`);
}

async function findPython() {
  const candidates = [SYSTEM_PYTHON, await which("python3"), await which("python")].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new CliError("No python3 found. Install Python 3.10+ (python.org or Homebrew); this script never installs it for you.");
  }
  return found;
}

export async function planCommands(manifest, { mlxPath, port }) {
  const venv = venvPaths();
  const uv = await which("uv");
  const python = await findPython();
  const pins = pinSpecs(manifest);
  const createVenv = uv ? [uv, ["venv", venv.dir, "--python", python]] : [python, ["-m", "venv", venv.dir]];
  const installPins = uv ? [uv, ["pip", "install", "--python", venv.python, ...pins]] : [venv.python, ["-m", "pip", "install", ...pins]];
  const convert = [
    venv.python,
    ["-m", "mlx_vlm.convert", "--hf-path", manifest.mlx.hfPath, "--mlx-path", mlxPath, "-q", "--q-bits", String(manifest.mlx.quantBits), "--q-group-size", String(manifest.mlx.groupSize)]
  ];
  const serve = [venv.python, ["-m", "mlx_vlm.server", "--model", mlxPath, "--host", LOOPBACK_HOST, "--port", String(port)]];
  return { python, uv, pins, createVenv, installPins, convert, serve, serveEnv: manifest.mlx.env };
}

async function installedVersion(pythonPath, distribution) {
  try {
    const { stdout } = await execFileAsync(pythonPath, ["-c", `import importlib.metadata as m; print(m.version(${JSON.stringify(distribution)}))`], { timeout: 30000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function check(manifest, mlxPath) {
  const venv = venvPaths();
  const venvExists = existsSync(venv.python);
  const mlxVlm = venvExists ? await installedVersion(venv.python, "mlx-vlm") : null;
  const mlx = venvExists ? await installedVersion(venv.python, "mlx") : null;
  const convertedExists = existsSync(join(mlxPath, "config.json"));
  return {
    ok: true,
    venvDir: venv.dir,
    venvExists,
    installed: { "mlx-vlm": mlxVlm, mlx },
    pinsMatch: mlxVlm === manifest.mlxPins["mlx-vlm"] && mlx === manifest.mlxPins.mlx,
    expectedPins: manifest.mlxPins,
    mlxPath,
    converted: convertedExists,
    patches: (await readJsonIfExists(venv.patches)) ?? [],
    uv: await which("uv"),
    python: await findPython().catch(() => null)
  };
}

async function ensureEnv(manifest, plan) {
  const venv = venvPaths();
  const logPath = join(logsDir(), "mlx-setup.log");
  if (!existsSync(venv.python)) {
    logProgress(`Creating venv at ${venv.dir}`);
    const { code } = await runLogged(plan.createVenv[0], plan.createVenv[1], { logPath, echo: true });
    if (code !== 0) {
      throw new CliError(`venv creation failed (exit ${code}); see ${logPath}`);
    }
  }
  const current = await installedVersion(venv.python, "mlx-vlm");
  if (current !== manifest.mlxPins["mlx-vlm"]) {
    logProgress(`Installing pinned packages: ${plan.pins.join(" ")}`);
    const { code } = await runLogged(plan.installPins[0], plan.installPins[1], { logPath, echo: true });
    if (code !== 0) {
      throw new CliError(`pip install failed (exit ${code}); see ${logPath}`);
    }
  }
  await writeFile(venv.record, `${JSON.stringify({ python: plan.python, uv: plan.uv, pins: manifest.mlxPins, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

async function sitePackagesDir(pythonPath) {
  const { stdout } = await execFileAsync(pythonPath, ["-c", "import sysconfig; print(sysconfig.get_paths()['purelib'])"], { timeout: 30000 });
  return stdout.trim();
}

/** Verifies the patch file hash. Pure check, runs before any side effect. */
async function verifyPatchFile(patchArg, expectedSha256) {
  if (!expectedSha256 || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new CliError("--patch requires --patch-sha256 <64 hex chars>");
  }
  const patchPath = resolve(patchArg);
  if (!existsSync(patchPath)) {
    throw new CliError(`Patch file not found: ${patchPath}`);
  }
  const actual = await sha256File(patchPath);
  if (actual !== expectedSha256) {
    throw new CliError(`Patch sha256 mismatch: expected ${expectedSha256}, found ${actual}. Nothing was modified.`);
  }
  return { patchPath, sha256: actual };
}

async function applyVerifiedPatch({ patchPath, sha256: actual }) {
  const venv = venvPaths();
  const cwd = await sitePackagesDir(venv.python);
  await execFileAsync("git", ["apply", "--check", patchPath], { cwd });
  const { stdout } = await execFileAsync("git", ["apply", "--numstat", patchPath], { cwd });
  const files = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t")[2]);
  await execFileAsync("git", ["apply", patchPath], { cwd });
  const existing = (await readJsonIfExists(venv.patches)) ?? [];
  const entry = { patch: patchPath, sha256: actual, sitePackages: cwd, files, appliedAt: new Date().toISOString() };
  await writeFile(venv.patches, `${JSON.stringify([...existing, entry], null, 2)}\n`);
  logProgress(`Applied patch ${patchPath} to ${files.length} file(s); recorded in ${venv.patches}`);
  return entry;
}

async function convert(manifest, plan, mlxPath, yes) {
  if (existsSync(join(mlxPath, "config.json"))) {
    logProgress(`Converted weights already present at ${mlxPath}`);
    return { converted: true, skipped: true };
  }
  logProgress(
    [
      `Source:   ${manifest.mlx.hfPath} (${manifest.model.license}, ${manifest.model.licenseHolder})`,
      `Download: about ${formatBytes(manifest.mlx.expectedDownloadBytes)} into the Hugging Face cache (estimate)`,
      `Disk use: about ${formatBytes(manifest.mlx.expectedDiskBytes)} total; output ${mlxPath}`,
      `Command:  ${plan.convert[0]} ${plan.convert[1].join(" ")}`
    ].join("\n")
  );
  await requireConsent({ yes, question: "Download the upstream checkpoint and convert to 6-bit MLX now?", hint: "Re-run with --yes to convert non-interactively." });
  await mkdir(modelsDir(), { recursive: true });
  const { code } = await runLogged(plan.convert[0], plan.convert[1], { logPath: join(logsDir(), "mlx-convert.log"), echo: true });
  if (code !== 0) {
    throw new CliError(`mlx_vlm.convert failed (exit ${code})`);
  }
  return { converted: true, skipped: false };
}

async function serve(plan, mlxPath, port, timeoutMs) {
  if (!existsSync(join(mlxPath, "config.json"))) {
    throw new CliError(`No converted MLX weights at ${mlxPath}. Run without --serve first (or with --convert).`);
  }
  const logPath = join(logsDir(), `mlx-server-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const child = await spawnLogged(plan.serve[0], plan.serve[1], { env: plan.serveEnv, logPath });
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill("SIGTERM"));
  }
  try {
    await waitForHttpOk(`http://${LOOPBACK_HOST}:${port}/health`, timeoutMs, {
      shouldAbort: () => (exited ? `mlx_vlm.server exited (code ${exited.code})` : null)
    });
  } catch (error) {
    child.kill("SIGTERM");
    const tail = (await readFile(logPath, "utf8").catch(() => "")).trim().split("\n").slice(-20).join("\n");
    throw new CliError(`${error.message}${tail ? `\nLast log lines:\n${tail}` : ""}`);
  }
  printResult({ baseUrl: `http://${LOOPBACK_HOST}:${port}/v1`, model: mlxPath, port, pid: child.pid, logPath, route: "mlx" }, { json: true });
  await new Promise((done) => child.on("exit", done));
  process.exitCode = exited?.code ?? 0;
}

async function resolvePins(manifest) {
  const resolved = await resolveMlxPins(manifest.mlxVlmVersion);
  const raw = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const updated = { ...raw, mlxPins: resolved.pins, mlxPinsResolvedAt: resolved.resolvedAt, mlxPinsSource: resolved.source };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(updated, null, 2)}\n`);
  return { ok: true, ...resolved, manifest: MANIFEST_PATH };
}

const args = parseCli(options);
await runMain(
  async () => {
    const manifest = loadManifest();
    const mlxPath = args["mlx-path"] ? resolve(args["mlx-path"]) : join(modelsDir(), manifest.mlx.outputDirName);
    if (args.check) {
      printResult(await check(manifest, mlxPath), { json: args.json });
      return;
    }
    if (args["resolve-pins"]) {
      printResult(await resolvePins(manifest), { json: args.json });
      return;
    }
    const port = args.port ? Number(args.port) : await findFreePort();
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new CliError(`--port must be an integer between 1 and 65535, got ${args.port}`);
    }
    const plan = await planCommands(manifest, { mlxPath, port });
    if (args["dry-run"]) {
      printResult(
        {
          ok: true,
          dryRun: true,
          venvDir: venvPaths().dir,
          mlxPath,
          port,
          commands: { createVenv: plan.createVenv, installPins: plan.installPins, convert: plan.convert, serve: plan.serve },
          serveEnv: plan.serveEnv,
          patchPolicy: manifest.mlx.patchPolicy
        },
        { json: args.json }
      );
      return;
    }
    const verifiedPatch = args.patch ? await verifyPatchFile(args.patch, args["patch-sha256"]) : null;
    if (!args.serve) {
      await ensureEnv(manifest, plan);
    }
    const patch = verifiedPatch ? await applyVerifiedPatch(verifiedPatch) : null;
    if (args["env-only"]) {
      printResult({ ok: true, ...(await check(manifest, mlxPath)), patch }, { json: args.json });
      return;
    }
    if (!args.serve) {
      await convert(manifest, plan, mlxPath, args.yes);
      if (args.convert) {
        printResult({ ok: true, ...(await check(manifest, mlxPath)), patch }, { json: args.json });
        return;
      }
    }
    await serve(plan, mlxPath, port, Number(args.timeout));
  },
  { json: args.json }
);
