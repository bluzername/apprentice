/**
 * Runs the CLI entry points as child processes against a temporary data
 * directory. No network access is required by any of these cases.
 */
import { execFile } from "node:child_process";
import { chmodSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnLogged } from "./lib/spawn.mjs";

const execFileAsync = promisify(execFile);
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const script = (name) => join(SCRIPTS, name);

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return null;
  }
}

let dataDir;
let baseEnv;

async function run(name, args, extraEnv = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script(name), ...args], {
      env: { ...baseEnv, ...extraEnv },
      timeout: 30000
    });
    return { code: 0, stdout, stderr, json: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr, json: parseJsonOrNull(error.stdout) };
  }
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "apprentice-scripts-"));
  baseEnv = {
    ...process.env,
    APPRENTICE_DATA_DIR: dataDir,
    APPRENTICE_LLAMA_SERVER: "",
    PATH: "/usr/bin:/bin"
  };
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("install-local-runtime.mjs", () => {
  it("--check --json reports not installed without touching the network", async () => {
    const { code, json } = await run("install-local-runtime.mjs", ["--check", "--json"]);
    expect(code).toBe(0);
    expect(json).toMatchObject({ ok: true, installed: false, envOverride: null, pathServer: null, tarballPresent: false });
    expect(json.installDir).toBe(join(dataDir, "runtime", "llama-b10752"));
    expect(json.expected.release).toBe("b10752");
  });
});

describe("install-uimate-model.mjs", () => {
  it("--check --json reports not installed", async () => {
    const { code, json } = await run("install-uimate-model.mjs", ["--check", "--json"]);
    expect(code).toBe(0);
    expect(json).toMatchObject({ ok: true, installed: false, mode: null });
    expect(json.files.weights.exists).toBe(false);
    expect(json.dir).toBe(join(dataDir, "models", "ui-mate-9b"));
  });

  it("refuses to download without --yes when not interactive", async () => {
    const { code, json, stderr } = await run("install-uimate-model.mjs", ["--json"]);
    expect(code).toBe(1);
    expect(json).toMatchObject({ ok: false, needsConfirmation: true });
    expect(stderr).toContain("Apache-2.0");
    expect(stderr).toContain("8.62 GB");
    expect(stderr).toContain("huggingface.co/bartowski/tencent_UI-Mate-9B-GGUF");
  });

  it("--use-hf-cache records the -hf mode without downloading", async () => {
    const { code, json } = await run("install-uimate-model.mjs", ["--use-hf-cache", "--json"]);
    expect(code).toBe(0);
    expect(json).toMatchObject({ ok: true, installed: true, mode: "hf-cache" });
    const record = JSON.parse(await readFile(join(dataDir, "models", "ui-mate-9b", "model.json"), "utf8"));
    expect(record.hfSpec).toBe("bartowski/tencent_UI-Mate-9B-GGUF:Q6_K");
    expect(record.mode).toBe("hf-cache");
  });
});

describe("start-local-model.mjs", () => {
  it("--status reports stopped", async () => {
    const { code, json } = await run("start-local-model.mjs", ["--status", "--json"]);
    expect(code).toBe(0);
    expect(json).toMatchObject({ ok: true, state: "stopped" });
  });

  it("--stop with nothing running is a no-op", async () => {
    const { code, json } = await run("start-local-model.mjs", ["--stop", "--json"]);
    expect(code).toBe(0);
    expect(json).toMatchObject({ ok: true, state: "stopped", stopped: false });
  });

  it("fails with guidance when no runtime is available", async () => {
    const { code, json } = await run("start-local-model.mjs", ["--json"]);
    expect(code).toBe(1);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/No llama-server found/);
    expect(json.error).toMatch(/APPRENTICE_LLAMA_SERVER/);
  });

  it("rejects a non-numeric --ctx before touching the runtime", async () => {
    const { code, json } = await run("start-local-model.mjs", ["--json", "--ctx", "lots"]);
    expect(code).toBe(1);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/--ctx must be an integer/);
  });

  it("starts a fake llama-server via APPRENTICE_LLAMA_SERVER, reports running, then stops it", async () => {
    const fakeDir = join(dataDir, "fake-runtime");
    const fakeScript = join(fakeDir, "fake-server.mjs");
    const fakeBinary = join(fakeDir, "llama-server");
    await mkdir(fakeDir, { recursive: true });
    await writeFile(
      fakeScript,
      [
        "import { createServer } from 'node:http';",
        "import { appendFileSync } from 'node:fs';",
        "const args = process.argv.slice(2);",
        "const get = (flag) => args[args.indexOf(flag) + 1];",
        "appendFileSync(get('--log-file'), JSON.stringify(args) + '\\n');",
        "const server = createServer((req, res) => { res.writeHead(req.url === '/health' ? 200 : 404); res.end('{\"status\":\"ok\"}'); });",
        "server.listen(Number(get('--port')), get('--host'));",
        "process.on('SIGTERM', () => { server.close(); process.exit(0); });"
      ].join("\n")
    );
    await writeFile(fakeBinary, `#!/bin/sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`);
    chmodSync(fakeBinary, 0o755);

    const child = await spawnLogged(process.execPath, [script("start-local-model.mjs"), "--json", "--ctx", "16384"], {
      env: { ...baseEnv, APPRENTICE_LLAMA_SERVER: fakeBinary },
      logPath: join(dataDir, "start-test.log")
    });
    const launcherExit = new Promise((resolve) => child.on("exit", resolve));
    const firstLine = await new Promise((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error(`start-local-model did not print JSON. Output so far: ${buffer}`)), 20000);
      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const end = buffer.indexOf("\n}");
        if (end !== -1) {
          clearTimeout(timer);
          resolve(buffer.slice(0, end + 2));
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`start-local-model exited early with code ${code}: ${buffer}`));
      });
    });
    const endpoint = JSON.parse(firstLine);
    expect(endpoint.model).toBe("UI_Mate");
    expect(endpoint.baseUrl).toBe(`http://127.0.0.1:${endpoint.port}/v1`);
    expect(endpoint.modelSource).toBe("hf-cache");
    expect(endpoint.contextSize).toBe(16384);
    expect(endpoint.pid).toBeGreaterThan(0);

    const health = await fetch(`http://127.0.0.1:${endpoint.port}/health`);
    expect(health.status).toBe(200);
    const loggedArgs = JSON.parse((await readFile(`${endpoint.logPath}`, "utf8")).split("\n")[0]);
    expect(loggedArgs.slice(0, 4)).toEqual(["-hf", "bartowski/tencent_UI-Mate-9B-GGUF:Q6_K", "--host", "127.0.0.1"]);
    expect(loggedArgs[loggedArgs.indexOf("-c") + 1]).toBe("16384");

    const status = await run("start-local-model.mjs", ["--status", "--json"]);
    expect(status.json).toMatchObject({ state: "running", healthy: true, port: endpoint.port, pid: endpoint.pid });

    const stop = await run("start-local-model.mjs", ["--stop", "--json"]);
    expect(stop.json).toMatchObject({ ok: true, stopped: true, pid: endpoint.pid });
    await launcherExit;
    const after = await run("start-local-model.mjs", ["--status", "--json"]);
    expect(after.json.state).toBe("stopped");
  }, 40000);
});

describe("setup-mlx-route.mjs", () => {
  it("--check --json reports no venv", async () => {
    const { code, json } = await run("setup-mlx-route.mjs", ["--check", "--json"]);
    expect(code).toBe(0);
    expect(json).toMatchObject({ ok: true, venvExists: false, converted: false, patches: [] });
    expect(json.venvDir).toBe(join(dataDir, "mlx-venv"));
    expect(json.expectedPins).toMatchObject({ "mlx-vlm": "0.6.17" });
  });

  it("--dry-run --json prints argument arrays for the official commands without executing", async () => {
    const { code, json } = await run("setup-mlx-route.mjs", ["--dry-run", "--json", "--port", "8123"]);
    expect(code).toBe(0);
    expect(json.dryRun).toBe(true);
    const { convert, serve, installPins } = json.commands;
    expect(convert[1]).toEqual([
      "-m",
      "mlx_vlm.convert",
      "--hf-path",
      "tencent/UI-Mate-9B",
      "--mlx-path",
      join(dataDir, "models", "UI-Mate-9B-mlx-6bit"),
      "-q",
      "--q-bits",
      "6",
      "--q-group-size",
      "64"
    ]);
    expect(serve[1]).toEqual(["-m", "mlx_vlm.server", "--model", join(dataDir, "models", "UI-Mate-9B-mlx-6bit"), "--host", "127.0.0.1", "--port", "8123"]);
    expect(installPins[1]).toContain("mlx-vlm==0.6.17");
    expect(json.serveEnv).toEqual({ KV_BITS: "4", PREFILL_STEP_SIZE: "1024" });
    expect(json.patchPolicy).toMatch(/No upstream cache patch/);
    const { json: check } = await run("setup-mlx-route.mjs", ["--check", "--json"]);
    expect(check.venvExists).toBe(false);
  });

  it("rejects --patch without a matching sha256 before touching anything", async () => {
    const patch = join(dataDir, "cache.diff");
    await writeFile(patch, "--- a/x\n+++ b/x\n");
    const { code, json } = await run("setup-mlx-route.mjs", ["--env-only", "--json", "--patch", patch, "--patch-sha256", "0".repeat(64)]);
    expect(code).toBe(1);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/Patch sha256 mismatch/);
    expect(json.error).toMatch(/Nothing was modified/);
    const { json: check } = await run("setup-mlx-route.mjs", ["--check", "--json"]);
    expect(check.venvExists).toBe(false);

    const missing = await run("setup-mlx-route.mjs", ["--env-only", "--json", "--patch", patch]);
    expect(missing.code).toBe(1);
    expect(missing.json.error).toMatch(/--patch-sha256/);
  });
});
