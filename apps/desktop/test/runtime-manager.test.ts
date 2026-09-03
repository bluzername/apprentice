import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDataPaths, ensureDataDirs } from "../src/main/paths.js";
import { systemClock } from "../src/main/services/clock.js";
import { silentLogger } from "../src/main/services/logger.js";
import { buildHfServerArgs, buildLocalServerArgs } from "../src/main/services/model/llama-args.js";
import { MODEL_MANIFEST, type ModelManifest } from "../src/main/services/model/manifest.js";
import { RuntimeManager } from "../src/main/services/model/runtime-manager.js";
import { tempDir } from "./helpers.js";

const execFileAsync = promisify(execFile);
const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

const SERVER_JS = [
  "const args = process.argv.slice(2);",
  'if (args.includes("--version")) { console.log("version: 10752 (fake build)"); process.exit(0); }',
  'const port = Number(args[args.indexOf("--port") + 1]);',
  'require("node:http").createServer((req, res) => { if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ status: "ok" })); } else { res.writeHead(404); res.end(); } }).listen(port, "127.0.0.1");',
  'process.on("SIGTERM", () => process.exit(0));'
].join("\n");

describe("llama-server argument arrays", () => {
  it("match scripts/lib/llama-args.mjs exactly", () => {
    expect(buildLocalServerArgs({ modelPath: "/m.gguf", mmprojPath: "/p.gguf", port: 8000, logPath: "/l.log" })).toEqual(["-m", "/m.gguf", "--mmproj", "/p.gguf", "--host", "127.0.0.1", "--port", "8000", "-ngl", "99", "-c", "32768", "--alias", "UI_Mate", "--log-file", "/l.log"]);
    expect(buildHfServerArgs({ hfSpec: "repo:Q6_K", port: 8001, logPath: "/l.log", contextSize: 4096, gpuLayers: 10, alias: "x" })).toEqual(["-hf", "repo:Q6_K", "--host", "127.0.0.1", "--port", "8001", "-ngl", "10", "-c", "4096", "--alias", "x", "--log-file", "/l.log"]);
    expect(() => buildLocalServerArgs({ modelPath: "", mmprojPath: "/p", port: 1, logPath: "/l" })).toThrow(/modelPath/);
    expect(() => buildLocalServerArgs({ modelPath: "/m", mmprojPath: "/p", port: 70000, logPath: "/l" })).toThrow(/port/);
  });
});

describe("runtime manager", () => {
  let server: Server;
  let baseUrl: string;
  let manifest: ModelManifest;
  const files = new Map<string, Buffer>();

  beforeAll(async () => {
    const work = tempDir("fake-runtime-");
    const extracted = join(work, MODEL_MANIFEST.llamaCpp.extractedDir);
    mkdirSync(extracted, { recursive: true });
    writeFileSync(join(extracted, "server.js"), SERVER_JS);
    const wrapper = join(extracted, MODEL_MANIFEST.llamaCpp.serverBinary);
    writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/server.js" "$@"\n`);
    chmodSync(wrapper, 0o755);
    const tarball = join(work, MODEL_MANIFEST.llamaCpp.assetName);
    await execFileAsync("tar", ["-czf", tarball, "-C", work, MODEL_MANIFEST.llamaCpp.extractedDir]);
    const tar = readFileSync(tarball);
    const weights = Buffer.from("fake weights ".repeat(1000));
    const mmproj = Buffer.from("fake mmproj ".repeat(500));
    files.set(`/${MODEL_MANIFEST.llamaCpp.assetName}`, tar);
    files.set(`/${MODEL_MANIFEST.model.files.weights.file}`, weights);
    files.set(`/${MODEL_MANIFEST.model.files.mmproj.file}`, mmproj);
    server = createServer((req, res) => {
      const body = files.get(req.url ?? "");
      if (!body) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-length": String(body.length), "content-type": "application/octet-stream" });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    manifest = {
      ...MODEL_MANIFEST,
      llamaCpp: { ...MODEL_MANIFEST.llamaCpp, url: `${baseUrl}/${MODEL_MANIFEST.llamaCpp.assetName}`, size: tar.length, sha256: sha256(tar) },
      model: {
        ...MODEL_MANIFEST.model,
        files: {
          weights: { ...MODEL_MANIFEST.model.files.weights, url: `${baseUrl}/${MODEL_MANIFEST.model.files.weights.file}`, size: weights.length, sha256: sha256(weights) },
          mmproj: { ...MODEL_MANIFEST.model.files.mmproj, url: `${baseUrl}/${MODEL_MANIFEST.model.files.mmproj.file}`, size: mmproj.length, sha256: sha256(mmproj) }
        }
      }
    };
  });

  afterAll(() => {
    server.close();
  });

  it("installs the runtime from a verified tarball, installs the model with consent, and starts/stops the server", async () => {
    const paths = resolveDataPaths(tempDir("runtime-data-"));
    ensureDataDirs(paths);
    const states: string[] = [];
    const manager = new RuntimeManager({ paths, manifest, clock: systemClock, logger: silentLogger, healthTimeoutMs: 20_000, healthPollMs: 100, stopGraceMs: 2000 });
    manager.onChange((state) => states.push(state.processState));
    expect(manager.state()).toMatchObject({ runtimeInstalled: false, modelInstalled: false, processState: "stopped" });
    await expect(manager.start()).rejects.toThrow(/not installed/);
    const installed = await manager.installRuntime();
    expect(installed.runtimeInstalled).toBe(true);
    expect(installed.runtimeVersion).toBe(manifest.llamaCpp.release);
    const record = JSON.parse(readFileSync(manager.paths.installedJson, "utf8")) as { release: string; versionOutput: string };
    expect(record.release).toBe(manifest.llamaCpp.release);
    expect(record.versionOutput).toContain("10752");
    await expect(manager.installModel(false)).rejects.toThrow(/confirmation/);
    const withModel = await manager.installModel(true);
    expect(withModel.modelInstalled).toBe(true);
    expect(existsSync(manager.paths.modelJson)).toBe(true);
    const modelRecord = JSON.parse(readFileSync(manager.paths.modelJson, "utf8")) as { license: string; repo: string; sizes: Record<string, number> };
    expect(modelRecord).toMatchObject({ license: manifest.model.license, repo: manifest.model.repo });
    const running = await manager.start();
    expect(running.processState).toBe("running");
    expect(running.port).toBeGreaterThan(0);
    expect(manager.baseUrl()).toBe(`http://127.0.0.1:${running.port}/v1`);
    const health = await fetch(`http://127.0.0.1:${running.port}/health`);
    expect(health.status).toBe(200);
    expect(existsSync(running.logPath ?? "")).toBe(false);
    const stopped = await manager.stop();
    expect(stopped.processState).toBe("stopped");
    expect(manager.baseUrl()).toBeNull();
    expect(states).toContain("starting");
    expect(states).toContain("running");
  }, 60_000);

  it("rejects a tarball whose hash does not match the pin", async () => {
    const paths = resolveDataPaths(tempDir("runtime-bad-"));
    ensureDataDirs(paths);
    const bad = { ...manifest, llamaCpp: { ...manifest.llamaCpp, sha256: "0".repeat(64) } };
    const manager = new RuntimeManager({ paths, manifest: bad, clock: systemClock, logger: silentLogger });
    await expect(manager.installRuntime()).rejects.toThrow(/SHA-256 mismatch/);
    expect(manager.state().runtimeInstalled).toBe(false);
    expect(existsSync(manager.paths.tarballPath)).toBe(false);
  }, 30_000);
});
