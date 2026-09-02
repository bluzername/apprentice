import { describe, expect, it } from "vitest";
import {
  buildDescriptionPrompt,
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
