import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const ENVELOPE_VERSION = 0x01;
export const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

export function assertMasterKey(key: Uint8Array): void {
  if (key.length !== MASTER_KEY_BYTES) throw new Error(`Master key must be ${MASTER_KEY_BYTES} bytes`);
}

export function generateMasterKey(): Buffer {
  return randomBytes(MASTER_KEY_BYTES);
}

/** AES-256-GCM. Envelope: version (1) | iv (12) | tag (16) | ciphertext. */
export function encrypt(plaintext: Uint8Array, key: Uint8Array): Buffer {
  assertMasterKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, tag, body]);
}

export function decrypt(envelope: Uint8Array, key: Uint8Array): Buffer {
  assertMasterKey(key);
  if (envelope.length < HEADER_BYTES) throw new Error("Envelope too short");
  const version = envelope[0];
  if (version !== ENVELOPE_VERSION) throw new Error(`Unsupported envelope version: ${String(version)}`);
  const iv = envelope.subarray(1, 1 + IV_BYTES);
  const tag = envelope.subarray(1 + IV_BYTES, HEADER_BYTES);
  const body = envelope.subarray(HEADER_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error("Envelope authentication failed (tampered or wrong key)");
  }
}
