import { createRequire } from "node:module";
import type * as Electron from "electron";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { APP_SUPPORT_DIR_NAME } from "@apprentice/schemas";

export interface DataPaths {
  readonly root: string;
  readonly database: string;
  readonly screenshots: string;
  readonly keys: string;
  readonly exports: string;
  readonly logs: string;
  readonly runtime: string;
  readonly models: string;
  readonly modelCaches: string;
}

/**
 * Electron is loaded lazily and only when no override is given, so services and
 * tests can import this module without an Electron runtime.
 */
function electronAppDataRoot(): string {
  const electron = createRequire(import.meta.url)("electron") as typeof Electron;
  return join(electron.app.getPath("appData"), APP_SUPPORT_DIR_NAME);
}

/** Resolve the standard Application Support layout. Honors APPRENTICE_DATA_DIR for tests. */
export function resolveDataPaths(override?: string): DataPaths {
  const root = override ?? process.env.APPRENTICE_DATA_DIR ?? electronAppDataRoot();
  return Object.freeze({
    root,
    database: join(root, "apprentice.sqlite"),
    screenshots: join(root, "screenshots"),
    keys: join(root, "keys"),
    exports: join(root, "exports"),
    logs: join(root, "logs"),
    runtime: join(root, "runtime"),
    models: join(root, "models"),
    modelCaches: join(root, "model-caches")
  });
}

export function ensureDataDirs(paths: DataPaths): void {
  for (const dir of [paths.root, paths.screenshots, paths.keys, paths.exports, paths.logs, paths.runtime, paths.models, paths.modelCaches]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
