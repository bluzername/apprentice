import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 0x01;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * AES-256-GCM envelope: version(1) | iv(12) | tag(16) | ciphertext.
 * Mirrors packages/core crypto so the storage layer has no cross-package
 * runtime dependency for its hot path.
 */
export class PayloadCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("PayloadCipher requires a 32-byte key");
  }

  encrypt(plaintext: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([VERSION]), iv, tag, body]);
  }

  decrypt(envelope: Buffer): Buffer {
    if (envelope.length < 1 + IV_LENGTH + TAG_LENGTH) throw new Error("Ciphertext too short");
    if (envelope[0] !== VERSION) throw new Error(`Unsupported envelope version ${envelope[0]}`);
    const iv = envelope.subarray(1, 1 + IV_LENGTH);
    const tag = envelope.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
    const body = envelope.subarray(1 + IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  }

  encryptJson(value: unknown): Buffer {
    return this.encrypt(Buffer.from(JSON.stringify(value), "utf8"));
  }

  decryptJson<T>(envelope: Buffer): T {
    return JSON.parse(this.decrypt(envelope).toString("utf8")) as T;
  }
}
