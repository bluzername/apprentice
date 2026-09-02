/**
 * Ported from Tencent/UI-Mate agents/ui_mate_agent.py at commit 1cb9e1e, Apache-2.0.
 *
 * Small re-implementations of the Python built-ins the reference parser relies
 * on (str.strip, round, repr, str.encode/decode with unicode_escape). They exist
 * only so the TypeScript port produces byte-identical strings.
 */

/** Characters `str.strip()` removes when called without arguments (str.isspace). */
const PY_WHITESPACE = new Set([
  "\t", "\n", "\u000b", "\u000c", "\r", "\u001c", "\u001d", "\u001e", "\u001f", " ",
  "\u0085", "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005",
  "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000"
]);

function stripWith(value: string, shouldStrip: (ch: string) => boolean): string {
  let start = 0;
  let end = value.length;
  while (start < end && shouldStrip(value.charAt(start))) {
    start += 1;
  }
  while (end > start && shouldStrip(value.charAt(end - 1))) {
    end -= 1;
  }
  return value.slice(start, end);
}

/** Python `str.strip()` (no argument). */
export function pyStrip(value: string): string {
  return stripWith(value, (ch) => PY_WHITESPACE.has(ch));
}

/** Python `str.strip(chars)`. */
export function pyStripChars(value: string, chars: string): string {
  return stripWith(value, (ch) => chars.includes(ch));
}

/** Python 3 `round(x)` for finite floats: round half to even. */
export function pyRoundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) {
    return floor;
  }
  if (diff > 0.5) {
    return floor + 1;
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Python `int(x)` for finite floats: truncation toward zero. */
export function pyInt(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`cannot convert ${String(value)} to integer`);
  }
  return Math.trunc(value);
}

/** Python `float(x)` for the str/number inputs the parser can see. */
export function pyFloat(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string") {
    const trimmed = pyStrip(value).replace(/_/g, "");
    if (/^[+-]?(\d+\.?\d*(e[+-]?\d+)?|\.\d+(e[+-]?\d+)?|inf(inity)?|nan)$/i.test(trimmed)) {
      const parsed = Number(trimmed.replace(/^([+-]?)inf(inity)?$/i, "$1Infinity"));
      return parsed;
    }
  }
  throw new TypeError(`could not convert ${JSON.stringify(value)} to float`);
}

const NON_PRINTABLE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;

/** Python `str.isprintable()` for one code point. */
export function pyIsPrintable(ch: string): boolean {
  if (ch === " ") {
    return true;
  }
  return !NON_PRINTABLE.test(ch);
}

function hexEscape(code: number): string {
  if (code <= 0xff) {
    return "\\x" + code.toString(16).padStart(2, "0");
  }
  if (code <= 0xffff) {
    return "\\u" + code.toString(16).padStart(4, "0");
  }
  return "\\U" + code.toString(16).padStart(8, "0");
}

/** Python `repr(str)`. */
export function pyReprString(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  const out: string[] = [quote];
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === quote || ch === "\\") {
      out.push("\\" + ch);
    } else if (ch === "\t") {
      out.push("\\t");
    } else if (ch === "\n") {
      out.push("\\n");
    } else if (ch === "\r") {
      out.push("\\r");
    } else if (code < 0x20 || code === 0x7f) {
      out.push(hexEscape(code));
    } else if (code < 0x7f) {
      out.push(ch);
    } else if (pyIsPrintable(ch)) {
      out.push(ch);
    } else {
      out.push(hexEscape(code));
    }
  }
  out.push(quote);
  return out.join("");
}

/** Python float repr (shortest round-trip, exponent form normalised). */
export function pyFloatStr(value: number): string {
  if (Number.isNaN(value)) {
    return "nan";
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? "inf" : "-inf";
  }
  const s = String(value);
  if (!s.includes("e")) {
    return s;
  }
  const [mantissa, exponentRaw] = s.split("e");
  const exponent = Number(exponentRaw);
  const sign = exponent < 0 ? "-" : "+";
  return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

/**
 * Python `repr(value)` for JSON-shaped values. JavaScript has no int/float
 * distinction, so integral numbers are rendered as Python ints.
 */
export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) {
    return "None";
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : pyFloatStr(value);
  }
  if (typeof value === "string") {
    return pyReprString(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => pyRepr(item)).join(", ") + "]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return "{" + entries.map(([key, item]) => pyReprString(key) + ": " + pyRepr(item)).join(", ") + "}";
  }
  return String(value);
}

/** Python `str(value)` for JSON-shaped values (used by f-string interpolation). */
export function pyStr(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return pyRepr(value);
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\u0007",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\u000b"
};

export class PyUnicodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PyUnicodeError";
  }
}

function readHex(text: string, start: number, count: number, label: string): number {
  const digits = text.slice(start, start + count);
  if (digits.length !== count || !/^[0-9a-fA-F]+$/.test(digits)) {
    throw new PyUnicodeError(`truncated ${label} escape`);
  }
  return Number.parseInt(digits, 16);
}

/**
 * `text.encode("latin-1", "backslashreplace").decode("unicode_escape")`.
 *
 * Non-latin-1 characters round-trip unchanged (backslashreplace emits the same
 * \\uXXXX / \\UXXXXXXXX escapes unicode_escape consumes), so the decoder can run
 * on the original string. `\\N{name}` escapes are not supported and raise, which
 * the caller treats like any other decode error (text typed as given).
 */
export function pyUnicodeEscapeDecode(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch !== "\\") {
      out.push(ch);
      i += 1;
      continue;
    }
    if (i + 1 >= text.length) {
      throw new PyUnicodeError("\\ at end of string");
    }
    const next = text.charAt(i + 1);
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      out.push(simple);
      i += 2;
      continue;
    }
    if (next === "\n") {
      i += 2;
      continue;
    }
    if (next >= "0" && next <= "7") {
      let j = i + 1;
      let octal = "";
      while (j < text.length && octal.length < 3 && text.charAt(j) >= "0" && text.charAt(j) <= "7") {
        octal += text.charAt(j);
        j += 1;
      }
      out.push(String.fromCodePoint(Number.parseInt(octal, 8)));
      i = j;
      continue;
    }
    if (next === "x") {
      out.push(String.fromCodePoint(readHex(text, i + 2, 2, "\\xXX")));
      i += 4;
      continue;
    }
    if (next === "u") {
      out.push(String.fromCodePoint(readHex(text, i + 2, 4, "\\uXXXX")));
      i += 6;
      continue;
    }
    if (next === "U") {
      const code = readHex(text, i + 2, 8, "\\UXXXXXXXX");
      if (code > 0x10ffff) {
        throw new PyUnicodeError("illegal Unicode character");
      }
      out.push(String.fromCodePoint(code));
      i += 10;
      continue;
    }
    if (next === "N") {
      throw new PyUnicodeError("\\N{...} escapes are not supported by this port");
    }
    out.push("\\", next);
    i += 2;
  }
  return out.join("");
}
