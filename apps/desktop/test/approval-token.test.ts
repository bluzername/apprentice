import { describe, expect, it } from "vitest";
import type { ExecutableAction } from "@apprentice/schemas";
import { canonicalJson, generateHelperSecret, mintApprovalToken, verifyApprovalToken } from "../src/main/services/helper/approval-token.js";
import { FakeHelperClient } from "../src/main/services/helper/fake-helper-client.js";

/**
 * Parity vectors shared with native/mac-helper/Tests/HelperCoreTests
 * (CanonicalJSONTests.swift and ApprovalTokenTests.swift). Change both or neither.
 */
const VECTOR_SECRET = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const CLICK: ExecutableAction = { type: "click", x: 10, y: 20.5, button: "left" };
const HOTKEY: ExecutableAction = { type: "hotkey", modifiers: ["cmd", "shift"], key: "p" };

describe("canonicalJson", () => {
  it("matches the shared vectors", () => {
    expect(canonicalJson(CLICK)).toBe('{"button":"left","type":"click","x":10,"y":20.5}');
    expect(canonicalJson(HOTKEY)).toBe('{"key":"p","modifiers":["cmd","shift"],"type":"hotkey"}');
    expect(canonicalJson({ type: "type_text", text: 'He said "hi"\n\ttab \\ slash  café   \u{1F600}' })).toBe(
      '{"text":"He said \\"hi\\"\\n\\ttab \\\\ slash \\u0001 café   \u{1F600}","type":"type_text"}'
    );
    expect(canonicalJson({ type: "scroll", x: 0.30000000000000004, y: -1.5, deltaX: 0, deltaY: -120 })).toBe('{"deltaX":0,"deltaY":-120,"type":"scroll","x":0.30000000000000004,"y":-1.5}');
    expect(canonicalJson({ type: "move", x: 3.0, y: -0 })).toBe('{"type":"move","x":3,"y":0}');
    expect(canonicalJson({ B: 2, b: 1, a: null, nested: { z: [true, false, null, 1e-5, 123456789012345], y: "" } })).toBe(
      '{"B":2,"a":null,"b":1,"nested":{"y":"","z":[true,false,null,0.00001,123456789012345]}}'
    );
  });

  it("skips undefined members, keeps ECMAScript number text, and is key-order independent", () => {
    expect(canonicalJson({ type: "wait", ms: 100, skipped: undefined })).toBe('{"ms":100,"type":"wait"}');
    expect(canonicalJson([undefined, 1e-7, 1e16, 1e21, 1.5e21])).toBe("[null,1e-7,10000000000000000,1e+21,1.5e+21]");
    expect(canonicalJson({ y: 20.5, x: 10, button: "left", type: "click" })).toBe(canonicalJson(CLICK));
    expect(() => canonicalJson({ x: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });
});

describe("approval tokens", () => {
  it("mints the shared HMAC vectors", () => {
    expect(mintApprovalToken(VECTOR_SECRET, CLICK)).toBe("c0a70714081beb3cd5a34ac31a0f771352d32df8152d28654d33bef0b4b97dae");
    expect(mintApprovalToken(VECTOR_SECRET, HOTKEY)).toBe("2145f65a27e89dcbffe949bfe5f3da9c9674947ddda3c889e97be4fcc97db1ec");
    expect(mintApprovalToken(VECTOR_SECRET, { type: "wait", ms: 10 })).toBe("8ef5402410fe0f7b1d9c99ed181d11e486d645848445ccd787e0de46a4884868");
  });

  it("verifies only the exact action under the exact secret", () => {
    const secret = generateHelperSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(generateHelperSecret()).not.toBe(secret);
    const token = mintApprovalToken(secret, CLICK);
    expect(verifyApprovalToken(secret, CLICK, token)).toBe(true);
    expect(verifyApprovalToken(secret, { ...CLICK, x: 11 }, token)).toBe(false);
    expect(verifyApprovalToken(secret, { ...CLICK, button: "right" }, token)).toBe(false);
    expect(verifyApprovalToken(generateHelperSecret(), CLICK, token)).toBe(false);
    expect(verifyApprovalToken(secret, CLICK, "0".repeat(64))).toBe(false);
    expect(verifyApprovalToken(secret, CLICK, token.toUpperCase())).toBe(false);
    expect(verifyApprovalToken(secret, CLICK, token.slice(0, 63))).toBe(false);
    expect(verifyApprovalToken(secret, CLICK, "")).toBe(false);
  });

  it("refuses malformed secrets", () => {
    expect(() => mintApprovalToken("abc", CLICK)).toThrow(/32 bytes/);
    expect(() => mintApprovalToken(VECTOR_SECRET.toUpperCase(), CLICK)).toThrow(/32 bytes/);
    expect(verifyApprovalToken("abc", CLICK, "0".repeat(64))).toBe(false);
  });
});

describe("FakeHelperClient token verification", () => {
  it("accepts the correct token and rejects wrong or replayed ones", async () => {
    const fake = new FakeHelperClient();
    await fake.start();
    const secret = fake.approvalSecret;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const token = mintApprovalToken(secret!, CLICK);
    await expect(fake.performAction(CLICK, "0".repeat(64))).rejects.toMatchObject({ code: "action_rejected" });
    await expect(fake.performAction({ ...CLICK, x: 999 }, token)).rejects.toThrow(/does not match/);
    await expect(fake.performAction(HOTKEY, token)).rejects.toThrow(/does not match/);
    await expect(fake.performAction(CLICK, token)).resolves.toEqual({ performed: true, durationMs: 1 });
    expect(fake.actions).toHaveLength(1);
  });

  it("refuses every action when started without a secret", async () => {
    const fake = new FakeHelperClient({ approvalSecret: null });
    await fake.start();
    expect(fake.approvalSecret).toBeNull();
    await expect(fake.performAction(CLICK, mintApprovalToken(VECTOR_SECRET, CLICK))).rejects.toThrow(/without an approval secret/);
    expect(fake.actions).toHaveLength(0);
  });
});
