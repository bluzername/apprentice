/**
 * Filesystem locations for the local model runtime. Everything lives under the
 * per-user app support directory; nothing is written outside it.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRANDING_TS = join(REPO_ROOT, "packages", "schemas", "src", "branding.ts");

/**
 * Duplicated from packages/schemas/src/branding.ts (PRODUCT_NAME). Only used
 * when the TypeScript source is not on disk (for example a packaged build).
 * The source file is the authority and is read at runtime when present.
 */
const FALLBACK_PRODUCT_NAME = "Apprentice";

export const DATA_DIR_ENV = "APPRENTICE_DATA_DIR";

export function repoRoot() {
  return REPO_ROOT;
}

export function productName() {
  if (!existsSync(BRANDING_TS)) {
    return FALLBACK_PRODUCT_NAME;
  }
  const source = readFileSync(BRANDING_TS, "utf8");
  const match = source.match(/export const PRODUCT_NAME = "([^"]+)";/);
  if (!match) {
    throw new Error(`Could not find PRODUCT_NAME in ${BRANDING_TS}`);
  }
  return match[1];
}

export function appSupportDir() {
  const override = process.env[DATA_DIR_ENV];
  if (override && override.trim().length > 0) {
    return resolve(override.trim());
  }
  return join(homedir(), "Library", "Application Support", productName());
}

export function runtimeDir() {
  return join(appSupportDir(), "runtime");
}

export function modelsDir() {
  return join(appSupportDir(), "models");
}

export function logsDir() {
  return join(appSupportDir(), "logs");
}

export function mlxVenvDir() {
  return join(appSupportDir(), "mlx-venv");
}
