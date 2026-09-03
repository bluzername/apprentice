import { describe, expect, it } from "vitest";
import { detectCredentialShapes, isLuhnValid, shannonEntropyPerChar } from "./credentials.js";

describe("isLuhnValid", () => {
  it("accepts card-length digit runs that pass the checksum", () => {
    expect(isLuhnValid("4111111111111111")).toBe(true);
    expect(isLuhnValid("5500005555555559")).toBe(true);
    expect(isLuhnValid("378282246310005")).toBe(true);
  });

  it("rejects failing checksums, wrong lengths and non-digits", () => {
    expect(isLuhnValid("4111111111111112")).toBe(false);
    expect(isLuhnValid("1234567890123")).toBe(false);
    expect(isLuhnValid("411111111111")).toBe(false);
    expect(isLuhnValid("41111111111111111111")).toBe(false);
    expect(isLuhnValid("4111-1111-1111-1111")).toBe(false);
  });
});

describe("shannonEntropyPerChar", () => {
  it("is zero for an empty or uniform string and higher for mixed ones", () => {
    expect(shannonEntropyPerChar("")).toBe(0);
    expect(shannonEntropyPerChar("aaaaaa")).toBe(0);
    expect(shannonEntropyPerChar("ab")).toBeCloseTo(1, 5);
    expect(shannonEntropyPerChar("kQ8vZ2mNp7XrT4wLyB6cHs1JdF0gAe5U")).toBeGreaterThan(3);
  });
});

describe("detectCredentialShapes", () => {
  it("recognizes vendor key prefixes", () => {
    expect(detectCredentialShapes("sk-abcdefghijklmnopqrstuvwxyz0123")).toContain("api_key_prefix");
    expect(detectCredentialShapes("token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456 here")).toContain("api_key_prefix");
    expect(detectCredentialShapes("github_pat_11ABCDEFG0abcdefghijklmnop")).toContain("api_key_prefix");
    expect(detectCredentialShapes("xoxb-1234567890-abcdefghij")).toContain("api_key_prefix");
    expect(detectCredentialShapes("AKIAIOSFODNN7EXAMPLE")).toContain("api_key_prefix");
  });

  it("recognizes Luhn-valid card numbers with or without separators", () => {
    expect(detectCredentialShapes("4111111111111111")).toContain("payment_card_number");
    expect(detectCredentialShapes("card 4111 1111 1111 1111 exp 12/29")).toContain("payment_card_number");
    expect(detectCredentialShapes("4111-1111-1111-1111")).toContain("payment_card_number");
    expect(detectCredentialShapes("invoice 1234567890123")).not.toContain("payment_card_number");
  });

  it("recognizes long high-entropy tokens", () => {
    expect(detectCredentialShapes("kQ8vZ2mNp7XrT4wLyB6cHs1JdF0gAe5U")).toContain("high_entropy_token");
    expect(detectCredentialShapes("the value is 7fA2bK9xQ1mZ4tR8sW3nE6yU0iO5pL")).toContain("high_entropy_token");
  });

  it("leaves ordinary prose alone, dictionary words included", () => {
    for (const text of [
      "Follow-up notes from the meeting with the account manager",
      "password",
      "admin",
      "Please delete the duplicate row and save the record",
      "Reset the customer's password before the next call",
      "supercalifragilisticexpialidocious",
      ""
    ]) {
      expect(detectCredentialShapes(text), text).toEqual([]);
    }
  });

  it("never returns the matched value, only the shape kind", () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz0123";
    expect(JSON.stringify(detectCredentialShapes(secret))).not.toContain(secret);
    expect(detectCredentialShapes(secret).every((shape) => ["api_key_prefix", "payment_card_number", "high_entropy_token"].includes(shape))).toBe(true);
  });
});
