import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { assertMasterKey, generateMasterKey } from "./aes.js";

export interface KeyStore {
  load(): Promise<Buffer | null>;
  save(key: Buffer): Promise<void>;
  delete(): Promise<void>;
}

/** Test adapter: keeps the key in memory only. */
export class MemoryKeyStore implements KeyStore {
  private key: Buffer | null = null;

  async load(): Promise<Buffer | null> {
    return this.key === null ? null : Buffer.from(this.key);
  }

  async save(key: Buffer): Promise<void> {
    assertMasterKey(key);
    this.key = Buffer.from(key);
  }

  async delete(): Promise<void> {
    this.key = null;
  }
}

/** Mirrors Electron safeStorage: opaque string protection backed by the OS keychain. */
export interface StringProtector {
  encryptString(plaintext: string): Buffer;
  decryptString(ciphertext: Buffer): string;
  isAvailable(): boolean;
}

/** Stores the master key as a protector-wrapped hex string in a file. */
export class ProtectedFileKeyStore implements KeyStore {
  constructor(
    private readonly path: string,
    private readonly protector: StringProtector
  ) {}

  async load(): Promise<Buffer | null> {
    let wrapped: Buffer;
    try {
      wrapped = await readFile(this.path);
    } catch (error: unknown) {
      if (isNotFound(error)) return null;
      throw error;
    }
    this.assertAvailable();
    const hex = this.protector.decryptString(wrapped);
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("ProtectedFileKeyStore: stored key is malformed");
    return Buffer.from(hex, "hex");
  }

  async save(key: Buffer): Promise<void> {
    assertMasterKey(key);
    this.assertAvailable();
    await mkdir(dirname(this.path), { recursive: true });
    const wrapped = this.protector.encryptString(key.toString("hex"));
    await writeFile(this.path, wrapped, { mode: 0o600 });
  }

  async delete(): Promise<void> {
    await rm(this.path, { force: true });
  }

  private assertAvailable(): void {
    if (!this.protector.isAvailable()) throw new Error("ProtectedFileKeyStore: OS key protection is unavailable");
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

/** Loads the master key or creates and persists a new one on first use. */
export async function ensureMasterKey(store: KeyStore): Promise<Buffer> {
  const existing = await store.load();
  if (existing !== null) {
    assertMasterKey(existing);
    return existing;
  }
  const created = generateMasterKey();
  await store.save(created);
  return created;
}
