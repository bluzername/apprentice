/**
 * Ported from Tencent/UI-Mate agents/ui_mate_agent.py at commit 1cb9e1e, Apache-2.0.
 *
 * Chat history construction (`UIMateAgent.build_messages`) and screenshot
 * collapsing (`collapse_messages`). Everything here is pure: inputs are never
 * mutated and the returned arrays are freshly allocated.
 */
import { COLLAPSED_SCREENSHOT_TEXT } from "./constants.js";
import { compactResponseForHistory } from "./parser.js";
import { buildSystemPrompt, type ToolsSchemaPatch } from "./prompt.js";
import { pyStrip } from "./python-compat.js";

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ImageBlock {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
}

export type ContentBlock = TextBlock | ImageBlock;
export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: readonly ContentBlock[] | string;
}

export interface CollapseResult {
  readonly messages: readonly ChatMessage[];
  readonly collapsed: boolean;
}

function isImage(block: ContentBlock): block is ImageBlock {
  return block.type === "image_url";
}

function isText(block: ContentBlock): block is TextBlock {
  return block.type === "text";
}

/** Swap a stripped-down user message for its collapse placeholder. */
export function replaceWithPlaceholder(
  newContent: readonly ContentBlock[],
  hasText: boolean,
  collapseText: string
): readonly ContentBlock[] {
  const remainingText = pyStrip(
    newContent
      .filter(isText)
      .map((block) => block.text)
      .join("")
  );
  const normalized = remainingText.replace(/[\n \t\r]/g, "");
  const isEmptyOrXmlOnly = remainingText.length === 0 || normalized === "<tool_response></tool_response>";

  if (!hasText || isEmptyOrXmlOnly) {
    const placeholder = remainingText.includes("<tool_response>")
      ? "<tool_response>\n" + collapseText + "\n</tool_response>"
      : collapseText;
    return [{ type: "text", text: placeholder }];
  }
  return [{ type: "text", text: collapseText }, ...newContent];
}

function countImages(messages: readonly ChatMessage[]): number {
  return messages.reduce((total, message) => {
    if (message.role !== "user" || typeof message.content === "string") {
      return total;
    }
    return total + message.content.filter(isImage).length;
  }, 0);
}

interface CollapseScan {
  readonly output: readonly ChatMessage[];
  readonly remaining: number;
  readonly globalImageIndex: number;
  readonly collapsedAny: boolean;
  readonly stopped: boolean;
}

function collapseOne(message: ChatMessage, scan: CollapseScan, collapseText: string): CollapseScan {
  if (scan.stopped || scan.remaining <= 0) {
    return { ...scan, output: [...scan.output, message], stopped: true };
  }
  if (message.role !== "user" || typeof message.content === "string") {
    return { ...scan, output: [...scan.output, message] };
  }

  const hasText = message.content.some(isText);
  let globalImageIndex = scan.globalImageIndex;
  let remaining = scan.remaining;
  let removedHere = 0;
  const newContent: ContentBlock[] = [];
  for (const block of message.content) {
    if (isImage(block)) {
      globalImageIndex += 1;
      if (globalImageIndex === 0) {
        // step-0 screenshot is pinned for the whole episode
        newContent.push(block);
        continue;
      }
      if (remaining > 0) {
        remaining -= 1;
        removedHere += 1;
        continue;
      }
    }
    newContent.push(block);
  }

  const replaced =
    removedHere > 0 ? { ...message, content: replaceWithPlaceholder(newContent, hasText, collapseText) } : message;
  return {
    output: [...scan.output, replaced],
    remaining,
    globalImageIndex,
    collapsedAny: scan.collapsedAny || removedHere > 0,
    stopped: remaining <= 0
  };
}

/**
 * Drop the oldest screenshots from user messages to bound context size. The
 * step-0 screenshot is never dropped, and removals happen in chunks of
 * `minRemovalThreshold` so the shared prefix stays stable for prefix caching.
 */
export function collapseMessages(
  messages: readonly ChatMessage[],
  imagesToKeep: number | null,
  minRemovalThreshold = 10,
  collapseText: string = COLLAPSED_SCREENSHOT_TEXT
): CollapseResult {
  if (messages.length === 0 || imagesToKeep === null) {
    return { messages, collapsed: false };
  }
  const totalImages = countImages(messages);
  const rawToRemove = totalImages - imagesToKeep;
  const imagesToRemove = rawToRemove - (((rawToRemove % minRemovalThreshold) + minRemovalThreshold) % minRemovalThreshold);
  if (imagesToRemove <= 0) {
    return { messages, collapsed: false };
  }

  const initial: CollapseScan = {
    output: [],
    remaining: imagesToRemove,
    globalImageIndex: -1,
    collapsedAny: false,
    stopped: false
  };
  const scan = messages.reduce((state, message) => collapseOne(message, state, collapseText), initial);
  return { messages: scan.output, collapsed: scan.collapsedAny };
}

export interface BuildMessagesOptions {
  readonly instruction: string;
  /** Processed (resized) screenshots as base64 PNG; null once released from the window. */
  readonly screenshots: readonly (string | null)[];
  /** Raw model responses for every completed step (length = screenshots.length - 1). */
  readonly responses: readonly string[];
  /** Low-level instructions (action texts) per completed step. */
  readonly actions: readonly string[];
  readonly historyN: number;
  readonly includeThinkingInHistory: boolean;
  readonly recentThinkSteps: number | null;
  readonly collapseText?: string;
  /** obs["workflow_guidance"]. */
  readonly guidance?: string | null;
  /** obs["workflow_system_prompt"]. */
  readonly workflowSection?: string | null;
  /** obs["workflow_action_patch"]. */
  readonly actionPatch?: ToolsSchemaPatch | null;
}

function wrapToolResponse(parts: readonly ContentBlock[]): readonly ContentBlock[] {
  return [{ type: "text", text: "<tool_response>\n" }, ...parts, { type: "text", text: "\n</tool_response>" }];
}

/** Start step (1-based) of the history window: max(1, total - historyN). */
export function historyStartStep(totalSteps: number, historyN: number): number {
  return Math.max(1, totalSteps - historyN);
}

/** Pure counterpart of the screenshot release loop: nulls entries before the window. */
export function releaseOutOfWindowScreenshots(
  screenshots: readonly (string | null)[],
  historyN: number
): readonly (string | null)[] {
  const startStep = historyStartStep(screenshots.length, historyN);
  return screenshots.map((shot, i) => (i < startStep - 1 ? null : shot));
}

function compactHistoryStep(options: BuildMessagesOptions, stepNum: number, totalSteps: number): string {
  let includeThinking = options.includeThinkingInHistory;
  if (includeThinking && options.recentThinkSteps !== null) {
    const distanceFromNewest = totalSteps - 1 - stepNum;
    if (distanceFromNewest >= options.recentThinkSteps) {
      includeThinking = false;
    }
  }
  return compactResponseForHistory(options.responses[stepNum - 1] ?? "", includeThinking);
}

function buildInstructionPrompt(options: BuildMessagesOptions, startStep: number): string {
  const previousActions = options.actions
    .slice(0, Math.min(startStep - 1, options.actions.length))
    .map((action, i) => `Step ${i + 1}: ${action}`);
  const baseline =
    "\nPlease generate the next move according to the UI screenshot, " +
    "instruction and previous actions.\n\n" +
    `Instruction: ${options.instruction}\n\n` +
    "Previous actions:\n" +
    `${previousActions.length > 0 ? previousActions.join("\n") : "None"}`;
  const guidance = options.guidance;
  if (typeof guidance === "string" && guidance.length > 0) {
    // A guided run is trained with the workflow ahead of the instruction and no
    // action history, so the baseline first-turn text is replaced wholesale.
    return `\n${guidance}\n\nInstruction: ${options.instruction}`;
  }
  return baseline;
}

function userTurn(
  screenshot: string | null,
  isFirstTurn: boolean,
  instructionPrompt: string,
  collapseText: string
): readonly ContentBlock[] {
  if (screenshot === null) {
    return isFirstTurn
      ? [{ type: "text", text: instructionPrompt }]
      : wrapToolResponse([{ type: "text", text: collapseText }]);
  }
  const image: ImageBlock = { type: "image_url", image_url: { url: `data:image/png;base64,${screenshot}` } };
  return isFirstTurn ? [image, { type: "text", text: instructionPrompt }] : wrapToolResponse([image]);
}

/** Build the chat messages for the current step (`UIMateAgent.build_messages`). */
export function buildMessages(options: BuildMessagesOptions): readonly ChatMessage[] {
  const collapseText = options.collapseText ?? COLLAPSED_SCREENSHOT_TEXT;
  const totalSteps = options.screenshots.length;
  const startStep = historyStartStep(totalSteps, options.historyN);
  const instructionPrompt = buildInstructionPrompt(options, startStep);

  const system: ChatMessage = {
    role: "system",
    content: [
      {
        type: "text",
        text: buildSystemPrompt({ workflowSection: options.workflowSection, actionPatch: options.actionPatch })
      }
    ]
  };

  const turns: ChatMessage[] = [];
  for (let stepNum = startStep; stepNum <= totalSteps; stepNum += 1) {
    const isFirstTurn = stepNum === startStep;
    const screenshot = options.screenshots[stepNum - 1] ?? null;
    turns.push({ role: "user", content: userTurn(screenshot, isFirstTurn, instructionPrompt, collapseText) });
    if (stepNum <= totalSteps - 1 && stepNum - 1 < options.responses.length) {
      turns.push({
        role: "assistant",
        content: [{ type: "text", text: compactHistoryStep(options, stepNum, totalSteps) }]
      });
    }
  }
  return [system, ...turns];
}
