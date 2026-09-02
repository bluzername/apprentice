import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
