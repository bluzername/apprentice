import { describe, expect, it } from "vitest";
import { pyJsonDumps, pyJsonString, type PyJsonValue } from "./pyjson.js";
import { readGoldenJson } from "../testing/golden.js";

interface PyJsonCase {
  readonly value: PyJsonValue;
  readonly dumps: string;
}

describe("pyJsonDumps (json.dumps parity)", () => {
  it("matches Python json.dumps for every golden sample", () => {
    const cases = readGoldenJson<readonly PyJsonCase[]>("pyjson_cases.json");
    expect(cases.length).toBeGreaterThan(5);
    for (const testCase of cases) {
      expect(pyJsonDumps(testCase.value)).toBe(testCase.dumps);
    }
  });

  it("uses Python default separators and preserves key order", () => {
    expect(pyJsonDumps({ b: 1, a: [true, null] })).toBe('{"b": 1, "a": [true, null]}');
  });

  it("escapes non-ASCII as \\uXXXX with surrogate pairs (ensure_ascii)", () => {
    expect(pyJsonString("é😀")).toBe('"\\u00e9\\ud83d\\ude00"');
    expect(pyJsonString("\u007f")).toBe('"\\u007f"');
    expect(pyJsonString("tab\tquote\"slash/")).toBe('"tab\\tquote\\"slash/"');
  });

  it("rejects non-finite numbers explicitly", () => {
    expect(() => pyJsonDumps(Number.NaN)).toThrow(TypeError);
  });
});
