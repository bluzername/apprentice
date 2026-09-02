import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Minimal mirror of Electron's safeStorage so tests can inject a fake. */
export interface KeyProtector {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export const MASTER_KEY_FILE = "master.key.enc";

/**
 * Generates a random 256-bit master key on first run and protects it with the
 * OS credential store (Electron safeStorage on macOS uses the Keychain).
 * The plaintext key is never written to disk.
 */
export function loadOrCreateMasterKey(keysDir: string, protector: KeyProtector): Buffer {
  if (!protector.isEncryptionAvailable()) {
    throw new Error("The operating-system credential store is unavailable; refusing to store the master key unprotected.");
  }
  const path = join(keysDir, MASTER_KEY_FILE);
  if (existsSync(path)) {
    const decoded = protector.decryptString(readFileSync(path));
    const key = Buffer.from(decoded, "base64");
    if (key.length !== 32) throw new Error("Stored master key has an unexpected length");
    return key;
  }
  const key = randomBytes(32);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, protector.encryptString(key.toString("base64")), { mode: 0o600 });
  return key;
}

export function deleteMasterKey(keysDir: string): boolean {
  const path = join(keysDir, MASTER_KEY_FILE);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

/** Stores an optional model API key protected by the credential store. */
export class SecretStore {
  constructor(private readonly keysDir: string, private readonly protector: KeyProtector) {}

  private pathFor(name: string): string {
    if (!/^[a-z0-9_-]{1,40}$/.test(name)) throw new Error("Invalid secret name");
    return join(this.keysDir, `${name}.secret.enc`);
  }

  set(name: string, value: string): void {
    if (!this.protector.isEncryptionAvailable()) throw new Error("Credential store unavailable");
    mkdirSync(this.keysDir, { recursive: true, mode: 0o700 });
    writeFileSync(this.pathFor(name), this.protector.encryptString(value), { mode: 0o600 });
  }

  get(name: string): string | null {
    const path = this.pathFor(name);
    if (!existsSync(path)) return null;
    return this.protector.decryptString(readFileSync(path));
  }

  has(name: string): boolean {
    return existsSync(this.pathFor(name));
  }

  delete(name: string): void {
    const path = this.pathFor(name);
    if (existsSync(path)) rmSync(path, { force: true });
  }
}

export const ISOLATED_DATA_DIR_ERROR = "smoke/e2e mode requires APPRENTICE_DATA_DIR pointing at an isolated directory";

/** Absolute path with symlinks resolved through the deepest existing ancestor (the leaf may not exist yet). */
function canonicalPath(path: string): string {
  const absolute = resolve(path);
  let existing = absolute;
  const missing: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return absolute;
    missing.unshift(basename(existing));
    existing = parent;
  }
  try {
    return join(realpathSync(existing), ...missing);
  } catch {
    return absolute;
  }
}

/**
 * Headless modes (smoke, e2e) may fall back to the test-only protector, so they
 * must never see the real Application Support directory. Throws unless `root`
 * is set and resolves (realpath when it exists) outside `defaultRoot`; returns
 * the canonical root to use.
 */
export function assertIsolatedDataDir(root: string | undefined, defaultRoot: string): string {
  const trimmed = root?.trim();
  if (!trimmed) throw new Error(ISOLATED_DATA_DIR_ERROR);
  const candidate = canonicalPath(trimmed);
  const protectedRoot = canonicalPath(defaultRoot);
  const rel = relative(protectedRoot, candidate);
  const insideDefault = rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  if (insideDefault) throw new Error(ISOLATED_DATA_DIR_ERROR);
  return candidate;
}

/** Test-only protector that XORs with a fixed pad; never used in production. */
export function createFakeProtector(): KeyProtector {
  const pad = Buffer.from("apprentice-test-protector-pad-32b!");
  const xor = (buf: Buffer) => Buffer.from(buf.map((b, i) => b ^ (pad[i % pad.length] ?? 0)));
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => xor(Buffer.from(plain, "utf8")),
    decryptString: (enc) => xor(enc).toString("utf8")
  };
}
