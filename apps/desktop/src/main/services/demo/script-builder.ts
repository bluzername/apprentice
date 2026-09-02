import { KEY_NAMES, type ProposedAction, type Skill } from "@apprentice/schemas";
import type { MockScriptStep } from "@apprentice/model-adapters";
import { demoSkillTemplates, mockRunScripts, type MockRunStep } from "../../../../../../packages/test-fixtures/src/skills.js";
import { SCENARIO_NAMES, type ScenarioName, type TemplateName } from "../../../../../../packages/test-fixtures/src/types.js";
import { DEMO_SCREEN_STATES, contextMatches } from "./screen-states.js";
import type { TemplateTarget } from "./simulator.js";

export interface DemoScript {
  readonly scenario: ScenarioName;
  /** MockProviderOptions.script: [subtaskIndex][callIndex]. */
  readonly script: readonly (readonly MockScriptStep[])[];
  /** Flattened execution timeline for the screen simulator. */
  readonly timeline: readonly MockRunStep[];
}

const KEY_SET: ReadonlySet<string> = new Set(KEY_NAMES);

/** Picks the fixture scenario whose domains/apps overlap the skill the most. */
export function scenarioForSkill(skill: Skill): ScenarioName {
  const contexts = new Set([...skill.allowedDomains, ...skill.allowedApps, ...skill.subtasks.map((subtask) => subtask.appOrDomain ?? "")].map((value) => value.toLowerCase()));
  let best: { scenario: ScenarioName; score: number } = { scenario: SCENARIO_NAMES[0], score: -1 };
  for (const scenario of SCENARIO_NAMES) {
    const template = demoSkillTemplates[scenario];
    const own = [...template.allowedDomains, ...template.allowedApps].map((value) => value.toLowerCase());
    const score = own.filter((value) => contexts.has(value)).length;
    if (score > best.score) best = { scenario, score };
  }
  return best.scenario;
}

function groupByScriptSubtask(steps: readonly MockRunStep[]): readonly (readonly MockRunStep[])[] {
  const groups: MockRunStep[][] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (last && last[0]?.subtaskIndex === step.subtaskIndex) last.push(step);
    else groups.push([step]);
  }
  return groups;
}

function stripControl(steps: readonly MockRunStep[]): MockRunStep[] {
  return steps.filter((step) => step.action !== "subtask_complete" && step.action !== "done");
}

/** Maps the scenario's per-subtask groups onto the skill's subtasks by context, in order. */
export function mapTimeline(skill: Skill, scenario: ScenarioName): MockRunStep[] {
  const groups = groupByScriptSubtask(mockRunScripts[scenario]);
  const consumed = new Set<number>();
  let lastTemplate: TemplateName = groups[0]?.[0]?.templateName ?? "genericBlank";
  const timeline: MockRunStep[] = [];
  skill.subtasks.forEach((subtask, index) => {
    const groupIndex = groups.findIndex((group, candidate) => !consumed.has(candidate) && group.some((step) => contextMatches(DEMO_SCREEN_STATES[step.templateName], subtask.appOrDomain)));
    const isLast = index === skill.subtasks.length - 1;
    let actions: MockRunStep[];
    if (groupIndex >= 0) {
      consumed.add(groupIndex);
      actions = stripControl(groups[groupIndex]!).map((step) => ({ ...step, subtaskIndex: index }));
      const completeStep = groups[groupIndex]!.find((step) => step.action === "subtask_complete");
      lastTemplate = completeStep?.templateName ?? actions[actions.length - 1]?.templateName ?? lastTemplate;
    } else {
      actions = [{ subtaskIndex: index, templateName: lastTemplate, action: "click" }];
    }
    timeline.push(...actions, { subtaskIndex: index, templateName: lastTemplate, action: "subtask_complete" });
    if (isLast) timeline.push({ subtaskIndex: index, templateName: lastTemplate, action: "done" });
  });
  return timeline;
}

export interface ScriptGeometry {
  readonly original: { width: number; height: number };
  readonly resized: { width: number; height: number };
  readonly targets: Readonly<Record<string, TemplateTarget>>;
}

function scriptStep(step: MockRunStep, skill: Skill, geometry: ScriptGeometry): MockScriptStep {
  const subtask = skill.subtasks[step.subtaskIndex];
  const sourceScreenshot = { width: geometry.resized.width, height: geometry.resized.height };
  const base = { confidence: 0.9, sourceScreenshot, subtaskIndex: step.subtaskIndex };
  const expected = (subtask?.completionCriteria ?? "The screen advances").slice(0, 300);
  switch (step.action) {
    case "click": {
      const target = geometry.targets[step.templateName];
      if (!target) throw new Error(`No target for ${step.templateName}`);
      const action: ProposedAction = {
        type: "click",
        x: Math.round((target.x * geometry.resized.width) / geometry.original.width),
        y: Math.round((target.y * geometry.resized.height) / geometry.original.height),
        button: "left",
        purpose: `Click '${target.label}'`.slice(0, 300),
        expectedResult: expected,
        ...base
      };
      return { action, actionSummary: action.purpose, rationale: `The '${target.label}' control advances this subtask`.slice(0, 500), parseErrors: [] };
    }
    case "type_text": {
      const action: ProposedAction = { type: "type_text", text: step.text ?? "", purpose: "Enter the prepared text", expectedResult: expected, ...base };
      return { action, actionSummary: `Type ${step.text?.length ?? 0} characters`, rationale: "The field needs the value from the skill variables", parseErrors: [] };
    }
    case "press_key": {
      const key = (step.key ?? "enter").toLowerCase();
      if (!KEY_SET.has(key)) throw new Error(`Demo script uses a key outside KEY_NAMES: ${key}`);
      const action: ProposedAction = { type: "press_key", key: key as ProposedAction extends { key: infer K } ? K : never, purpose: `Press ${key}`, expectedResult: expected, ...base };
      return { action, actionSummary: `Press ${key}`, rationale: "A key press completes this step", parseErrors: [] };
    }
    case "subtask_complete":
      return { action: null, actionSummary: `Subtask ${step.subtaskIndex + 1} complete`, rationale: "All key steps of this subtask were performed", controlToken: "SUBTASK_COMPLETE", subtaskCompleteEvidence: expected, parseErrors: [] };
    case "done":
      return {
        action: { type: "done", summary: "Demo run finished", purpose: "Finish the run", expectedResult: "All subtasks are complete", ...base },
        actionSummary: "All subtasks complete",
        rationale: "The last subtask finished",
        controlToken: "DONE",
        parseErrors: []
      };
  }
}

/** Builds the mock provider script and the simulator timeline for a skill. */
export function buildDemoScript(skill: Skill, geometry: ScriptGeometry, scenario: ScenarioName = scenarioForSkill(skill)): DemoScript {
  const timeline = mapTimeline(skill, scenario);
  const script: MockScriptStep[][] = skill.subtasks.map(() => []);
  for (const step of timeline) script[step.subtaskIndex]?.push(scriptStep(step, skill, geometry));
  return { scenario, script, timeline };
}
