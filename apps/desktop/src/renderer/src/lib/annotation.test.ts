import { describe, expect, it } from "vitest";
import type { ProposedAction } from "@apprentice/schemas";
import { actionTarget, describeAction, fitContain, hotkeyLabel, markerPosition, markerRadius, scalePoint } from "./annotation";

const base = {
  purpose: "p",
  expectedResult: "r",
  confidence: 0.9,
  sourceScreenshot: { width: 1440, height: 900 },
  subtaskIndex: 0
};

describe("scalePoint", () => {
  it("scales screenshot pixels to displayed pixels", () => {
    expect(scalePoint({ x: 720, y: 450 }, { width: 1440, height: 900 }, { width: 720, height: 450 })).toEqual({ x: 360, y: 225 });
  });
  it("handles non-uniform scaling and zero natural size", () => {
    expect(scalePoint({ x: 100, y: 100 }, { width: 1000, height: 500 }, { width: 500, height: 500 })).toEqual({ x: 50, y: 100 });
    expect(scalePoint({ x: 5, y: 5 }, { width: 0, height: 0 }, { width: 10, height: 10 })).toEqual({ x: 0, y: 0 });
  });
});

describe("fitContain", () => {
  it("letterboxes a wide image inside a square box", () => {
    const fit = fitContain({ width: 2000, height: 1000 }, { width: 400, height: 400 });
    expect(fit.width).toBe(400);
    expect(fit.height).toBe(200);
    expect(fit.offsetY).toBe(100);
    expect(fit.scale).toBe(0.2);
  });
  it("returns zeros for empty boxes", () => {
    expect(fitContain({ width: 0, height: 0 }, { width: 10, height: 10 }).scale).toBe(0);
  });
});

describe("markerRadius", () => {
  it("clamps between 12 and 28", () => {
    expect(markerRadius(100)).toBe(12);
    expect(markerRadius(1000)).toBe(20);
    expect(markerRadius(5000)).toBe(28);
  });
});

describe("describeAction", () => {
  it("describes pointer actions with coordinates", () => {
    const click: ProposedAction = { ...base, type: "click", x: 10.4, y: 20.6, button: "left" };
    expect(describeAction(click)).toBe("Click at (10, 21)");
    expect(actionTarget(click)).toEqual({ x: 10.4, y: 20.6 });
  });
  it("describes typing by length only", () => {
    const type: ProposedAction = { ...base, type: "type_text", text: "hello" };
    expect(describeAction(type)).toBe("Type 5 characters");
    expect(actionTarget(type)).toBeNull();
  });
  it("labels hotkeys with macOS names", () => {
    const hotkey: ProposedAction = { ...base, type: "hotkey", modifiers: ["cmd", "shift"], key: "s" };
    expect(describeAction(hotkey)).toBe("Press Command + Shift + S");
    expect(hotkeyLabel(["alt"], "enter")).toBe("Option + Enter");
  });
  it("describes scroll direction and waits", () => {
    const scroll: ProposedAction = { ...base, type: "scroll", x: 1, y: 2, deltaX: 0, deltaY: -100 };
    expect(describeAction(scroll)).toBe("Scroll up at (1, 2)");
    const wait: ProposedAction = { ...base, type: "wait", ms: 1500 };
    expect(describeAction(wait)).toBe("Wait 1.5s");
  });
});

describe("markerPosition", () => {
  it("adds the centered image's offset inside its container to the scaled point", () => {
    // Natural 1408x960 shown at 704x480, centered in a 900 px wide box: 98 px of left offset.
    expect(markerPosition({ x: 462, y: 269 }, { width: 1408, height: 960 }, { width: 704, height: 480 }, { x: 98, y: 0 })).toEqual({ x: 329, y: 134.5 });
    expect(markerPosition({ x: 0, y: 0 }, { width: 100, height: 100 }, { width: 50, height: 50 }, { x: 10, y: 5 })).toEqual({ x: 10, y: 5 });
  });
});
