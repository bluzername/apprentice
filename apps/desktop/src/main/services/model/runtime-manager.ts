import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { LOOPBACK_HOST, type LocalRuntimeState } from "@apprentice/schemas";
import type { DataPaths } from "../../paths.js";
import type { Clock } from "../clock.js";
import { ServiceError } from "../errors.js";
import type { Logger } from "../logger.js";
import { downloadWithResume, verifyFile, type DownloadProgress } from "./download.js";
import { baseUrlForPort, buildLocalServerArgs, healthUrlForPort } from "./llama-args.js";
import { MODEL_DIR_NAME, type ModelManifest } from "./manifest.js";

const execFileAsync = promisify(execFile);

export interface RuntimeManagerDeps {
  readonly paths: DataPaths;
  readonly manifest: ModelManifest;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly fetchImpl?: typeof fetch;
  readonly healthTimeoutMs?: number;
  readonly healthPollMs?: number;
  readonly stopGraceMs?: number;
}

export interface RuntimePaths {
  readonly dir: string;
  readonly serverPath: string;
  readonly installedJson: string;
  readonly downloadsDir: string;
  readonly tarballPath: string;
  readonly modelDir: string;
  readonly weightsPath: string;
  readonly mmprojPath: string;
  readonly modelJson: string;
}

export function runtimePathsFor(paths: DataPaths, manifest: ModelManifest): RuntimePaths {
  const dir = join(paths.runtime, manifest.llamaCpp.extractedDir);
  const modelDir = join(paths.models, MODEL_DIR_NAME);
  return {
    dir,
    serverPath: join(dir, manifest.llamaCpp.serverBinary),
    installedJson: join(dir, "INSTALLED.json"),
    downloadsDir: join(paths.runtime, "downloads"),
    tarballPath: join(paths.runtime, "downloads", manifest.llamaCpp.assetName),
    modelDir,
    weightsPath: join(modelDir, manifest.model.files.weights.file),
    mmprojPath: join(modelDir, manifest.model.files.mmproj.file),
    modelJson: join(modelDir, "model.json")
  };
}

export function findFreePort(host = LOOPBACK_HOST): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Managed llama.cpp runtime: verified install, model download with consent,
 * start/stop of llama-server on a loopback port with argument arrays only.
 */
export class RuntimeManager {
  readonly paths: RuntimePaths;
  private child: ChildProcess | null = null;
  private processState: LocalRuntimeState["processState"] = "stopped";
  private port: number | undefined;
  private logPath: string | undefined;
  private lastError: string | undefined;
  private download: LocalRuntimeState["download"] | undefined;
  private downloadController: AbortController | null = null;
  private listeners: ReadonlyArray<(state: LocalRuntimeState) => void> = [];

  constructor(private readonly deps: RuntimeManagerDeps) {
    this.paths = runtimePathsFor(deps.paths, deps.manifest);
  }

  onChange(listener: (state: LocalRuntimeState) => void): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  private notify(): void {
    const state = this.stateSync();
    for (const listener of this.listeners) listener(state);
  }

  private stateSync(): LocalRuntimeState {
    const runtimeInstalled = existsSync(this.paths.serverPath) && existsSync(this.paths.installedJson);
    const modelInstalled = existsSync(this.paths.weightsPath) && existsSync(this.paths.mmprojPath) && existsSync(this.paths.modelJson);
    return {
      runtimeInstalled,
      runtimeVersion: runtimeInstalled ? this.deps.manifest.llamaCpp.release : undefined,
      modelInstalled,
      modelPath: modelInstalled ? this.paths.weightsPath : undefined,
      processState: this.processState,
      port: this.port,
      pid: this.child?.pid ?? undefined,
      lastError: this.lastError,
      download: this.download,
      logPath: this.logPath
    };
  }

  state(): LocalRuntimeState {
    return this.stateSync();
  }

  isRunning(): boolean {
    return this.processState === "running" && this.child !== null;
  }

  baseUrl(): string | null {
    return this.isRunning() && this.port !== undefined ? baseUrlForPort(this.port) : null;
  }

  private setDownload(progress: DownloadProgress | null, active: boolean): void {
    this.download = progress ? { active, receivedBytes: progress.receivedBytes, totalBytes: progress.totalBytes, file: progress.file.split("/").pop()?.slice(0, 200) } : undefined;
    this.notify();
  }

  async installRuntime(): Promise<LocalRuntimeState> {
    const pin = this.deps.manifest.llamaCpp;
    if (this.stateSync().runtimeInstalled) return this.stateSync();
    await mkdir(this.paths.downloadsDir, { recursive: true });
    this.downloadController = new AbortController();
    try {
      await downloadWithResume(pin.url, this.paths.tarballPath, {
        expectedSize: pin.size,
        expectedSha256: pin.sha256,
        fetchImpl: this.deps.fetchImpl,
        signal: this.downloadController.signal,
        onProgress: (progress) => this.setDownload(progress, true)
      });
      await verifyFile(this.paths.tarballPath, pin.sha256, pin.size);
      if (existsSync(this.paths.dir)) await rm(this.paths.dir, { recursive: true, force: true });
      await mkdir(this.deps.paths.runtime, { recursive: true });
      await execFileAsync("tar", ["-xzf", this.paths.tarballPath, "-C", this.deps.paths.runtime], { timeout: 120_000 });
      if (!existsSync(this.paths.serverPath)) throw new ServiceError("runtime_layout", `Extraction did not produce ${this.paths.serverPath}`);
      const versionOutput = await this.versionOutput();
      if (!versionOutput.includes(pin.expectedVersionSubstring)) {
        throw new ServiceError("runtime_version", `llama-server --version did not report build ${pin.expectedVersionSubstring}: ${versionOutput.slice(0, 200)}`);
      }
      const record = { release: pin.release, sha256: pin.sha256, size: pin.size, asset: pin.assetName, source: pin.url, verifiedAt: new Date(this.deps.clock.now()).toISOString(), versionOutput: versionOutput.slice(0, 500) };
      await writeFile(this.paths.installedJson, `${JSON.stringify(record, null, 2)}\n`);
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message.slice(0, 500) : String(error);
      throw error;
    } finally {
      this.downloadController = null;
      this.setDownload(null, false);
    }
    return this.stateSync();
  }

  private async versionOutput(): Promise<string> {
    const { stdout, stderr } = await execFileAsync(this.paths.serverPath, ["--version"], { cwd: this.paths.dir, timeout: 30_000 });
    return `${stdout}\n${stderr}`.trim();
  }

  async installModel(confirmed: boolean): Promise<LocalRuntimeState> {
    if (!confirmed) throw new ServiceError("consent_required", "Model download requires explicit confirmation of the source, license, and size");
    const model = this.deps.manifest.model;
    if (this.stateSync().modelInstalled) return this.stateSync();
    await mkdir(this.paths.modelDir, { recursive: true });
    this.downloadController = new AbortController();
    try {
      const targets = [
        { spec: model.files.weights, dest: this.paths.weightsPath },
        { spec: model.files.mmproj, dest: this.paths.mmprojPath }
      ];
      const downloaded: Array<{ file: string; sha256: string; size: number }> = [];
      for (const { spec, dest } of targets) {
        const result = await downloadWithResume(spec.url, dest, {
          expectedSize: spec.size,
          expectedSha256: spec.sha256,
          fetchImpl: this.deps.fetchImpl,
          signal: this.downloadController.signal,
          onProgress: (progress) => this.setDownload(progress, true)
        });
        downloaded.push({ file: spec.file, sha256: result.sha256, size: result.size });
      }
      const record = {
        mode: "local",
        repo: model.repo,
        hfSpec: model.hfSpec,
        alias: model.alias,
        license: model.license,
        licenseHolder: model.licenseHolder,
        sourceUrls: model.sourceUrls,
        uiMateCommit: this.deps.manifest.uiMateCommit,
        files: { weights: model.files.weights.file, mmproj: model.files.mmproj.file },
        sha256s: Object.fromEntries(downloaded.map((entry) => [entry.file, entry.sha256])),
        sizes: Object.fromEntries(downloaded.map((entry) => [entry.file, entry.size])),
        installedAt: new Date(this.deps.clock.now()).toISOString()
      };
      await writeFile(this.paths.modelJson, `${JSON.stringify(record, null, 2)}\n`);
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message.slice(0, 500) : String(error);
      throw error;
    } finally {
      this.downloadController = null;
      this.setDownload(null, false);
    }
    return this.stateSync();
  }

  cancelDownload(): LocalRuntimeState {
    this.downloadController?.abort(new Error("Download cancelled"));
    return this.stateSync();
  }

  async start(): Promise<LocalRuntimeState> {
    if (this.isRunning()) return this.stateSync();
    const state = this.stateSync();
    if (!state.runtimeInstalled) throw new ServiceError("runtime_missing", "The llama.cpp runtime is not installed");
    if (!state.modelInstalled) throw new ServiceError("model_missing", "The UI-Mate model is not installed");
    const record = await readJson(this.paths.installedJson);
    if (record?.["release"] !== this.deps.manifest.llamaCpp.release) throw new ServiceError("runtime_version", "Installed runtime does not match the pinned release");
    const port = await findFreePort();
    await mkdir(this.deps.paths.logs, { recursive: true });
    const stamp = new Date(this.deps.clock.now()).toISOString().replace(/[:.]/g, "-");
    const logPath = join(this.deps.paths.logs, `llama-server-${stamp}.log`);
    const args = buildLocalServerArgs({
      modelPath: this.paths.weightsPath,
      mmprojPath: this.paths.mmprojPath,
      port,
      logPath,
      contextSize: this.deps.manifest.model.contextSize,
      gpuLayers: this.deps.manifest.model.gpuLayers,
      alias: this.deps.manifest.model.alias
    });
    this.processState = "starting";
    this.port = port;
    this.logPath = logPath;
    this.lastError = undefined;
    this.notify();
    const stdio = createWriteStream(`${logPath}.stdio`, { flags: "a" });
    const child = spawn(this.paths.serverPath, args, { cwd: this.paths.dir, stdio: ["ignore", "pipe", "pipe"], shell: false });
    child.stdout?.pipe(stdio, { end: false });
    child.stderr?.pipe(stdio, { end: false });
    this.child = child;
    let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    child.once("exit", (code, signal) => {
      exited = { code, signal };
      stdio.end();
      if (this.child === child) {
        this.child = null;
        this.processState = this.processState === "stopping" ? "stopped" : "error";
        if (this.processState === "error") this.lastError = `llama-server exited (code ${String(code)}, signal ${String(signal)})`;
        this.notify();
      }
    });
    try {
      await this.waitForHealth(port, () => exited);
      this.processState = "running";
      this.notify();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message.slice(0, 500) : String(error);
      this.processState = "error";
      child.kill("SIGTERM");
      this.notify();
      throw error;
    }
    return this.stateSync();
  }

  private async waitForHealth(port: number, exited: () => { code: number | null; signal: NodeJS.Signals | null } | null): Promise<void> {
    const timeoutMs = this.deps.healthTimeoutMs ?? 300_000;
    const intervalMs = this.deps.healthPollMs ?? 500;
    const fetchImpl = this.deps.fetchImpl ?? globalThis.fetch;
    const deadline = this.deps.clock.now() + timeoutMs;
    let last = "no response yet";
    while (this.deps.clock.now() < deadline) {
      const exit = exited();
      if (exit) throw new ServiceError("runtime_exited", `llama-server exited before becoming healthy (code ${String(exit.code)}, signal ${String(exit.signal)})`);
      try {
        const response = await fetchImpl(healthUrlForPort(port), { signal: AbortSignal.timeout(Math.max(intervalMs, 1000)) });
        await response.body?.cancel();
        if (response.status === 200) return;
        last = `HTTP ${response.status}`;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await this.deps.clock.sleep(intervalMs);
    }
    throw new ServiceError("runtime_timeout", `Timed out waiting for llama-server health (last: ${last})`);
  }

  async stop(): Promise<LocalRuntimeState> {
    const child = this.child;
    if (!child) {
      this.processState = "stopped";
      this.port = undefined;
      this.notify();
      return this.stateSync();
    }
    this.processState = "stopping";
    this.notify();
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    const grace = this.deps.stopGraceMs ?? 5000;
    const killer = setTimeout(() => child.kill("SIGKILL"), grace);
    killer.unref?.();
    await exited;
    clearTimeout(killer);
    this.child = null;
    this.processState = "stopped";
    this.port = undefined;
    this.notify();
    return this.stateSync();
  }

  async restart(): Promise<LocalRuntimeState> {
    await this.stop();
    return this.start();
  }
}
