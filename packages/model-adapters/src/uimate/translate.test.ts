import { describe, expect, it } from "vitest";
import { ProposedActionSchema } from "@apprentice/schemas";
import { translateResponse, translateToolCall, type TranslateContext } from "./translate.js";
import { readTrajectory } from "../testing/golden.js";

const ctx: TranslateContext = {
  width: 1920,
  height: 1080,
  coordinateType: "relative",
  subtaskIndex: 2,
  screenshotId: "shot_1",
  remapControlToCommand: true
};

function response(body: string, action = "Do it."): string {
  return `<think>\nsecret reasoning\n</think>\n\n<action>\n${action}\n</action>\n\n<tool_call>\n<function=computer_use>\n${body}</function>\n</tool_call>`;
}

function param(name: string, value: string): string {
  return `<parameter=${name}>\n${value}\n</parameter>\n`;
}

describe("translateResponse on the official trajectory", () => {
  it("yields click/type_text/press_key/wait/done with scaled coordinates", () => {
    const steps = readTrajectory().steps;
    const results = steps.map((s) => translateResponse(s.recorded_response, ctx));

    expect(results[0]?.action).toMatchObject({ type: "click", x: 36, y: 606, button: "left", subtaskIndex: 2 });
    expect(results[0]?.action?.sourceScreenshot).toEqual({ screenshotId: "shot_1", width: 1920, height: 1080 });
    expect(results[3]?.action).toMatchObject({ type: "type_text", text: "terminal" });
    expect(results[7]?.action).toMatchObject({ type: "press_key", key: "return" });
    expect(results[10]?.action).toMatchObject({ type: "wait", ms: 500 });
    expect(results[10]?.controlToken).toBe("WAIT");
    expect(results[11]?.action).toMatchObject({ type: "done" });
    expect(results[11]?.controlToken).toBe("DONE");

    for (const r of results) {
      expect(r.parseErrors).toEqual([]);
      expect(r.actionSummary.length).toBeGreaterThan(0);
      expect(JSON.stringify(r)).not.toContain("<think>");
      if (r.action) {
        expect(ProposedActionSchema.safeParse(r.action).success).toBe(true);
        expect(r.action.confidence).toBe(0.7);
      }
    }
  });
});

describe("translateResponse action mapping", () => {
  it("maps every click variant and mouse_move", () => {
    const rc = translateResponse(response(param("action", "right_click") + param("coordinate", "[500, 500]")), ctx);
    expect(rc.action).toMatchObject({ type: "click", button: "right", x: 960, y: 540 });
    const mc = translateResponse(response(param("action", "middle_click") + param("coordinate", "[0, 0]")), ctx);
    expect(mc.action).toMatchObject({ type: "click", button: "middle", x: 0, y: 0 });
    const dc = translateResponse(response(param("action", "double_click") + param("coordinate", "[999, 999]")), ctx);
    expect(dc.action).toMatchObject({ type: "double_click", x: 1920, y: 1080 });
    const mv = translateResponse(response(param("action", "mouse_move") + param("coordinate", "[100, 200]")), ctx);
    expect(mv.action).toMatchObject({ type: "move", x: 192, y: 216 });
    const plain = translateResponse(response(param("action", "click") + param("coordinate", "[19, 561]")), ctx);
    expect(plain.action).toMatchObject({ type: "click", button: "left", x: 36, y: 606 });
  });

  it("rejects clicks without coordinates instead of clicking at the current pointer", () => {
    const r = translateResponse(response(param("action", "left_click")), ctx);
    expect(r.action).toBeNull();
    expect(r.parseErrors[0]).toMatch(/coordinate missing/);
    expect(r.controlToken).toBeUndefined();
    const nonNumeric = translateResponse(response(param("action", "left_click") + param("coordinate", '["a", "b"]')), ctx);
    expect(nonNumeric.action).toBeNull();
    expect(nonNumeric.parseErrors[0]).toMatch(/not numeric/);
  });

  it("rejects triple_click, drag, key_down, key_up, multi-key press and unknown actions", () => {
    for (const action of ["triple_click", "drag"]) {
      const r = translateResponse(response(param("action", action) + param("coordinate", "[1, 1]")), ctx);
      expect(r.action, action).toBeNull();
      expect(r.parseErrors[0]).toMatch(/not supported/);
    }
    for (const action of ["key_down", "key_up"]) {
      const r = translateResponse(response(param("action", action) + param("keys", '["shift"]')), ctx);
      expect(r.action, action).toBeNull();
      expect(r.parseErrors[0]).toMatch(/not supported/);
    }
    const multi = translateResponse(response(param("action", "press") + param("keys", '["a", "b"]')), ctx);
    expect(multi.action).toBeNull();
    expect(multi.parseErrors[0]).toMatch(/exactly one key/);
    const unknown = translateResponse(response(param("action", "launch_app")), ctx);
    expect(unknown.action).toBeNull();
    expect(unknown.controlToken).toBe("FAIL");
    expect(unknown.parseErrors[0]).toMatch(/unknown action/);
  });

  it("maps hotkeys with the ctrl->command remap recorded in the rationale", () => {
    const r = translateResponse(response(param("action", "hotkey") + param("keys", '["ctrl", "shift", "t"]')), ctx);
    expect(r.action).toMatchObject({ type: "hotkey", modifiers: ["command", "shift"], key: "t" });
    expect(r.rationale).toMatch(/ctrl remapped to command/);
    const noRemap = translateResponse(response(param("action", "hotkey") + param("keys", "ctrl+c")), { ...ctx, remapControlToCommand: false });
    expect(noRemap.action).toMatchObject({ type: "hotkey", modifiers: ["ctrl"], key: "c" });
    expect(noRemap.rationale).not.toMatch(/remapped/);
    const single = translateResponse(response(param("action", "hotkey") + param("keys", '["enter"]')), ctx);
    expect(single.action).toMatchObject({ type: "press_key", key: "enter" });
    const badMod = translateResponse(response(param("action", "hotkey") + param("keys", '["super", "a"]')), ctx);
    expect(badMod.action).toBeNull();
    expect(badMod.parseErrors[0]).toMatch(/unsupported modifier/);
    const badKey = translateResponse(response(param("action", "press") + param("keys", '["volume_up"]')), ctx);
    expect(badKey.action).toBeNull();
    expect(badKey.parseErrors[0]).toMatch(/not an allowed key name/);
  });

  it("maps scroll with the sign convention documented in the README", () => {
    const up = translateResponse(response(param("action", "scroll") + param("pixels", "500")), ctx);
    expect(up.action).toMatchObject({ type: "scroll", deltaX: 0, deltaY: -500, x: 960, y: 540 });
    const down = translateResponse(response(param("action", "scroll") + param("pixels", "-300")), { ...ctx, pointer: { x: 10, y: 20 } });
    expect(down.action).toMatchObject({ type: "scroll", deltaY: 300, x: 10, y: 20 });
    const right = translateResponse(response(param("action", "scroll") + param("pixels", "40") + param("direction", "horizontal")), ctx);
    expect(right.action).toMatchObject({ type: "scroll", deltaX: 40, deltaY: 0 });
    const huge = translateResponse(response(param("action", "scroll") + param("pixels", "99999")), ctx);
    expect(huge.action).toMatchObject({ type: "scroll", deltaY: -2000 });
    const withTarget = translateResponse(response(param("action", "scroll") + param("pixels", "10") + param("coordinate", "[999, 0]")), ctx);
    expect(withTarget.action).toMatchObject({ type: "scroll", x: 1920, y: 0 });
    const bad = translateResponse(response(param("action", "scroll") + param("pixels", "lots")), ctx);
    expect(bad.action).toBeNull();
  });

  it("maps wait with clamping and defaults", () => {
    expect(translateResponse(response(param("action", "wait") + param("time", "0.01")), ctx).action).toMatchObject({ type: "wait", ms: 100 });
    expect(translateResponse(response(param("action", "wait") + param("time", "60")), ctx).action).toMatchObject({ type: "wait", ms: 15000 });
    const missing = translateResponse(response(param("action", "wait")), ctx);
    expect(missing.action).toMatchObject({ type: "wait", ms: 1000 });
    expect(missing.rationale).toMatch(/defaulted/);
  });

  it("maps type with Python unicode_escape semantics and rejects empty text", () => {
    const r = translateResponse(response(param("action", "type") + param("text", "line1\\nline2 caf\\u00e9")), ctx);
    expect(r.action).toMatchObject({ type: "type_text", text: "line1\nline2 café" });
    const empty = translateResponse(response(param("action", "type") + param("text", "")), ctx);
    expect(empty.action).toBeNull();
    const tooLong = translateResponse(response(param("action", "type") + param("text", "x".repeat(2001))), ctx);
    expect(tooLong.action).toBeNull();
    expect(tooLong.parseErrors.join(" ")).toMatch(/text/);
  });

  it("maps call_user, finished and subtask_complete to control tokens", () => {
    const ask = translateResponse(response(param("action", "call_user") + param("text", "Which account?")), ctx);
    expect(ask.action).toMatchObject({ type: "ask_user", question: "Which account?" });
    expect(ask.controlToken).toBeUndefined();
    const askInfeasible = translateResponse(response(param("action", "call_user") + param("text", "This is not possible.")), ctx);
    expect(askInfeasible.controlToken).toBe("FAIL");
    expect(askInfeasible.action?.confidence).toBe(0.5);

    const done = translateResponse(response(param("action", "finished") + param("status", "success"), "All done."), ctx);
    expect(done.action).toMatchObject({ type: "done", summary: "All done." });
    expect(done.controlToken).toBe("DONE");
    const fail = translateResponse(response(param("action", "finished") + param("status", "failure"), "Cannot."), ctx);
    expect(fail.action).toMatchObject({ type: "fail", reason: "Cannot." });
    expect(fail.controlToken).toBe("FAIL");

    const sc = translateResponse(response(param("action", "subtask_complete") + param("current_subtask_idx", "0") + param("evidence", "The dialog closed.")), ctx);
    expect(sc.action).toBeNull();
    expect(sc.controlToken).toBe("SUBTASK_COMPLETE");
    expect(sc.subtaskCompleteEvidence).toBe("The dialog closed.");
    expect(sc.parseErrors).toEqual([]);
  });

  it("mirrors parse_response fallbacks for missing blocks", () => {
    const noAction = translateResponse("<think>hidden</think><tool_call></tool_call>", ctx);
    expect(noAction).toMatchObject({ action: null, controlToken: "FAIL", actionSummary: "" });
    expect(noAction.parseErrors[0]).toMatch(/no <action>/);
    const noCall = translateResponse("<action>Finished.</action>", ctx);
    expect(noCall).toMatchObject({ action: null, controlToken: "DONE" });
    const noCallInfeasible = translateResponse("<action>The task is infeasible.</action>", ctx);
    expect(noCallInfeasible.controlToken).toBe("FAIL");
    expect(translateResponse("", ctx).controlToken).toBe("FAIL");
  });

  it("applies terminal precedence and reports ignored extra calls", () => {
    const body = `<action>\nx\n</action><tool_call>\n<function=computer_use>\n${param("action", "left_click")}${param("coordinate", "[10, 10]")}</function>\n</tool_call><tool_call>\n<function=computer_use>\n${param("action", "finished")}${param("status", "success")}</function>\n</tool_call>`;
    const r = translateResponse(body, ctx);
    expect(r.controlToken).toBe("DONE");
    expect(r.action?.type).toBe("done");
    expect(r.parseErrors).toEqual(["1 additional tool call(s) ignored; Apprentice executes one action per step"]);
    const two = `<action>\nx\n</action><tool_call>\n<function=computer_use>\n${param("action", "left_click")}${param("coordinate", "[10, 10]")}</function>\n</tool_call><tool_call>\n<function=computer_use>\n${param("action", "left_click")}${param("coordinate", "[20, 20]")}</function>\n</tool_call>`;
    expect(translateResponse(two, ctx).action).toMatchObject({ type: "click", x: 19, y: 10 });
  });

  it("translateToolCall never leaks think content and truncates long action text", () => {
    const long = "a".repeat(400);
    const r = translateToolCall({ action: "wait", time: "1" }, long, false, ctx);
    expect(r.action?.purpose).toHaveLength(300);
    expect(r.action).toMatchObject({ type: "wait", ms: 1000 });
  });
});
