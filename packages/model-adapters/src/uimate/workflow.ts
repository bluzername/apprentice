/**
 * Ported from Tencent/UI-Mate agents/demo_workflow.py at commit 1cb9e1e, Apache-2.0.
 *
 * Demonstration-guided execution: the current subtask, its completion flag
 * and its key steps are rendered into the user turn, and a pure pointer
 * advances when the model reports `subtask_complete`. The prompt fragments
 * are byte-aligned to the training format; non-ASCII punctuation is written
 * as escape sequences so the source stays ASCII-clean.
 */
import type { ToolsSchemaPatch } from "./prompt.js";
import { pyStrip } from "./python-compat.js";

export const SUBTASK_COMPLETE_ACTION = "subtask_complete";

export const OBS_GUIDANCE = "workflow_guidance";
export const OBS_SYSTEM_PROMPT = "workflow_system_prompt";
export const OBS_ACTION_PATCH = "workflow_action_patch";

const MARK_DONE = "【✅】";
const MARK_CURRENT = "【➡️】";
const MARK_UPCOMING = "【 】";

export const WORKFLOW_SYSTEM_SECTION =
  "# Workflow\n" +
  "\n" +
  "An external runtime injects a workflow into every user turn, right after the current screenshot:\n" +
  `- \`<workflow_progress>\` \u2014 the subtask checklist with markers (${MARK_DONE}completed, ${MARK_CURRENT}current, ${MARK_UPCOMING}upcoming).\n` +
  "- `<current_subtask>` \u2014 the current subtask's `sub_instruction` + `subtask_complete_flag` (+ optional `intent_summary`). Work on THIS subtask only; `sub_instruction` is your per-turn goal.\n" +
  "- `<current_subtask_action_list>` \u2014 an ordered list of the current subtask's KEY milestones (lines like \"Key Step N: ...\"). It is a reference plan of milestones, not every low-level primitive and not pixel coordinates. Reaching one key step often takes several primitives on the live screen (focus clicks, scrolls, submit keys, dismissing popups). The live screenshot is authoritative: follow the list when it agrees, and adapt when the screen has diverged, an element is missing, a popup appears, or a recovery step is needed.\n" +
  "\n" +
  "Workflow rules:\n" +
  "- Reason inside `<think>` within the scope of the CURRENT subtask, and compare the current screenshot against its `subtask_complete_flag`.\n" +
  "- Every response makes exactly one `computer_use` call. Keep using a GUI action (click/type/scroll/\u2026) until the current screenshot satisfies the current subtask's `subtask_complete_flag`; then call `computer_use` with `action=subtask_complete` (instead of a GUI action) to let the runtime advance the subtask pointer on the next turn.\n" +
  "- If this was the final subtask, the runtime shows you the resulting screenshot on one more turn; then emit `computer_use` with `action=finished` (status=success) to terminate the task.";

/** Replaces the baseline "instruction and previous actions" line on the guided turn. */
export const GUIDANCE_LINE =
  "Please generate the next move according to the UI screenshot, workflow context and instruction.";

/** Mirrors the training schema for computer_use with subtask reporting enabled. */
export const SUBTASK_COMPLETE_PATCH: ToolsSchemaPatch = {
  action_enum: [SUBTASK_COMPLETE_ACTION],
  action_description:
    `* \`${SUBTASK_COMPLETE_ACTION}\`: Signal that the CURRENT subtask is complete and` +
    " advance the workflow. Use this INSTEAD OF a GUI action, only when the current" +
    " screenshot already satisfies the subtask's completion criterion; never combine" +
    " it with another action.",
  extra_properties: {
    current_subtask_idx: {
      description:
        "0-indexed pointer of the subtask you are finishing. Required only for" +
        ` \`action=${SUBTASK_COMPLETE_ACTION}\`.`,
      type: "integer"
    },
    evidence: {
      description:
        "One sentence pointing to the screenshot evidence that the completion" +
        ` criterion is satisfied. Required only for \`action=${SUBTASK_COMPLETE_ACTION}\`.`,
      type: "string"
    }
  }
};

export interface WorkflowSubtask {
  /** intent_summary; rendered only when non-empty. */
  readonly title: string;
  /** sub_instruction. */
  readonly goal: string;
  /** subtask_complete_flag. */
  readonly completionFlag: string;
  readonly keySteps: readonly string[];
}

export interface WorkflowPlan {
  readonly subtasks: readonly WorkflowSubtask[];
}

export interface SkillSubtaskLike {
  readonly title: string;
  readonly goal: string;
  readonly completionCriteria: string;
  readonly keySteps: readonly string[];
}

/** Map Apprentice skill subtasks onto the demonstration plan model. */
export function planFromSkillSubtasks(subtasks: readonly SkillSubtaskLike[]): WorkflowPlan {
  if (subtasks.length === 0) {
    throw new RangeError("a workflow plan needs at least one subtask");
  }
  return {
    subtasks: subtasks.map((subtask) => ({
      title: subtask.title,
      goal: subtask.goal,
      completionFlag: subtask.completionCriteria,
      keySteps: [...subtask.keySteps]
    }))
  };
}

/** Render the three workflow blocks the model sees, plus the guided-turn line. */
export function buildGuidance(plan: WorkflowPlan, currentIndex: number): string {
  const subtask = plan.subtasks[currentIndex];
  if (subtask === undefined) {
    throw new RangeError(`subtask index ${currentIndex} out of range (${plan.subtasks.length} subtasks)`);
  }

  const progress = [
    "<workflow_progress>",
    ...plan.subtasks.map((item, i) => {
      const mark = i < currentIndex ? MARK_DONE : i === currentIndex ? MARK_CURRENT : MARK_UPCOMING;
      const goal = pyStrip(item.goal ?? "").replace(/\n/g, " ");
      return `${mark}subtask ${i}: ${goal}`;
    }),
    "</workflow_progress>"
  ];

  const current = [
    "<current_subtask>",
    `index: ${currentIndex}`,
    `sub_instruction: ${pyStrip(subtask.goal ?? "")}`,
    `subtask_complete_flag: ${pyStrip(subtask.completionFlag ?? "")}`,
    ...(subtask.title ? [`intent_summary: ${subtask.title}`] : []),
    "</current_subtask>"
  ];

  const body =
    subtask.keySteps.length > 0
      ? subtask.keySteps.map((step, i) => `Key Step ${i}: ${step}`).join("\n")
      : "None";
  const actionList = `<current_subtask_action_list>\n${body}\n</current_subtask_action_list>`;

  const blocks = [progress.join("\n"), current.join("\n"), actionList].join("\n\n");
  return `${blocks}\n${GUIDANCE_LINE}`;
}

const BLOCK_RE = /<tool_call>[\s\S]*?<\/tool_call>/gi;

/** Models mix `.` and `_` in tool names. */
const SC_ALT = "(?:subtask_complete|subtask\\.complete)";

/** Same signal, different serialisations per server and chat template. */
const SC_PATTERNS: readonly RegExp[] = [
  '<tool_call>[^<]*"name"\\s*:\\s*"{name}"[^<]*>',
  '"action"\\s*:\\s*"{name}"',
  "<parameter\\s*=\\s*action>\\s*{name}\\s*</parameter>",
  "```[\\s\\S]*?{name}\\s*\\(.*?\\)[\\s\\S]*?```",
  "\\b{name}\\s*\\("
].map((pattern) => new RegExp(pattern.replace(/\{name\}/g, SC_ALT), "is"));

/**
 * Matched inside `<tool_call>` blocks only, so narration that merely mentions
 * the report cannot advance the pointer.
 */
export function detectSubtaskComplete(response: string): boolean {
  const blocks = (response ?? "").match(BLOCK_RE) ?? [];
  const searchText = blocks.join("\n");
  return searchText.length > 0 && SC_PATTERNS.some((pattern) => pattern.test(searchText));
}

/** Pure counterpart of DemoWorkflow's `_index` / `_await_finish`. */
export interface WorkflowPointerState {
  readonly index: number;
  readonly awaitFinish: boolean;
}

export const INITIAL_WORKFLOW_POINTER: WorkflowPointerState = { index: 0, awaitFinish: false };

export interface WorkflowPointerResult {
  readonly nextIndex: number;
  readonly awaitFinish: boolean;
  readonly actions: readonly string[];
  /** True when `detect_subtask_complete` fired for this response. */
  readonly subtaskCompleteDetected: boolean;
  /** True when a premature DONE was rewritten into a pointer advance. */
  readonly earlyDoneRewritten: boolean;
}

export function isLastSubtask(plan: WorkflowPlan, index: number): boolean {
  return index >= plan.subtasks.length - 1;
}

/**
 * Pure `DemoWorkflow.after_predict`: advance the pointer on a completion
 * report and keep that step harmless; a premature DONE before the final
 * subtask advances instead of ending the episode.
 */
export function workflowAfterPredict(
  plan: WorkflowPlan,
  state: WorkflowPointerState,
  response: string,
  actions: readonly string[]
): WorkflowPointerResult {
  const last = isLastSubtask(plan, state.index);
  if (detectSubtaskComplete(response)) {
    if (!last) {
      return {
        nextIndex: state.index + 1,
        awaitFinish: false,
        actions: ["WAIT"],
        subtaskCompleteDetected: true,
        earlyDoneRewritten: false
      };
    }
    if (state.awaitFinish) {
      return {
        nextIndex: state.index,
        awaitFinish: true,
        actions: ["DONE"],
        subtaskCompleteDetected: true,
        earlyDoneRewritten: false
      };
    }
    return {
      nextIndex: state.index,
      awaitFinish: true,
      actions: ["WAIT"],
      subtaskCompleteDetected: true,
      earlyDoneRewritten: false
    };
  }
  if (!last && actions.some((action) => action === "DONE")) {
    return {
      nextIndex: state.index + 1,
      awaitFinish: false,
      actions: ["WAIT"],
      subtaskCompleteDetected: false,
      earlyDoneRewritten: true
    };
  }
  return {
    nextIndex: state.index,
    awaitFinish: false,
    actions,
    subtaskCompleteDetected: false,
    earlyDoneRewritten: false
  };
}
