/**
 * Ported from Tencent/UI-Mate agents/ui_mate_agent.py at commit 1cb9e1e, Apache-2.0.
 *
 * A serializer compatible with Python's `json.dumps(obj)` default settings:
 * separators (", ", ": "), ensure_ascii=True (non-ASCII escaped as \uXXXX with
 * UTF-16 surrogate pairs), insertion key order preserved, no trailing newline.
 * The official prompt embeds `json.dumps(tools_def)` verbatim, so the tools
 * block is only byte-identical when this matches Python exactly.
 */

export type PyJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly PyJsonValue[]
  | { readonly [key: string]: PyJsonValue };

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t"
};

function hex4(codeUnit: number): string {
  return "\\u" + codeUnit.toString(16).padStart(4, "0");
}

/** Python's ESCAPE_ASCII: escape `"`, `\` and everything outside 0x20-0x7E. */
export function pyJsonString(value: string): string {
  const out: string[] = ['"'];
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charAt(i);
    const code = value.charCodeAt(i);
    const short = SHORT_ESCAPES[ch];
    if (short !== undefined) {
      out.push(short);
    } else if (code < 0x20 || code > 0x7e) {
      out.push(hex4(code));
    } else {
      out.push(ch);
    }
  }
  out.push('"');
  return out.join("");
}

function pyJsonNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`pyJsonDumps: non-finite number ${String(value)} is not serializable`);
  }
  if (Number.isInteger(value)) {
    return Object.is(value, -0) ? "-0" : String(value);
  }
  return pyFloatRepr(value);
}

/** Python float repr for the finite, non-integer case (shortest round-trip). */
export function pyFloatRepr(value: number): string {
  const s = String(value);
  if (!s.includes("e")) {
    return s;
  }
  const [mantissa, exponentRaw] = s.split("e");
  const exponent = Number(exponentRaw);
  const sign = exponent < 0 ? "-" : "+";
  return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

/** Equivalent of `json.dumps(value)` with Python's default arguments. */
export function pyJsonDumps(value: PyJsonValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return pyJsonNumber(value);
  }
  if (typeof value === "string") {
    return pyJsonString(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => pyJsonDumps(item)).join(", ") + "]";
  }
  const entries = Object.entries(value as { readonly [key: string]: PyJsonValue });
  return "{" + entries.map(([key, item]) => pyJsonString(key) + ": " + pyJsonDumps(item)).join(", ") + "}";
}
