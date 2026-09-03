import { describe, expect, it } from "vitest";
import {
  buildDescriptionPrompt,
  buildPromptAdditions,
  buildSystemPrompt,
  buildToolsDef,
  patchToolsSchema
} from "./prompt.js";
import { pyJsonDumps } from "./pyjson.js";
import { SUBTASK_COMPLETE_PATCH, WORKFLOW_SYSTEM_SECTION } from "./workflow.js";
import { readGoldenText } from "../testing/golden.js";

describe("buildSystemPrompt (byte parity with build_system_prompt)", () => {
  it("matches build_system_prompt(None)", () => {
    expect(buildSystemPrompt()).toBe(readGoldenText("system_prompt_plain.txt"));
  });

  it("matches build_system_prompt(DemoWorkflow.decorate_obs(...))", () => {
    const prompt = buildSystemPrompt({ workflowSection: WORKFLOW_SYSTEM_SECTION, actionPatch: SUBTASK_COMPLETE_PATCH });
    expect(prompt).toBe(readGoldenText("system_prompt_workflow.txt"));
  });

  it("serialises the plain and patched tools schema exactly like json.dumps", () => {
    const plain = buildToolsDef(buildDescriptionPrompt());
    expect(pyJsonDumps(plain)).toBe(readGoldenText("tools_def_plain.json.txt"));
    const patched = patchToolsSchema(plain, SUBTASK_COMPLETE_PATCH);
    expect(pyJsonDumps(patched)).toBe(readGoldenText("tools_def_patched.json.txt"));
  });

  it("starts with the official preamble and ends with the response format", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.startsWith("You are a helpful GUI agent.\n\n# Tools\n\n")).toBe(true);
    expect(prompt.endsWith("If the task is infeasible, finish with status=failure.")).toBe(true);
    expect(prompt).not.toContain("# Workflow");
  });

  it("patchToolsSchema does not mutate its input and is idempotent for enum values", () => {
    const plain = buildToolsDef(buildDescriptionPrompt());
    const before = JSON.stringify(plain);
    const patched = patchToolsSchema(plain, SUBTASK_COMPLETE_PATCH);
    expect(JSON.stringify(plain)).toBe(before);
    expect(patched).not.toBe(plain);
    const twice = patchToolsSchema(patched, SUBTASK_COMPLETE_PATCH);
    expect(twice.function.parameters.properties.action.enum.filter((n) => n === "subtask_complete")).toHaveLength(1);
    expect(patchToolsSchema(plain, null)).toBe(plain);
  });

  it("ignores an empty workflow section", () => {
    expect(buildSystemPrompt({ workflowSection: "" })).toBe(buildSystemPrompt());
  });
});

describe("macOS prompt variant (Apprentice deviation)", () => {
  it("keeps the ubuntu path byte-identical to the official prompt", () => {
    expect(buildSystemPrompt({ platform: "ubuntu" })).toBe(readGoldenText("system_prompt_plain.txt"));
    expect(buildSystemPrompt()).toBe(buildSystemPrompt({ platform: "ubuntu" }));
    expect(buildDescriptionPrompt()).toBe(buildDescriptionPrompt("ubuntu"));
  });

  it("replaces the terminal / desktop-icon line and keeps the resolution line", () => {
    const ubuntu = buildDescriptionPrompt("ubuntu").split("\n");
    const macos = buildDescriptionPrompt("macos").split("\n");
    expect(macos).toHaveLength(ubuntu.length);
    expect(macos[1]).not.toBe(ubuntu[1]);
    expect(macos[1]).toContain("macOS desktop GUI");
    expect(macos[1]).toContain("already open and frontmost");
    expect(macos[1]).not.toContain("desktop icons");
    // Every other line, the 1000x1000 resolution included, is untouched.
    expect(macos.filter((_line, i) => i !== 1)).toEqual(ubuntu.filter((_line, i) => i !== 1));
    expect(macos).toContain("* The screen's resolution is 1000x1000.");
  });

  it("swaps the Ubuntu-specific IMPORTANT_NOTES for macOS ones", () => {
    const macos = buildPromptAdditions("macos");
    expect(macos.startsWith("<IMPORTANT_NOTES>")).toBe(true);
    expect(macos.trimEnd().endsWith("</IMPORTANT_NOTES>")).toBe(true);
    expect(macos).not.toContain("LibreOffice");
    expect(macos).not.toContain("GIMP");
    expect(macos).toContain("AppleScript");
    expect(macos).toContain("menu bar");
    expect(macos).toContain("cmd+c");
    expect(macos).toContain("Do not switch to another application");
    expect(buildPromptAdditions()).toBe(buildPromptAdditions("ubuntu"));
  });

  it("assembles a macOS system prompt that differs only in those two fragments", () => {
    const ubuntu = buildSystemPrompt({ platform: "ubuntu" });
    const macos = buildSystemPrompt({ platform: "macos" });
    expect(macos).not.toBe(ubuntu);
    expect(macos).not.toContain("LibreOffice");
    expect(macos).toContain("The screen's resolution is 1000x1000.");
    expect(macos.startsWith("You are a helpful GUI agent.\n\n# Tools\n\n")).toBe(true);
    expect(macos.endsWith("If the task is infeasible, finish with status=failure.")).toBe(true);
  });
});
