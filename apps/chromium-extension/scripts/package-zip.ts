/** Packages dist/ into dist/apprentice-extension.zip with validated entry names, printing path, size, and sha256. */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ZipFile } from "yazl";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const ZIP_NAME = "apprentice-extension.zip";
const EXCLUDED_DIRS: ReadonlySet<string> = new Set([".vite"]);

/** Zip entry names must be relative, forward-slash, and free of traversal segments. */
export function validateEntryName(name: string): string {
  const normalized = name.split(sep).join("/");
  if (normalized.length === 0 || isAbsolute(normalized) || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Refusing absolute zip entry: ${name}`);
  }
  if (normalized.split("/").some((segment) => segment === ".." || segment === "." || segment.length === 0)) {
    throw new Error(`Refusing zip entry with traversal or empty segment: ${name}`);
  }
  if (normalized.includes("\\") || normalized.includes("\0")) {
    throw new Error(`Refusing zip entry with illegal characters: ${name}`);
  }
  return normalized;
}

export async function listFiles(root: string, current: string = root): Promise<readonly string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        return EXCLUDED_DIRS.has(entry.name) ? [] : listFiles(root, full);
      }
      return entry.isFile() && entry.name !== ZIP_NAME ? [full] : [];
    })
  );
  return nested.flat().sort();
}

export interface ZipResult {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly entries: number;
}

export async function packageZip(distDir: string): Promise<ZipResult> {
  const files = await listFiles(distDir);
  if (files.length === 0) {
    throw new Error(`Nothing to package in ${distDir}; run the build first`);
  }
  const zip = new ZipFile();
  for (const file of files) {
    zip.addFile(file, validateEntryName(relative(distDir, file)), { compress: true });
  }
  zip.end();
  const target = join(distDir, ZIP_NAME);
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(target);
    zip.outputStream.on("data", (chunk: Buffer) => hash.update(chunk));
    zip.outputStream.on("error", reject);
    output.on("error", reject);
    output.on("finish", () => resolve());
    zip.outputStream.pipe(output);
  });
  const info = await stat(target);
  return { path: target, size: info.size, sha256: hash.digest("hex"), entries: files.length };
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  packageZip(join(packageDir, "dist"))
    .then((result) => {
      console.log(`zip: ${result.path}`);
      console.log(`size: ${result.size} bytes (${result.entries} entries)`);
      console.log(`sha256: ${result.sha256}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
