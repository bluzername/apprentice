import { describe, expect, it } from "vitest";
import type { ExecutableAction } from "@apprentice/schemas";
import { SYNTHETIC_ESCAPE_GRACE_MS, isSyntheticEscapeEcho, usesEscapeKey } from "../src/main/services/runs/run-state.js";

describe("synthetic escape guard", () => {
  it("recognises the actions that post an Escape key through the helper", () => {
    expect(usesEscapeKey({ type: "press_key", key: "escape" })).toBe(true);
    expect(usesEscapeKey({ type: "hotkey", modifiers: ["cmd"], key: "escape" })).toBe(true);
    expect(usesEscapeKey({ type: "press_key", key: "enter" })).toBe(false);
    expect(usesEscapeKey({ type: "click", x: 10, y: 10, button: "left" } as ExecutableAction)).toBe(false);
  });

  it("treats an Escape stop right after the helper pressed Escape as an echo, not a user stop", () => {
    expect(SYNTHETIC_ESCAPE_GRACE_MS).toBe(1500);
    expect(isSyntheticEscapeEcho(undefined, 10_000)).toBe(false);
    expect(isSyntheticEscapeEcho(10_000, 10_020)).toBe(true);
    expect(isSyntheticEscapeEcho(10_000, 10_000 + SYNTHETIC_ESCAPE_GRACE_MS)).toBe(true);
    expect(isSyntheticEscapeEcho(10_000, 10_000 + SYNTHETIC_ESCAPE_GRACE_MS + 1)).toBe(false);
    expect(isSyntheticEscapeEcho(10_000, 9_000)).toBe(false);
  });
});
