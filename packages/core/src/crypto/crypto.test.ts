import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decrypt, encrypt, generateMasterKey } from "./aes.js";
import { MemoryKeyStore, ProtectedFileKeyStore, ensureMasterKey, type StringProtector } from "./keystore.js";

function fakeProtector(available = true): StringProtector {
  return {
    encryptString: (plaintext) => Buffer.concat([Buffer.from("FAKE:"), Buffer.from(plaintext, "utf8").reverse()]),
    decryptString: (ciphertext) => Buffer.from(ciphertext.subarray(5)).reverse().toString("utf8"),
    isAvailable: () => available
  };
}

describe("aes-256-gcm envelope", () => {
  const key = generateMasterKey();

  it("round-trips and produces distinct envelopes per call", () => {
    const plaintext = Buffer.from("screenshot bytes");
    const a = encrypt(plaintext, key);
    const b = encrypt(plaintext, key);
    expect(a[0]).toBe(0x01);
    expect(a.length).toBe(1 + 12 + 16 + plaintext.length);
    expect(a.equals(b)).toBe(false);
    expect(decrypt(a, key).toString()).toBe("screenshot bytes");
    expect(decrypt(b, key).toString()).toBe("screenshot bytes");
    expect(decrypt(encrypt(Buffer.alloc(0), key), key).length).toBe(0);
  });

  it("throws on tampering, wrong key, and bad envelopes", () => {
    const envelope = encrypt(Buffer.from("secret"), key);
    const flippedBody = Buffer.from(envelope);
    const lastIndex = flippedBody.length - 1;
    flippedBody.writeUInt8(flippedBody.readUInt8(lastIndex) ^ 0x01, lastIndex);
    expect(() => decrypt(flippedBody, key)).toThrow(/authentication failed/);
    const flippedTag = Buffer.from(envelope);
    flippedTag.writeUInt8(flippedTag.readUInt8(13) ^ 0x01, 13);
    expect(() => decrypt(flippedTag, key)).toThrow(/authentication failed/);
    const badVersion = Buffer.from(envelope);
    badVersion.writeUInt8(0x02, 0);
    expect(() => decrypt(badVersion, key)).toThrow(/version/);
    expect(() => decrypt(envelope, generateMasterKey())).toThrow();
    expect(() => decrypt(Buffer.alloc(5), key)).toThrow(/too short/);
    expect(() => encrypt(Buffer.from("x"), Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe("key stores", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "apprentice-keystore-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("MemoryKeyStore creates once and returns the same key", async () => {
    const store = new MemoryKeyStore();
    expect(await store.load()).toBeNull();
    const first = await ensureMasterKey(store);
    const second = await ensureMasterKey(store);
    expect(first.length).toBe(32);
    expect(first.equals(second)).toBe(true);
    await store.delete();
    expect(await store.load()).toBeNull();
    const third = await ensureMasterKey(store);
    expect(third.equals(first)).toBe(false);
  });

  it("ProtectedFileKeyStore persists through the protector", async () => {
    const path = join(dir, "nested", "master.key");
    const store = new ProtectedFileKeyStore(path, fakeProtector());
    expect(await store.load()).toBeNull();
    const created = await ensureMasterKey(store);
    const raw = await readFile(path);
    expect(raw.subarray(0, 5).toString()).toBe("FAKE:");
    expect(raw.includes(created.toString("hex"))).toBe(false);
    const reopened = new ProtectedFileKeyStore(path, fakeProtector());
    const loaded = await ensureMasterKey(reopened);
    expect(loaded.equals(created)).toBe(true);
    await store.delete();
    expect(await store.load()).toBeNull();
  });

  it("refuses to operate without OS protection", async () => {
    const store = new ProtectedFileKeyStore(join(dir, "unavailable.key"), fakeProtector(false));
    await expect(store.save(generateMasterKey())).rejects.toThrow(/unavailable/);
  });

  it("rejects malformed stored keys", async () => {
    const path = join(dir, "malformed.key");
    const protector = fakeProtector();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, protector.encryptString("not-hex"));
    const store = new ProtectedFileKeyStore(path, protector);
    await expect(store.load()).rejects.toThrow(/malformed/);
  });
});
