/**
 * Process helpers. Every spawn takes an argument array and never a shell
 * string; `shell: true` is not reachable through this module.
 */
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

export const LOOPBACK_HOST = "127.0.0.1";
export const execFileAsync = promisify(execFile);

export function assertArgArray(args) {
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw new TypeError("Process arguments must be an array of strings (no shell strings)");
  }
  return args;
}

function assertCommand(cmd) {
  if (typeof cmd !== "string" || cmd.length === 0) {
    throw new TypeError("Command must be a non-empty string");
  }
  return cmd;
}

/**
 * Spawns `cmd` with `args`, appending stdout and stderr to `logPath`. When
 * `echo` is true the output is also mirrored to this process's stderr.
 * Resolves to the ChildProcess once the log file is open.
 */
export async function spawnLogged(cmd, args, { cwd, env, logPath, echo = false } = {}) {
  assertCommand(cmd);
  assertArgArray(args);
  if (typeof logPath !== "string" || logPath.length === 0) {
    throw new TypeError("spawnLogged requires logPath");
  }
  await mkdir(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: "a" });
  await once(log, "open");
  const child = spawn(cmd, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.pipe(log, { end: false });
    if (echo) {
      stream.pipe(process.stderr, { end: false });
    }
  }
  child.on("close", () => log.end());
  return child;
}

/** Runs a command to completion through spawnLogged and resolves with its exit code. */
export async function runLogged(cmd, args, options) {
  const child = await spawnLogged(cmd, args, options);
  const [code, signal] = await once(child, "close");
  return { code, signal };
}

export function findFreePort(host = LOOPBACK_HOST) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

/**
 * Polls `url` until it answers HTTP 200 or `timeoutMs` elapses. `shouldAbort`
 * may return a string reason to fail early (for example when the child exited).
 */
export async function waitForHttpOk(url, timeoutMs, { intervalMs = 500, shouldAbort = () => null, fetchImpl = globalThis.fetch } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response yet";
  while (Date.now() < deadline) {
    const abortReason = shouldAbort();
    if (abortReason) {
      throw new Error(`Gave up waiting for ${url}: ${abortReason}`);
    }
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(Math.max(intervalMs, 1000)) });
      if (response.status === 200) {
        await response.body?.cancel();
        return true;
      }
      lastError = `HTTP ${response.status}`;
      await response.body?.cancel();
    } catch (error) {
      lastError = error.message;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${url} (last: ${lastError})`);
}

/** Resolves the absolute path of `binary` on PATH, or null. */
export async function which(binary) {
  try {
    const { stdout } = await execFileAsync("which", [binary]);
    const found = stdout.trim();
    return found.length > 0 ? found : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
