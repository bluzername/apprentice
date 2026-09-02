import { assertPathInside } from "@apprentice/core";
import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DataPaths } from "../../paths.js";

export const DELETE_ALL_PHRASE = "delete everything";

async function removeInside(root: string, target: string, removed: string[]): Promise<void> {
  if (!existsSync(target)) return;
  const real = await assertPathInside(root, target);
  if (lstatSync(target).isSymbolicLink()) {
    rmSync(target);
    removed.push(target);
    return;
  }
  rmSync(real, { recursive: true, force: true });
  removed.push(real);
}

async function removeChildren(root: string, dir: string, removed: string[], filter: (name: string) => boolean = () => true): Promise<void> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (!filter(entry)) continue;
    await removeInside(root, join(dir, entry), removed);
  }
}

/**
 * Removes the app's own files: database (+ WAL/SHM), encrypted screenshots,
 * keys, exports, logs, model caches. Shared runtime and model weights only when
 * explicitly requested. Every path is checked to live under the data root.
 */
export async function deleteAllFiles(paths: DataPaths, includeSharedModelFiles: boolean): Promise<string[]> {
  const removed: string[] = [];
  const root = paths.root;
  for (const suffix of ["", "-wal", "-shm", "-journal"]) await removeInside(root, `${paths.database}${suffix}`, removed);
  await removeChildren(root, paths.screenshots, removed, (name) => name.endsWith(".enc"));
  await removeChildren(root, paths.keys, removed);
  await removeChildren(root, paths.exports, removed);
  await removeChildren(root, paths.logs, removed);
  await removeChildren(root, paths.modelCaches, removed);
  if (includeSharedModelFiles) {
    await removeChildren(root, paths.runtime, removed);
    await removeChildren(root, paths.models, removed);
  }
  return removed;
}
