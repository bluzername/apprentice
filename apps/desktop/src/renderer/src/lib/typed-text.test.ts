import { describe, expect, it } from "vitest";
import { countLineBreaks, lineBreakHint, visualizeTypedText } from "./typed-text";

describe("visualizeTypedText", () => {
  it("returns plain text unchanged", () => {
    expect(visualizeTypedText("hello world")).toBe("hello world");
  });
  it("marks line breaks with a return symbol followed by a newline", () => {
    expect(visualizeTypedText("a\nb")).toBe("a\u23CE\nb");
    expect(visualizeTypedText("a\r\nb")).toBe("a\u23CE\nb");
  });
  it("marks leading and trailing spaces on each line", () => {
    expect(visualizeTypedText("  a  ")).toBe("\u2423\u2423a\u2423\u2423");
    expect(visualizeTypedText(" a\nb ")).toBe("\u2423a\u23CE\nb\u2423");
  });
  it("keeps interior spaces as they are", () => {
    expect(visualizeTypedText("a  b")).toBe("a  b");
  });
  it("handles the empty string", () => {
    expect(visualizeTypedText("")).toBe("");
  });
});

describe("countLineBreaks", () => {
  it("counts LF and CRLF as one break each", () => {
    expect(countLineBreaks("a")).toBe(0);
    expect(countLineBreaks("a\nb")).toBe(1);
    expect(countLineBreaks("a\r\nb\nc")).toBe(2);
  });
});

describe("lineBreakHint", () => {
  it("returns null without line breaks", () => {
    expect(lineBreakHint("plain")).toBeNull();
  });
  it("pluralises", () => {
    expect(lineBreakHint("a\nb")).toBe("Contains 1 line break: each one presses Enter.");
    expect(lineBreakHint("a\nb\nc")).toBe("Contains 2 line breaks: each one presses Enter.");
  });
});
