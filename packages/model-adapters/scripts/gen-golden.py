#!/usr/bin/env python3
"""Regenerate the byte-parity golden files under test/golden from the vendored
UI-Mate reference (third_party/ui-mate, Apache-2.0, commit 1cb9e1e).

The vendored module imports ``agents.demo_workflow``, so a throwaway ``agents``
package pointing at the vendored files is created in a temp dir. Python is only
needed to (re)generate the goldens; the vitest suite reads the checked-in files.

Usage (from the repo root):
    python3 packages/model-adapters/scripts/gen-golden.py
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKAGE_DIR = HERE.parent
REPO_ROOT = PACKAGE_DIR.parent.parent
VENDORED = REPO_ROOT / "third_party" / "ui-mate"
OUT_DIR = PACKAGE_DIR / "test" / "golden"


def make_agents_shim() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="uimate-agents-shim-"))
    pkg = tmp / "agents"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("", encoding="utf-8")
    for name in ("ui_mate_agent.py", "demo_workflow.py"):
        shutil.copyfile(VENDORED / name, pkg / name)
    return tmp


def write_text(name: str, text: str) -> None:
    (OUT_DIR / name).write_text(text, encoding="utf-8", newline="")


def write_json(name: str, data) -> None:
    (OUT_DIR / name).write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline=""
    )


def main() -> int:
    shim = make_agents_shim()
    sys.path.insert(0, str(shim))
    try:
        from agents import demo_workflow as dw
        from agents import ui_mate_agent as ua
    except Exception as exc:  # pragma: no cover - environment problem
        print(f"failed to import vendored module: {exc}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Plain and workflow system prompts.
    plan = dw.WorkflowPlan(
        subtasks=[
            dw.Subtask(
                title="Open the CRM contact",
                goal="Open the contact record for the customer\nfrom the meeting.",
                completion_flag="The contact detail page is visible.",
                key_steps=["Click the search field", "Type the contact name", "Open the top result"],
            ),
            dw.Subtask(
                title="",
                goal="  Log the meeting notes as an activity.  ",
                completion_flag="An activity with the meeting notes is listed.",
                key_steps=[],
            ),
            dw.Subtask(
                title="Confirm the summary",
                goal="Verify the activity summary shows today's date",
                completion_flag="",
                key_steps=["Scroll to the activity list"],
            ),
        ]
    )
    workflow = dw.DemoWorkflow(plan)
    write_text("system_prompt_plain.txt", ua.build_system_prompt(None))
    write_text("system_prompt_workflow.txt", ua.build_system_prompt(workflow.decorate_obs({})))

    tools_def = ua.build_tools_def(ua.build_description_prompt())
    write_text("tools_def_plain.json.txt", json.dumps(tools_def))
    patched = ua.patch_tools_schema(
        ua.build_tools_def(ua.build_description_prompt()), workflow.decorate_obs({})
    )
    write_text("tools_def_patched.json.txt", json.dumps(patched))

    # 2. Guidance for each pointer position.
    write_json(
        "guidance.json",
        {
            "plan": [
                {
                    "title": s.title,
                    "goal": s.goal,
                    "completionFlag": s.completion_flag,
                    "keySteps": list(s.key_steps),
                }
                for s in plan.subtasks
            ],
            "guidance": [dw.build_guidance(plan, i) for i in range(len(plan.subtasks))],
        },
    )

    # 3. Resize values.
    sizes = [(1920, 1080), (2560, 1600), (1440, 900), (3456, 2234), (800, 600), (100, 50),
             (1280, 800), (1512, 982), (5120, 2880), (9000, 4000), (2, 2)]
    write_json(
        "smart_resize.json",
        [
            {
                "width": w,
                "height": h,
                "default": list(ua.smart_resize(height=h, width=w)),
                "process": list(
                    ua.smart_resize(height=h, width=w, factor=32, max_pixels=16 * 16 * 4 * 12800)
                ),
            }
            for (w, h) in sizes
        ],
    )

    # 4. json.dumps parity samples.
    pyjson_cases = [
        {"a": 1, "b": [1, 2, {"c": "d"}], "e": None, "f": True, "g": False},
        {"unicode": "café 中文 \U0001F600 \u2014 【✅】"},
        {"escapes": "quote\" backslash\\ nl\n tab\t cr\r bs\b ff\f ctrl del"},
        {"nested": {"empty_obj": {}, "empty_list": [], "neg": -5, "float": 0.5}},
        ["z", "a", {"k2": 2, "k1": 1}],
        "plain string / with slash",
        12,
        -3.25,
        None,
        True,
    ]
    write_json("pyjson_cases.json", [{"value": v, "dumps": json.dumps(v)} for v in pyjson_cases])

    # 5. to_pyautogui_code parity samples (raw params exactly as the parser would produce).
    code_cases = [
        ("left_click", {"action": "left_click", "coordinate": [19, 561]}),
        ("click", {"action": "click", "coordinate": [999, 999]}),
        ("left_click_no_coord", {"action": "left_click"}),
        ("left_click_str_coord", {"action": "left_click", "coordinate": ["10", "20"]}),
        ("right_click", {"action": "right_click", "coordinate": [500, 500]}),
        ("middle_click", {"action": "middle_click", "coordinate": [1, 2]}),
        ("double_click", {"action": "double_click", "coordinate": [100.7, 200.2]}),
        ("triple_click", {"action": "triple_click", "coordinate": [100, 200]}),
        ("drag", {"action": "drag", "coordinate": [100, 200]}),
        ("drag_duration", {"action": "drag", "coordinate": [100, 200], "duration": 1}),
        ("drag_no_duration", {"action": "drag", "coordinate": [100, 200], "duration": 0}),
        ("drag_no_coord", {"action": "drag"}),
        ("mouse_move", {"action": "mouse_move", "coordinate": [10, 10]}),
        ("mouse_move_no_coord", {"action": "mouse_move"}),
        ("type_plain", {"action": "type", "text": "terminal"}),
        ("type_quotes", {"action": "type", "text": "it's \"quoted\" \\ back"}),
        ("type_newline_literal", {"action": "type", "text": "line1\\nline2"}),
        ("type_newline_real", {"action": "type", "text": "line1\nline2"}),
        ("type_unicode", {"action": "type", "text": "café 中文 \U0001F600"}),
        ("type_unicode_escape", {"action": "type", "text": "\\u00e9\\x41\\t\\101"}),
        ("type_bad_escape", {"action": "type", "text": "bad \\x4"}),
        ("type_trailing_backslash", {"action": "type", "text": "end\\"}),
        ("type_unknown_escape", {"action": "type", "text": "a\\qb"}),
        ("type_line_continuation", {"action": "type", "text": "a\\\nb"}),
        ("type_empty", {"action": "type", "text": ""}),
        ("type_missing", {"action": "type"}),
        ("type_non_string", {"action": "type", "text": [1, 2]}),
        ("hotkey_list", {"action": "hotkey", "keys": ["ctrl", "v"]}),
        ("hotkey_plus_string", {"action": "hotkey", "keys": "ctrl+shift+t"}),
        ("hotkey_plus_in_list", {"action": "hotkey", "keys": ["ctrl+c"]}),
        ("hotkey_single", {"action": "hotkey", "keys": ["enter"]}),
        ("hotkey_plus_key", {"action": "hotkey", "keys": ["ctrl", "+"]}),
        ("hotkey_number", {"action": "hotkey", "keys": [1, "a"]}),
        ("hotkey_missing", {"action": "hotkey"}),
        ("press_single", {"action": "press", "keys": ["return"]}),
        ("press_quote", {"action": "press", "keys": ["'"]}),
        ("press_both_quotes", {"action": "press", "keys": ["'\""]}),
        ("press_backslash", {"action": "press", "keys": ["\\"]}),
        ("press_newline", {"action": "press", "keys": ["\n"]}),
        ("press_multi", {"action": "press", "keys": ["a", "b", "c"]}),
        ("press_string", {"action": "press", "keys": "enter"}),
        ("press_dirty", {"action": "press", "keys": ["keys=['enter']"]}),
        ("press_dirty2", {"action": "press", "keys": ["[\"tab\"]"]}),
        ("press_number", {"action": "press", "keys": [5]}),
        ("press_unicode", {"action": "press", "keys": ["é"]}),
        ("press_missing", {"action": "press"}),
        ("key_down", {"action": "key_down", "keys": ["shift", "ctrl"]}),
        ("key_down_string", {"action": "key_down", "keys": "shift"}),
        ("key_up", {"action": "key_up", "keys": ["shift", "ctrl"]}),
        ("key_up_empty", {"action": "key_up", "keys": []}),
        ("scroll_default", {"action": "scroll", "pixels": "-500"}),
        ("scroll_number", {"action": "scroll", "pixels": 300}),
        ("scroll_horizontal", {"action": "scroll", "pixels": "40", "direction": "horizontal"}),
        ("scroll_missing", {"action": "scroll"}),
        ("sroll_typo", {"action": "sroll", "pixels": "10"}),
        ("wait", {"action": "wait", "time": "0.5"}),
        ("subtask_complete", {"action": "subtask_complete", "evidence": "x"}),
        ("finished_success", {"action": "finished", "status": "success"}),
        ("finished_ok", {"action": "finished", "status": "OK"}),
        ("finished_failure", {"action": "finished", "status": "failure"}),
        ("finished_missing", {"action": "finished"}),
        ("unknown", {"action": "launch_app", "text": "x"}),
    ]
    write_json(
        "to_pyautogui_code_cases.json",
        [
            {
                "name": name,
                "args": args,
                "code": ua.to_pyautogui_code(args["action"], args, 1920, 1080, "relative"),
            }
            for name, args in code_cases
        ],
    )

    # 6. parse_response parity samples.
    def tc(body: str) -> str:
        return "<tool_call>\n<function=computer_use>\n" + body + "</function>\n</tool_call>"

    def param(name: str, value: str) -> str:
        return f"<parameter={name}>\n{value}\n</parameter>\n"

    think = "<think>\nplanning\n</think>\n\n"
    responses = {
        "click": think + "<action>\nClick it.\n</action>\n\n" + tc(param("action", "left_click") + param("coordinate", "[19, 561]")),
        "no_action_block": think + tc(param("action", "left_click") + param("coordinate", "[19, 561]")),
        "no_tool_call": think + "<action>\nDone.\n</action>",
        "no_tool_call_infeasible": think + "<action>\nThis task is infeasible.\n</action>",
        "empty_action_name": "<action>\nx\n</action>" + tc(param("coordinate", "[1, 2]")),
        "call_user": "<action>\nAsk.\n</action>" + tc(param("action", "call_user") + param("text", "Which file?")),
        "call_user_infeasible": "<action>\nCannot be done.\n</action>" + tc(param("action", "call_user") + param("text", "not possible")),
        "unknown_action": "<action>\nx\n</action>" + tc(param("action", "launch")),
        "two_clicks": "<action>\nx\n</action>" + tc(param("action", "left_click") + param("coordinate", "[10, 10]")) + tc(param("action", "left_click") + param("coordinate", "[20, 20]")),
        "keydown_click_keyup": "<action>\nx\n</action>" + tc(param("action", "key_down") + param("keys", '["shift"]')) + tc(param("action", "left_click") + param("coordinate", "[10, 10]")) + tc(param("action", "key_up") + param("keys", '["shift"]')),
        "keydown_alt_click": "<action>\nx\n</action>" + tc(param("action", "key_down") + param("keys", '["alt"]')) + tc(param("action", "left_click") + param("coordinate", "[10, 10]")),
        "keydown_shift_enter": "<action>\nx\n</action>" + tc(param("action", "key_down") + param("keys", '["shift"]')) + tc(param("action", "press") + param("keys", '["enter"]')),
        "click_then_finished": "<action>\nx\n</action>" + tc(param("action", "left_click") + param("coordinate", "[10, 10]")) + tc(param("action", "finished") + param("status", "success")),
        "type_multiline": "<action>\nType.\n</action>" + tc(param("action", "type") + param("text", "hello world\nsecond")),
        "wait": "<action>\nWait.\n</action>" + tc(param("action", "wait") + param("time", "2")),
        "wrong_function": "<action>\nx\n</action>" + "<tool_call>\n<function=other>\n" + param("action", "left_click") + "</function>\n</tool_call>",
        "action_case_insensitive": "<ACTION> Upper </ACTION>" + tc(param("action", "wait")),
        "coordinate_malformed": "<action>\nx\n</action>" + tc(param("action", "left_click") + param("coordinate", "[19, 561")),
        "subtask_complete": "<action>\nDone with subtask.\n</action>" + tc(param("action", "subtask_complete") + param("current_subtask_idx", "0") + param("evidence", "The page is visible.")),
        "empty": "",
    }
    write_json(
        "parse_response_cases.json",
        [
            {
                "name": name,
                "response": response,
                "actionText": ua.extract_action_text(response),
                "toolCalls": ua.extract_xml_tool_calls(response),
                "infeasible": ua.looks_infeasible_response(response),
                "compactWithThink": ua.compact_response_for_history(response, True),
                "compactNoThink": ua.compact_response_for_history(response, False),
                "subtaskComplete": dw.detect_subtask_complete(response),
                "parsed": list(ua.parse_response(response, 1920, 1080)),
                "parsedAbsolute": list(ua.parse_response(response, 1920, 1080, "absolute")),
            }
            for name, response in responses.items()
        ],
    )

    infeasible_cases = [
        "", "all good", "This is INFEASIBLE", "the feature is not available", "there is no export button",
        "no python in the app list", "requires an extension", "Needs credentials", "without plugins it cannot work",
        "without plugins ok", "could you clarify?", "I need a language pack", "the folder is empty",
    ]
    write_json(
        "infeasible_cases.json",
        [{"text": t, "infeasible": ua.looks_infeasible_response(t)} for t in infeasible_cases],
    )

    detect_cases = [
        "<tool_call>{\"name\": \"subtask_complete\", \"arguments\": {}}</tool_call>",
        "<tool_call>{\"action\": \"subtask.complete\"}</tool_call>",
        "<tool_call><function=computer_use><parameter=action>subtask_complete</parameter></function></tool_call>",
        "<tool_call>```python\ncomputer_use(action=subtask_complete)\nsubtask_complete()\n```</tool_call>",
        "<TOOL_CALL>subtask_complete(0)</TOOL_CALL>",
        "I will call subtask_complete now <tool_call><function=computer_use><parameter=action>left_click</parameter></function></tool_call>",
        "subtask_complete( ) with no tool call",
        "<tool_call><parameter = action> Subtask_Complete </parameter></tool_call>",
        "",
    ]
    write_json(
        "detect_subtask_complete_cases.json",
        [{"text": t, "detected": dw.detect_subtask_complete(t)} for t in detect_cases],
    )

    # 7. build_messages + collapse_messages parity from a scripted agent state.
    agent = ua.UIMateAgent(base_url="http://127.0.0.1:1/v1")
    agent.reset()
    fake_shots = [f"IMG{i}" for i in range(5)]
    fake_responses = [
        f"<think>\nthought {i}\n</think>\n\n<action>\nStep action {i}\n</action>\n\n" + tc(param("action", "wait"))
        for i in range(4)
    ]
    agent.screenshots = list(fake_shots)
    agent.responses = list(fake_responses)
    agent.actions = [f"Step action {i}" for i in range(4)]
    plain_messages = agent.build_messages("Do the thing", None)
    collapsed, collapsed_flag = ua.collapse_messages(
        [json.loads(json.dumps(m)) for m in plain_messages], images_to_keep=2, min_removal_threshold=1
    )
    collapsed_threshold, collapsed_threshold_flag = ua.collapse_messages(
        [json.loads(json.dumps(m)) for m in plain_messages], images_to_keep=2, min_removal_threshold=10
    )
    guided_messages = agent.build_messages("Do the thing", workflow.decorate_obs({}))

    agent_hist = ua.UIMateAgent(base_url="http://127.0.0.1:1/v1", history_n=2, recent_think_steps=1)
    agent_hist.reset()
    agent_hist.screenshots = list(fake_shots)
    agent_hist.responses = list(fake_responses)
    agent_hist.actions = [f"Step action {i}" for i in range(4)]
    windowed_messages = agent_hist.build_messages("Do the thing", None)

    agent_nothink = ua.UIMateAgent(base_url="http://127.0.0.1:1/v1", include_thinking_in_history=False)
    agent_nothink.reset()
    agent_nothink.screenshots = [fake_shots[0], None, fake_shots[2]]
    agent_nothink.responses = fake_responses[:2]
    agent_nothink.actions = ["Step action 0", "Step action 1"]
    released_messages = agent_nothink.build_messages("Do the thing", None)

    write_json(
        "messages.json",
        {
            "screenshots": fake_shots,
            "responses": fake_responses,
            "actions": [f"Step action {i}" for i in range(4)],
            "instruction": "Do the thing",
            "plain": plain_messages,
            "collapsedKeep2": collapsed,
            "collapsedKeep2Flag": collapsed_flag,
            "collapsedKeep2Threshold10": collapsed_threshold,
            "collapsedKeep2Threshold10Flag": collapsed_threshold_flag,
            "guided": guided_messages,
            "windowedHistory2RecentThink1": windowed_messages,
            "releasedNoThink": released_messages,
        },
    )

    # 8. Workflow pointer behaviour.
    def run_pointer(events):
        wf = dw.DemoWorkflow(plan)
        out = []
        for response, actions in events:
            result = wf.after_predict(response, actions)
            out.append({"index": wf.current_index, "awaitFinish": wf._await_finish, "actions": result})
        return out

    sc = responses["subtask_complete"]
    click = responses["click"]
    write_json(
        "workflow_pointer.json",
        {
            "completeChain": run_pointer([(click, ["pyautogui.click(1, 1)"]), (sc, ["WAIT"]), (sc, ["WAIT"]), (sc, ["WAIT"]), (click, ["pyautogui.click(1, 1)"]), (sc, ["WAIT"])]),
            "earlyDone": run_pointer([(click, ["DONE"]), (click, ["DONE"]), (click, ["DONE"])]),
            "resetAwait": run_pointer([(sc, ["WAIT"]), (sc, ["WAIT"]), (sc, ["WAIT"]), (click, ["pyautogui.click(1, 1)"]), (sc, ["WAIT"])]),
        },
    )

    shutil.rmtree(shim, ignore_errors=True)
    print(f"golden files written to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
