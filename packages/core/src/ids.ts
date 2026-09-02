import { createHash, randomBytes } from "node:crypto";

const ID_PREFIX_RE = /^[a-z][a-z0-9]{0,15}$/i;

/** Time-sortable id: prefix, base36 timestamp (fixed width), 16 hex random chars. */
export function newId(prefix: string): string {
  if (!ID_PREFIX_RE.test(prefix)) {
    throw new Error(`Invalid id prefix: ${prefix}`);
  }
  const time = Date.now().toString(36).padStart(9, "0");
  const random = randomBytes(8).toString("hex");
  return `${prefix}_${time}${random}`;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** JSON with sorted object keys so that equal structures hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${body.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function stableHash(obj: unknown): string {
  return sha256Hex(canonicalJson(obj));
}
