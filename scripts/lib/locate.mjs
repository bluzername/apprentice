/**
 * Discovery of the installed llama.cpp runtime and the UI-Mate model files.
 * Order for the runtime: APPRENTICE_LLAMA_SERVER env, managed install, PATH.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileSize } from "./download.mjs";
import { logsDir, modelsDir, runtimeDir } from "./paths.mjs";
import { which } from "./spawn.mjs";

export const LLAMA_SERVER_ENV = "APPRENTICE_LLAMA_SERVER";
export const MODEL_DIR_NAME = "ui-mate-9b";
export const PID_FILE_NAME = "llama-server.pid";

export async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw new Error(`Could not read ${path}: ${error.message}`, { cause: error });
  }
}

export function runtimePaths(manifest) {
  const base = runtimeDir();
  const dir = join(base, manifest.llamaCpp.extractedDir);
  return {
    base,
    dir,
    serverPath: join(dir, manifest.llamaCpp.serverBinary),
    installedJson: join(dir, "INSTALLED.json"),
    downloadsDir: join(base, "downloads"),
    tarballPath: join(base, "downloads", manifest.llamaCpp.assetName),
    pidFile: join(base, PID_FILE_NAME),
    logsDir: logsDir()
  };
}

export async function runtimeStatus(manifest) {
  const paths = runtimePaths(manifest);
  const installed = await readJsonIfExists(paths.installedJson);
  const managedOk = installed !== null && existsSync(paths.serverPath) && installed.release === manifest.llamaCpp.release;
  const envOverride = process.env[LLAMA_SERVER_ENV]?.trim() || null;
  const envOk = envOverride !== null && existsSync(envOverride);
  const pathServer = await which(manifest.llamaCpp.serverBinary);
  return {
    installed: managedOk,
    release: managedOk ? installed.release : null,
    sha256: managedOk ? installed.sha256 : null,
    verifiedAt: managedOk ? installed.verifiedAt : null,
    installDir: paths.dir,
    serverPath: managedOk ? paths.serverPath : null,
    envOverride,
    envOverrideValid: envOk,
    pathServer,
    tarballPresent: existsSync(paths.tarballPath),
    partialDownload: existsSync(`${paths.tarballPath}.part`)
  };
}

/** Returns { serverPath, cwd, source } or throws with setup guidance. */
export async function locateLlamaServer(manifest) {
  const status = await runtimeStatus(manifest);
  if (status.envOverride) {
    if (!status.envOverrideValid) {
      throw new Error(`${LLAMA_SERVER_ENV}=${status.envOverride} does not exist`);
    }
    return { serverPath: status.envOverride, cwd: dirname(status.envOverride), source: "env" };
  }
  if (status.installed) {
    return { serverPath: status.serverPath, cwd: dirname(status.serverPath), source: "managed" };
  }
  if (status.pathServer) {
    return { serverPath: status.pathServer, cwd: dirname(status.pathServer), source: "path" };
  }
  throw new Error(
    `No llama-server found. Run "node scripts/install-local-runtime.mjs", or set ${LLAMA_SERVER_ENV} to an existing llama-server binary (for example one installed with Homebrew).`
  );
}

export function modelPaths(manifest) {
  const dir = join(modelsDir(), MODEL_DIR_NAME);
  return {
    dir,
    weightsPath: join(dir, manifest.model.files.weights.file),
    mmprojPath: join(dir, manifest.model.files.mmproj.file),
    modelJson: join(dir, "model.json")
  };
}

async function fileState(path, expectedSize) {
  const size = await fileSize(path);
  return { path, exists: size !== null, size, sizeOk: size === expectedSize };
}

export async function modelStatus(manifest) {
  const paths = modelPaths(manifest);
  const record = await readJsonIfExists(paths.modelJson);
  const weights = await fileState(paths.weightsPath, manifest.model.files.weights.size);
  const mmproj = await fileState(paths.mmprojPath, manifest.model.files.mmproj.size);
  const mode = record?.mode ?? null;
  const localComplete = weights.sizeOk && mmproj.sizeOk;
  const installed = mode === "hf-cache" || (mode === "local" && localComplete);
  return {
    installed,
    mode: installed ? mode : null,
    dir: paths.dir,
    modelJson: paths.modelJson,
    record,
    files: { weights, mmproj },
    partialDownloads: {
      weights: existsSync(`${paths.weightsPath}.part`),
      mmproj: existsSync(`${paths.mmprojPath}.part`)
    },
    hfSpec: manifest.model.hfSpec,
    alias: manifest.model.alias
  };
}
