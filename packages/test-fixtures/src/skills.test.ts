import { CompletionPredicateSchema, SkillDraftSchema } from "@apprentice/schemas";
import { describe, expect, it } from "vitest";
import { demoSkillTemplates, mockRunScripts } from "./skills.js";
import { SCENARIO_NAMES, TEMPLATE_NAMES } from "./types.js";

describe("demoSkillTemplates", () => {
  it.each(SCENARIO_NAMES)("%s validates against SkillDraftSchema with 4-7 predicated subtasks", (scenario) => {
    const template = demoSkillTemplates[scenario];
    const parsed = SkillDraftSchema.safeParse(template);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    expect(template.subtasks.length).toBeGreaterThanOrEqual(4);
    expect(template.subtasks.length).toBeLessThanOrEqual(7);
    template.subtasks.forEach((subtask) => {
      expect(subtask.completionCriteria.length).toBeGreaterThan(0);
      expect(subtask.keySteps.length).toBeGreaterThan(0);
      expect(subtask.appOrDomain.length).toBeGreaterThan(0);
      expect(subtask.completionPredicates.length).toBeGreaterThan(0);
      subtask.completionPredicates.forEach((predicate) => {
        expect(CompletionPredicateSchema.safeParse(predicate).success).toBe(true);
      });
    });
    const domains = template.subtasks
      .map((subtask) => subtask.appOrDomain)
      .filter((value) => value.includes("."))
      .filter((value) => !value.startsWith("com."));
    domains.forEach((domain) => expect(template.allowedDomains).toContain(domain));
  });
});

describe("mockRunScripts", () => {
  it.each(SCENARIO_NAMES)("%s references known templates and subtask indexes in order", (scenario) => {
    const script = mockRunScripts[scenario];
    const subtaskCount = demoSkillTemplates[scenario].subtasks.length;
    script.forEach((step) => {
      expect(TEMPLATE_NAMES).toContain(step.templateName);
      expect(step.subtaskIndex).toBeGreaterThanOrEqual(0);
      expect(step.subtaskIndex).toBeLessThan(subtaskCount);
      if (step.action === "type_text") {
        expect(step.text?.length ?? 0).toBeGreaterThan(0);
      }
      if (step.action === "press_key") {
        expect(step.key?.length ?? 0).toBeGreaterThan(0);
      }
    });
    const indexes = script.map((step) => step.subtaskIndex);
    indexes.slice(1).forEach((index, i) => expect(index).toBeGreaterThanOrEqual(indexes[i] ?? 0));
    expect(script[script.length - 1]?.action).toBe("done");
    expect(script[script.length - 1]?.subtaskIndex).toBe(subtaskCount - 1);
  });

  it.each(SCENARIO_NAMES)("%s completes every subtask after 1-3 actions", (scenario) => {
    const script = mockRunScripts[scenario];
    const subtaskCount = demoSkillTemplates[scenario].subtasks.length;
    Array.from({ length: subtaskCount }, (_, index) => index).forEach((index) => {
      const steps = script.filter((step) => step.subtaskIndex === index && step.action !== "done");
      const completes = steps.filter((step) => step.action === "subtask_complete");
      expect(completes).toHaveLength(1);
      const actions = steps.filter((step) => step.action !== "subtask_complete");
      expect(actions.length).toBeGreaterThanOrEqual(1);
      expect(actions.length).toBeLessThanOrEqual(3);
      expect(steps[steps.length - 1]?.action).toBe("subtask_complete");
    });
  });
});
