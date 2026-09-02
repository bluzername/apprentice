import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { PayloadCipher } from "./cipher.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,96}$/;

/** Encrypted file store for screenshots. One file per id, AES-256-GCM. */
export class BlobStore {
  constructor(private readonly dir: string, private readonly cipher: PayloadCipher) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  private pathFor(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error("Invalid blob id");
    const full = resolve(this.dir, `${id}.enc`);
    const root = resolve(this.dir) + sep;
    if (!full.startsWith(root)) throw new Error("Blob path escapes store");
    return full;
  }

  write(id: string, plaintext: Buffer): { path: string; byteLength: number; encryptMs: number } {
    const started = performance.now();
    const envelope = this.cipher.encrypt(plaintext);
    const path = this.pathFor(id);
    writeFileSync(path, envelope, { mode: 0o600 });
    return { path, byteLength: envelope.length, encryptMs: performance.now() - started };
  }

  read(id: string): Buffer | null {
    const path = this.pathFor(id);
    if (!existsSync(path)) return null;
    if (lstatSync(path).isSymbolicLink()) throw new Error("Refusing to read a symlinked blob");
    return this.cipher.decrypt(readFileSync(path));
  }

  delete(id: string): boolean {
    const path = this.pathFor(id);
    if (!existsSync(path)) return false;
    if (lstatSync(path).isSymbolicLink()) {
      rmSync(path);
      return true;
    }
    rmSync(path, { force: true });
    return true;
  }

  exists(id: string): boolean {
    return existsSync(this.pathFor(id));
  }

  totalBytes(): { count: number; bytes: number } {
    if (!existsSync(this.dir)) return { count: 0, bytes: 0 };
    let bytes = 0;
    let count = 0;
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith(".enc")) continue;
      const st = lstatSync(join(this.dir, entry));
      if (!st.isFile()) continue;
      bytes += st.size;
      count += 1;
    }
    return { count, bytes };
  }

  /** Delete every blob file inside the store directory (not the directory itself). */
  deleteAll(): number {
    if (!existsSync(this.dir)) return 0;
    const real = realpathSync(this.dir);
    let removed = 0;
    for (const entry of readdirSync(real)) {
      const full = join(real, entry);
      if (!entry.endsWith(".enc")) continue;
      if (!statSync(full).isFile()) continue;
      rmSync(full, { force: true });
      removed += 1;
    }
    return removed;
  }
}
