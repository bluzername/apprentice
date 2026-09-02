/**
 * Ported from Tencent/UI-Mate agents/ui_mate_agent.py at commit 1cb9e1e, Apache-2.0.
 *
 * System prompt assembly. `buildSystemPrompt` reproduces the Python
 * `build_system_prompt(obs)` byte for byte, including the workflow section
 * and the `subtask_complete` schema patch supplied by demo_workflow.py.
 */
import {
  ACTION_DESCRIPTION,
  ACTION_ENUM,
  DESCRIPTION_PROMPT_LINES,
  PROMPT_ADDITIONS,
  RESPONSE_FORMAT,
  RESPONSE_FORMAT_HEADER,
  SYSTEM_PROMPT_PREAMBLE,
  TOOLS_BLOCK_FOOTER,
  TOOLS_BLOCK_HEADER
} from "./constants.js";
import { pyJsonDumps, type PyJsonValue } from "./pyjson.js";
import { pyStrip, pyStripChars } from "./python-compat.js";

export type ToolsProperty = { readonly [key: string]: PyJsonValue };

export type ToolsActionProperty = {
  readonly description: string;
  readonly enum: readonly string[];
  readonly type: "string";
};

export type ToolsProperties = {
  readonly action: ToolsActionProperty;
  readonly [key: string]: ToolsProperty;
};

export type ToolsDef = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: {
      readonly properties: ToolsProperties;
      readonly required: readonly string[];
      readonly type: "object";
    };
  };
};

/** Shape of demo_workflow.SUBTASK_COMPLETE_PATCH (obs["workflow_action_patch"]). */
export type ToolsSchemaPatch = {
  readonly action_enum?: readonly string[];
  readonly action_description?: string;
  readonly extra_properties?: { readonly [key: string]: ToolsProperty };
};

export interface SystemPromptOptions {
  /** obs["workflow_system_prompt"]: appended after the base prompt when non-empty. */
  readonly workflowSection?: string | null;
  /** obs["workflow_action_patch"]: folded into the computer_use schema. */
  readonly actionPatch?: ToolsSchemaPatch | null;
}

/** Environment description shared by L1/L2/L3. */
export function buildDescriptionPrompt(): string {
  return DESCRIPTION_PROMPT_LINES.join("\n");
}

export function buildActionDescription(): string {
  return ACTION_DESCRIPTION;
}

export function buildToolsDef(descriptionPrompt: string): ToolsDef {
  return {
    type: "function",
    function: {
      name: "computer_use",
      description: descriptionPrompt,
      parameters: {
        properties: {
          action: {
            description: buildActionDescription(),
            enum: [...ACTION_ENUM],
            type: "string"
          },
          coordinate: {
            description: "The (x, y) coordinates (0-999). Required for: clicks, mouse_move, drag.",
            type: "array"
          },
          text: {
            description:
              "The text to type, or the message to the user." +
              " Required for `action=type` and `action=call_user`.",
            type: "string"
          },
          keys: {
            description:
              "An array of key names (e.g. ['a'], ['ctrl', 'c'])." +
              " Required for: hotkey, press, key_down, key_up.",
            type: "array"
          },
          pixels: {
            description: "The number of pixels to scroll. Required only for `action=scroll`.",
            type: "number"
          },
          direction: {
            type: "string",
            enum: ["vertical", "horizontal"],
            description:
              "The scroll direction. 'vertical' (default) for up/down" +
              " scrolling, 'horizontal' for left/right scrolling." +
              " Required only for `action=scroll`."
          },
          time: {
            description: "Seconds to wait. Required only for `action=wait`.",
            type: "number"
          },
          status: {
            description: "The outcome of the task. Required only for `action=finished`.",
            type: "string",
            enum: ["success", "failure"]
          }
        },
        required: ["action"],
        type: "object"
      }
    }
  };
}

/** `# Tools` block with `json.dumps(tools_def)` embedded verbatim. */
export function buildToolsAndFormatBlock(toolsDef: ToolsDef): string {
  return TOOLS_BLOCK_HEADER + pyJsonDumps(toolsDef) + TOOLS_BLOCK_FOOTER;
}

/**
 * Pure version of demo_workflow.patch_tools_schema: returns a new schema with
 * the patch's enum values appended, its description joined with "\n" and its
 * extra properties merged after the existing ones.
 */
export function patchToolsSchema(toolsDef: ToolsDef, patch: ToolsSchemaPatch | null | undefined): ToolsDef {
  if (!patch) {
    return toolsDef;
  }
  const properties = toolsDef.function.parameters.properties;
  const action = properties.action;
  const existingEnum = action.enum;
  const additions = (patch.action_enum ?? []).filter((name) => !existingEnum.includes(name));
  const mergedEnum = [...existingEnum, ...additions];

  const extraDescription = patch.action_description;
  const description = extraDescription
    ? pyStripChars((action.description ?? "") + "\n" + extraDescription, "\n")
    : action.description;

  const patchedAction: ToolsActionProperty = { ...action, enum: mergedEnum, description };
  const patchedProperties: ToolsProperties = {
    ...properties,
    action: patchedAction,
    ...(patch.extra_properties ?? {})
  };

  return {
    ...toolsDef,
    function: {
      ...toolsDef.function,
      parameters: { ...toolsDef.function.parameters, properties: patchedProperties }
    }
  };
}

/** Assemble the system prompt, folding in the workflow parts obs may carry. */
export function buildSystemPrompt(options: SystemPromptOptions = {}): string {
  const toolsDef = patchToolsSchema(buildToolsDef(buildDescriptionPrompt()), options.actionPatch);
  const prompt = pyStrip(
    SYSTEM_PROMPT_PREAMBLE +
      buildToolsAndFormatBlock(toolsDef) +
      "\n\n" +
      PROMPT_ADDITIONS +
      "\n\n" +
      RESPONSE_FORMAT_HEADER +
      RESPONSE_FORMAT
  );
  const workflowSection = options.workflowSection;
  if (typeof workflowSection === "string" && workflowSection.length > 0) {
    return prompt + "\n\n" + workflowSection;
  }
  return prompt;
}
