/**
 * Approval tokens bind one approved action to one helper session.
 *
 * The Electron main process generates a random 32-byte session secret when it
 * spawns the helper and passes it in the child environment as
 * APPRENTICE_HELPER_SECRET (hex). A token is hex(HMAC-SHA256(secret,
 * canonicalJson(action))). The helper recomputes the HMAC over the action it
 * actually received, so a token cannot be replayed for a different action and
 * a process that did not spawn the helper cannot mint one.
 *
 * `canonicalJson` must stay byte-for-byte identical to `CanonicalJSON` in
 * native/mac-helper/Sources/HelperCore/Protocol/JSONEncoding.swift. The shared
 * vectors live in apps/desktop/test/approval-token.test.ts and
 * native/mac-helper/Tests/HelperCoreTests/CanonicalJSONTests.swift.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ExecutableAction } from "@apprentice/schemas";

export const HELPER_SECRET_ENV = "APPRENTICE_HELPER_SECRET";
export const HELPER_SECRET_BYTES = 32;
const HEX_RE = /^[0-9a-f]+$/;

/** Fresh session secret, hex encoded (64 characters). */
export function generateHelperSecret(): string {
  return randomBytes(HELPER_SECRET_BYTES).toString("hex");
}

function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite numbers are not representable");
  if (Object.is(value, -0)) return "0";
  return String(value);
}

/**
 * Canonical JSON: object keys sorted by UTF-8 byte order, no whitespace,
 * integers without a decimal point, other numbers as their shortest
 * round-trip form, strings escaped exactly like JSON.stringify (which never
 * escapes non-ASCII, U+2028, or U+2029). `undefined` object members are
 * skipped; `undefined` array elements become null.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return canonicalNumber(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new Error(`canonicalJson: unsupported value of type ${typeof value}`);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${members.join(",")}}`;
}

function secretKey(secretHex: string): Buffer {
  if (secretHex.length !== HELPER_SECRET_BYTES * 2 || !HEX_RE.test(secretHex)) {
    throw new Error("approval secret must be 32 bytes of lowercase hex");
  }
  return Buffer.from(secretHex, "hex");
}

/** hex(HMAC-SHA256(secret, canonicalJson(action))). */
export function mintApprovalToken(secretHex: string, action: ExecutableAction): string {
  return createHmac("sha256", secretKey(secretHex)).update(canonicalJson(action), "utf8").digest("hex");
}

/** Constant-time check of a presented token against the action as received. */
export function verifyApprovalToken(secretHex: string, action: unknown, token: string): boolean {
  if (typeof token !== "string" || token.length !== 64 || !HEX_RE.test(token)) return false;
  let expected: Buffer;
  try {
    expected = createHmac("sha256", secretKey(secretHex)).update(canonicalJson(action), "utf8").digest();
  } catch {
    return false;
  }
  return timingSafeEqual(expected, Buffer.from(token, "hex"));
}
