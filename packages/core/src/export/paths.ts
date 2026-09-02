import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Real path of the deepest existing ancestor joined with the remaining (non-existent) tail. */
async function effectiveRealPath(absolute: string): Promise<string> {
  const missing: string[] = [];
  let current = absolute;
  while (!(await exists(current))) {
    const parent = dirname(current);
    if (parent === current) throw new Error(`No existing ancestor for ${absolute}`);
    missing.unshift(current.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    current = parent;
  }
  const real = await realpath(current);
  return missing.length === 0 ? real : resolve(real, ...missing);
}

/**
 * Ensures `candidate` (after symlink resolution) lives inside `root`. Returns the
 * resolved real path. Throws when the path escapes, including through symlinks.
 */
export async function assertPathInside(root: string, candidate: string): Promise<string> {
  if (!isAbsolute(root)) throw new Error("assertPathInside: root must be absolute");
  const realRoot = await realpath(root);
  const absoluteCandidate = isAbsolute(candidate) ? candidate : resolve(realRoot, candidate);
  const realCandidate = await effectiveRealPath(absoluteCandidate);
  const rel = relative(realRoot, realCandidate);
  const inside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (!inside) throw new Error(`Path escapes root: ${candidate}`);
  return realCandidate;
}

export async function isPathInside(root: string, candidate: string): Promise<boolean> {
  try {
    await assertPathInside(root, candidate);
    return true;
  } catch {
    return false;
  }
}
