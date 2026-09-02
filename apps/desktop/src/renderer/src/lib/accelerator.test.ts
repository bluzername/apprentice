import { describe, expect, it } from "vitest";
import { acceleratorLabel, validateAccelerator } from "./accelerator";

describe("validateAccelerator", () => {
  it("accepts the default teach shortcut and normalises case", () => {
    expect(validateAccelerator("Alt+Command+L")).toEqual({ ok: true, normalized: "Alt+Command+L" });
    expect(validateAccelerator("alt+cmd+l").normalized).toBe("Alt+Command+L");
    expect(validateAccelerator("CmdOrCtrl+Shift+F5").normalized).toBe("CommandOrControl+Shift+F5");
  });
  it("accepts named keys and punctuation", () => {
    expect(validateAccelerator("Control+Space").ok).toBe(true);
    expect(validateAccelerator("Command+/").ok).toBe(true);
    expect(validateAccelerator("Shift+Command+Return").normalized).toBe("Shift+Command+Return");
  });
  it("rejects empty and malformed input", () => {
    expect(validateAccelerator("").ok).toBe(false);
    expect(validateAccelerator("Command++L").ok).toBe(false);
    expect(validateAccelerator("Command+").ok).toBe(false);
  });
  it("rejects unknown modifiers and keys", () => {
    expect(validateAccelerator("Hyper+L").message).toMatch(/not a modifier/);
    expect(validateAccelerator("Command+Banana").message).toMatch(/not a recognised key/);
    expect(validateAccelerator("Command+Shift").message).toMatch(/end with a key/);
  });
  it("requires a real modifier for global registration", () => {
    expect(validateAccelerator("L").ok).toBe(false);
    expect(validateAccelerator("Shift+L").ok).toBe(false);
    expect(validateAccelerator("Shift+F6").ok).toBe(true);
  });
  it("rejects repeated modifiers", () => {
    expect(validateAccelerator("Command+Cmd+L").message).toMatch(/repeated/);
  });
});

describe("acceleratorLabel", () => {
  it("renders macOS naming", () => {
    expect(acceleratorLabel("Alt+Command+L")).toBe("Option Command L");
    expect(acceleratorLabel("CmdOrCtrl+K")).toBe("Command K");
  });
});
