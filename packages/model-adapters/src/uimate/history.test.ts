import { describe, expect, it } from "vitest";
import {
  buildMessages,
  collapseMessages,
  releaseOutOfWindowScreenshots,
  replaceWithPlaceholder,
  type ChatMessage,
  type ContentBlock
} from "./history.js";
import { COLLAPSED_SCREENSHOT_TEXT, DEFAULT_HISTORY_N } from "./constants.js";
import { SUBTASK_COMPLETE_PATCH, WORKFLOW_SYSTEM_SECTION, buildGuidance } from "./workflow.js";
import { readGoldenJson } from "../testing/golden.js";

interface MessagesGolden {
  readonly screenshots: readonly string[];
  readonly responses: readonly string[];
  readonly actions: readonly string[];
  readonly instruction: string;
  readonly plain: readonly ChatMessage[];
  readonly collapsedKeep2: readonly ChatMessage[];
  readonly collapsedKeep2Flag: boolean;
  readonly collapsedKeep2Threshold10: readonly ChatMessage[];
  readonly collapsedKeep2Threshold10Flag: boolean;
  readonly guided: readonly ChatMessage[];
  readonly windowedHistory2RecentThink1: readonly ChatMessage[];
  readonly releasedNoThink: readonly ChatMessage[];
}

interface GuidanceGolden {
  readonly plan: readonly { title: string; goal: string; completionFlag: string; keySteps: readonly string[] }[];
}

const golden = readGoldenJson<MessagesGolden>("messages.json");

function baseOptions() {
  return {
    instruction: golden.instruction,
    screenshots: golden.screenshots,
    responses: golden.responses,
    actions: golden.actions,
    historyN: DEFAULT_HISTORY_N,
    includeThinkingInHistory: true,
    recentThinkSteps: null
  };
}

function countImages(messages: readonly ChatMessage[]): number {
  return messages.reduce(
    (n, m) => n + (typeof m.content === "string" ? 0 : m.content.filter((b) => b.type === "image_url").length),
    0
  );
}

describe("buildMessages (parity with UIMateAgent.build_messages)", () => {
  it("matches the plain message structure", () => {
    expect(buildMessages(baseOptions())).toEqual(golden.plain);
  });

  it("matches the guided message structure (workflow section, patch, guidance)", () => {
    const plan = { subtasks: readGoldenJson<GuidanceGolden>("guidance.json").plan.map((s) => ({ ...s })) };
    const messages = buildMessages({
      ...baseOptions(),
      guidance: buildGuidance(plan, 0),
      workflowSection: WORKFLOW_SYSTEM_SECTION,
      actionPatch: SUBTASK_COMPLETE_PATCH
    });
    expect(messages).toEqual(golden.guided);
  });

  it("honours history_n and recent_think_steps", () => {
    const messages = buildMessages({ ...baseOptions(), historyN: 2, recentThinkSteps: 1 });
    expect(messages).toEqual(golden.windowedHistory2RecentThink1);
  });

  it("renders released screenshots as collapsed tool responses without thinking", () => {
    const messages = buildMessages({
      ...baseOptions(),
      screenshots: [golden.screenshots[0] ?? null, null, golden.screenshots[2] ?? null],
      responses: golden.responses.slice(0, 2),
      actions: golden.actions.slice(0, 2),
      includeThinkingInHistory: false
    });
    expect(messages).toEqual(golden.releasedNoThink);
  });

  it("releaseOutOfWindowScreenshots nulls entries before the window without mutating", () => {
    const shots = ["a", "b", "c", "d", "e"];
    const released = releaseOutOfWindowScreenshots(shots, 2);
    expect(released).toEqual([null, null, "c", "d", "e"]);
    expect(shots).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("collapseMessages (parity with collapse_messages)", () => {
  it("keeps 2 images out of 5 with the step-0 image pinned and placeholders elsewhere", () => {
    const input = buildMessages(baseOptions());
    const snapshot = JSON.stringify(input);
    const result = collapseMessages(input, 2, 1);
    expect(result.collapsed).toBe(golden.collapsedKeep2Flag);
    expect(result.messages).toEqual(golden.collapsedKeep2);
    expect(countImages(result.messages)).toBe(2);
    const firstUser = result.messages[1];
    expect(firstUser && typeof firstUser.content !== "string" && firstUser.content[0]?.type).toBe("image_url");
    const placeholders = result.messages.filter(
      (m) => typeof m.content !== "string" && m.content.some((b) => b.type === "text" && b.text.includes(COLLAPSED_SCREENSHOT_TEXT))
    );
    expect(placeholders).toHaveLength(3);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("respects the removal threshold chunking", () => {
    const input = buildMessages(baseOptions());
    const result = collapseMessages(input, 2, 10);
    expect(result.collapsed).toBe(golden.collapsedKeep2Threshold10Flag);
    expect(result.messages).toEqual(golden.collapsedKeep2Threshold10);
    expect(result.messages).toBe(input);
  });

  it("returns the input untouched when nothing needs collapsing", () => {
    const input = buildMessages(baseOptions());
    expect(collapseMessages(input, null).messages).toBe(input);
    expect(collapseMessages(input, 10, 1).messages).toBe(input);
    expect(collapseMessages([], 1, 1)).toEqual({ messages: [], collapsed: false });
  });

  it("replaceWithPlaceholder keeps real text and swaps empty tool responses", () => {
    const text: ContentBlock[] = [{ type: "text", text: "keep me" }];
    expect(replaceWithPlaceholder(text, true, "X")).toEqual([{ type: "text", text: "X" }, ...text]);
    const wrapped: ContentBlock[] = [{ type: "text", text: "<tool_response>\n" }, { type: "text", text: "\n</tool_response>" }];
    expect(replaceWithPlaceholder(wrapped, true, "X")).toEqual([{ type: "text", text: "<tool_response>\nX\n</tool_response>" }]);
    expect(replaceWithPlaceholder([], false, "X")).toEqual([{ type: "text", text: "X" }]);
  });
});
