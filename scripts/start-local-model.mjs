#!/usr/bin/env node
/**
 * Starts llama-server on a loopback port with the UI-Mate model, waits for
 * /health, prints the endpoint JSON and stays in the foreground.
 *
 *   node scripts/start-local-model.mjs [--port N] [--hf] [--timeout MS] [--json]
 *   node scripts/start-local-model.mjs --status [--json]
 *   node scripts/start-local-model.mjs --stop [--json]
 */
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { CliError, logProgress, parseCli, printResult, runMain } from "./lib/cli.mjs";
import { baseUrlForPort, buildHfServerArgs, buildLocalServerArgs, healthUrlForPort } from "./lib/llama-args.mjs";
import { locateLlamaServer, modelStatus, readJsonIfExists, runtimePaths } from "./lib/locate.mjs";
import { loadManifest } from "./lib/manifest.mjs";
import { findFreePort, isProcessAlive, spawnLogged, waitForHttpOk } from "./lib/spawn.mjs";

const options = {
  port: { type: "string" },
  hf: { type: "boolean", default: false },
  stop: { type: "boolean", default: false },
  status: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  timeout: { type: "string", default: "300000" }
};

const HEALTH_PROBE_TIMEOUT_MS = 2000;
const STOP_GRACE_MS = 10000;

async function readPidRecord(pidFile) {
  const record = await readJsonIfExists(pidFile);
  if (!record || !Number.isInteger(record.pid)) {
    return null;
  }
  return record;
}

async function probeHealth(port) {
  try {
    const response = await fetch(healthUrlForPort(port), { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) });
    await response.body?.cancel();
    return response.status === 200;
  } catch {
    return false;
  }
}

async function status(manifest) {
  const paths = runtimePaths(manifest);
  const record = await readPidRecord(paths.pidFile);
  if (!record) {
    return { ok: true, state: "stopped", pidFile: paths.pidFile };
  }
  if (!isProcessAlive(record.pid)) {
    await rm(paths.pidFile, { force: true });
    return { ok: true, state: "stopped", stalePidFileRemoved: true, pidFile: paths.pidFile, lastRecord: record };
  }
  const healthy = await probeHealth(record.port);
  return { ok: true, state: healthy ? "running" : "starting", healthy, ...record, pidFile: paths.pidFile };
}

async function stop(manifest) {
  const paths = runtimePaths(manifest);
  const record = await readPidRecord(paths.pidFile);
  if (!record) {
    return { ok: true, state: "stopped", stopped: false, message: "No pid file; nothing to stop" };
  }
  if (!isProcessAlive(record.pid)) {
    await rm(paths.pidFile, { force: true });
    return { ok: true, state: "stopped", stopped: false, message: `Process ${record.pid} was not running; stale pid file removed` };
  }
  process.kill(record.pid, "SIGTERM");
  const deadline = Date.now() + STOP_GRACE_MS;
  while (isProcessAlive(record.pid) && Date.now() < deadline) {
    await sleep(200);
  }
  let forced = false;
  if (isProcessAlive(record.pid)) {
    process.kill(record.pid, "SIGKILL");
    forced = true;
    await sleep(200);
  }
  await rm(paths.pidFile, { force: true });
  return { ok: true, state: "stopped", stopped: true, pid: record.pid, forced };
}

function parsePort(value) {
  if (value === undefined) {
    return undefined;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(`--port must be an integer between 1 and 65535, got ${value}`);
  }
  return port;
}

async function resolveServerArgs(manifest, { hf, port, logPath }) {
  const model = await modelStatus(manifest);
  const useHf = hf || model.mode === "hf-cache";
  if (useHf) {
    return { args: buildHfServerArgs({ hfSpec: manifest.model.hfSpec, port, logPath }), modelSource: "hf-cache", modelPath: null };
  }
  if (!model.installed) {
    throw new CliError(
      'UI-Mate model is not installed. Run "node scripts/install-uimate-model.mjs --yes" (or --use-hf-cache), or pass --hf.'
    );
  }
  return {
    args: buildLocalServerArgs({ modelPath: model.files.weights.path, mmprojPath: model.files.mmproj.path, port, logPath }),
    modelSource: "local",
    modelPath: model.files.weights.path
  };
}

async function tailLog(logPath, lines = 20) {
  try {
    return (await readFile(logPath, "utf8")).trim().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function forwardSignals(child) {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      logProgress(`Received ${signal}, stopping llama-server (pid ${child.pid})`);
      child.kill("SIGTERM");
    });
  }
}

async function start(manifest, args) {
  const current = await status(manifest);
  if (current.state !== "stopped") {
    return { ...current, alreadyRunning: true };
  }
  const paths = runtimePaths(manifest);
  const runtime = await locateLlamaServer(manifest);
  const port = parsePort(args.port) ?? (await findFreePort());
  await mkdir(paths.logsDir, { recursive: true });
  const logPath = join(paths.logsDir, `llama-server-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const { args: serverArgs, modelSource, modelPath } = await resolveServerArgs(manifest, { hf: args.hf, port, logPath });

  logProgress(`Starting ${runtime.serverPath} (${runtime.source}) on 127.0.0.1:${port}`);
  const child = await spawnLogged(runtime.serverPath, serverArgs, { cwd: runtime.cwd, logPath: `${logPath}.stdio` });
  const record = {
    pid: child.pid,
    port,
    baseUrl: baseUrlForPort(port),
    model: manifest.model.alias,
    modelSource,
    modelPath,
    serverPath: runtime.serverPath,
    logPath,
    startedAt: new Date().toISOString()
  };
  await mkdir(paths.base, { recursive: true });
  await writeFile(paths.pidFile, `${JSON.stringify(record, null, 2)}\n`);
  forwardSignals(child);

  const exitPromise = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  let exited = null;
  exitPromise.then((value) => {
    exited = value;
  });

  try {
    await waitForHttpOk(healthUrlForPort(port), Number(args.timeout), {
      shouldAbort: () => (exited ? `llama-server exited (code ${exited.code}, signal ${exited.signal})` : null)
    });
  } catch (error) {
    child.kill("SIGTERM");
    await rm(paths.pidFile, { force: true });
    const tail = await tailLog(`${logPath}.stdio`);
    throw new CliError(`${error.message}${tail ? `\nLast log lines:\n${tail}` : ""}`, { logPath });
  }

  printResult(
    { baseUrl: record.baseUrl, model: record.model, port, pid: child.pid, logPath, modelSource },
    { json: true }
  );
  const { code, signal } = await exitPromise;
  await rm(paths.pidFile, { force: true });
  logProgress(`llama-server exited (code ${code}, signal ${signal})`);
  process.exitCode = code ?? 0;
  return null;
}

const args = parseCli(options);
await runMain(
  async () => {
    const manifest = loadManifest();
    if (args.status) {
      printResult(await status(manifest), { json: args.json });
      return;
    }
    if (args.stop) {
      printResult(await stop(manifest), { json: args.json });
      return;
    }
    const result = await start(manifest, args);
    if (result) {
      printResult(result, { json: true });
    }
  },
  { json: true }
);
