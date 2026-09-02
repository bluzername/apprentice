import { describe, expect, it } from "vitest";
import {
  cleanKeys,
  compactResponseForHistory,
  extractActionText,
  extractXmlToolCalls,
  looksInfeasibleResponse,
  parseResponse,
  parseXmlToolCall,
  scaleCoordinate,
  toPyautoguiCode,
  type ToolCallParams
} from "./parser.js";
import { detectSubtaskComplete } from "./workflow.js";
import { readGoldenJson, readTrajectory } from "../testing/golden.js";

interface CodeCase {
  readonly name: string;
  readonly args: ToolCallParams & { readonly action: string };
  readonly code: string | readonly string[];
}

interface ParseCase {
  readonly name: string;
  readonly response: string;
  readonly actionText: string;
  readonly toolCalls: readonly ToolCallParams[];
  readonly infeasible: boolean;
  readonly compactWithThink: string;
  readonly compactNoThink: string;
  readonly subtaskComplete: boolean;
  readonly parsed: readonly [string, readonly string[]];
  readonly parsedAbsolute: readonly [string, readonly string[]];
}

interface InfeasibleCase {
  readonly text: string;
  readonly infeasible: boolean;
}

describe("official trajectory golden (resources/trajectory.json)", () => {
  const trajectory = readTrajectory();

  it("replays all 12 recorded responses into the recorded pyautogui actions at 1920x1080", () => {
    expect(trajectory.steps).toHaveLength(12);
    for (const step of trajectory.steps) {
      const parsed = parseResponse(step.recorded_response, 1920, 1080);
      expect(parsed.codes.join("\n"), step.image).toBe(step.recorded_action);
    }
  });

  it("extracts the <action> sentences", () => {
    const texts = trajectory.steps.map((s) => extractActionText(s.recorded_response));
    expect(texts[0]).toBe("Click the terminal icon in the left sidebar to open a terminal.");
    expect(texts[3]).toBe('Type "terminal" into the search bar to find the Terminal application.');
    expect(texts[10]).toBe("Wait for the git clone operation to complete.");
    expect(texts.every((t) => t.length > 0)).toBe(true);
    expect(texts.some((t) => t.includes("<think>"))).toBe(false);
  });

  it("scales [19, 561] to (36, 606)", () => {
    expect(scaleCoordinate(19, 561, 1920, 1080, "relative")).toEqual([36, 606]);
    expect(scaleCoordinate(19, 561, 1920, 1080, "absolute")).toEqual([19, 561]);
  });
});

describe("toPyautoguiCode (parity with to_pyautogui_code)", () => {
  it("matches Python for every golden argument set", () => {
    const cases = readGoldenJson<readonly CodeCase[]>("to_pyautogui_code_cases.json");
    expect(cases.length).toBeGreaterThan(40);
    for (const c of cases) {
      const code = toPyautoguiCode(c.args.action, c.args, 1920, 1080, "relative");
      expect(typeof code === "string" ? code : [...code], c.name).toEqual(c.code);
    }
  });

  it("cleans stray key wrappers like _clean_keys", () => {
    expect(cleanKeys(["keys=['enter']"])).toEqual(["'enter'"]);
    expect(cleanKeys("tab")).toEqual(["tab"]);
    expect(cleanKeys([5])).toEqual([5]);
  });
});

describe("parseResponse and helpers (parity with parse_response)", () => {
  const cases = readGoldenJson<readonly ParseCase[]>("parse_response_cases.json");

  it("has a healthy golden set", () => {
    expect(cases.length).toBeGreaterThan(15);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(extractActionText(c.response)).toBe(c.actionText);
    expect(extractXmlToolCalls(c.response)).toEqual(c.toolCalls);
    expect(looksInfeasibleResponse(c.response)).toBe(c.infeasible);
    expect(compactResponseForHistory(c.response, true)).toBe(c.compactWithThink);
    expect(compactResponseForHistory(c.response, false)).toBe(c.compactNoThink);
    expect(detectSubtaskComplete(c.response)).toBe(c.subtaskComplete);
    const relative = parseResponse(c.response, 1920, 1080);
    expect([relative.instruction, [...relative.codes]]).toEqual(c.parsed);
    const absolute = parseResponse(c.response, 1920, 1080, "absolute");
    expect([absolute.instruction, [...absolute.codes]]).toEqual(c.parsedAbsolute);
  });

  it("matches the infeasibility heuristic on the golden phrases", () => {
    const phrases = readGoldenJson<readonly InfeasibleCase[]>("infeasible_cases.json");
    for (const p of phrases) {
      expect(looksInfeasibleResponse(p.text), p.text).toBe(p.infeasible);
    }
  });

  it("parseXmlToolCall returns null for other functions and keeps JSON-looking values", () => {
    expect(parseXmlToolCall("<function=other><parameter=action>x</parameter></function>")).toBeNull();
    expect(parseXmlToolCall("<function=computer_use><parameter=coordinate>[1, 2]</parameter></function>")).toEqual({ coordinate: [1, 2] });
    expect(parseXmlToolCall("<function=computer_use><parameter=coordinate>[1, 2</parameter></function>")).toEqual({ coordinate: "[1, 2" });
  });

  it("throws an explicit error for non-numeric coordinates instead of guessing", () => {
    const response = "<action>x</action><tool_call>\n<function=computer_use>\n<parameter=action>\nleft_click\n</parameter>\n<parameter=coordinate>\n[\"a\", \"b\"]\n</parameter>\n</function>\n</tool_call>";
    expect(() => parseResponse(response, 1920, 1080)).toThrow(TypeError);
  });
});
