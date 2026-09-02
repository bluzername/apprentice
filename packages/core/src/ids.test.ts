import { describe, expect, it } from "vitest";
import { canonicalJson, newId, sha256Hex, stableHash } from "./ids.js";

describe("ids", () => {
  it("creates prefixed, unique, time-sortable ids", () => {
    const a = newId("evt");
    const b = newId("evt");
    expect(a.startsWith("evt_")).toBe(true);
    expect(a).not.toBe(b);
    expect(a.length).toBe(b.length);
    expect(() => newId("bad prefix")).toThrow();
  });

  it("hashes deterministically", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(stableHash({ b: 1, a: [1, 2] })).toBe(stableHash({ a: [1, 2], b: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
    expect(canonicalJson({ z: undefined, a: null })).toBe('{"a":null}');
  });
});
