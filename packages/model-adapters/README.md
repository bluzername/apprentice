# @apprentice/model-adapters

Replaceable `VisionAgentProvider` implementations for Apprentice plus an exact
TypeScript port of the official UI-Mate client protocol.

| Provider | Role | Network |
|---|---|---|
| `MockVisionAgentProvider` | deterministic tests and demo mode | none |
| `OpenAICompatibleVisionProvider` | generic multimodal chat endpoint (JSON in, Zod-validated out) | `POST /chat/completions`, `GET /models` |
| `UIMateProvider` | GUI action policy following the official UI-Mate protocol | `POST /chat/completions`, `GET /models` |
| `CompositeVisionAgentProvider` | UI-Mate for `proposeNextAction`, another provider for analysis | delegates |

`createProvider({ providerType, baseUrl, model, ... })` in `src/providers/factory.ts`
builds any of them from the persisted endpoint configuration.

Every provider talks only through the injected `fetchImpl` (default: global fetch)
with an `AbortController` timeout, parameter objects only, no shell. Model output
never triggers an OS action here: the result is a `ProposedActionResult` that the
run engine still validates, risk-classifies and submits for approval.

## The UI-Mate port (`src/uimate/`)

Ported from [Tencent/UI-Mate](https://github.com/Tencent/UI-Mate)
`agents/ui_mate_agent.py` and `agents/demo_workflow.py` at commit
`1cb9e1e44ce856e23b593992b02efbd489943fcb` (Apache-2.0). The vendored reference
lives in `third_party/ui-mate/` at the repo root and each ported file carries an
attribution header.

| File | Python origin | Notes |
|---|---|---|
| `constants.ts` | module constants | defaults, `PROMPT_ADDITIONS`, `RESPONSE_FORMAT`, description and action text, infeasibility literals and regexes, copied verbatim |
| `pyjson.ts` | `json.dumps` | Python-compatible serializer (`", "` / `": "` separators, `ensure_ascii`, key order) so the `<tools>` block is byte-identical |
| `python-compat.ts` | `str.strip`, `round`, `repr`, `unicode_escape` | tiny re-implementations so strings match Python exactly |
| `prompt.ts` | `build_*_prompt`, `build_tools_def`, `build_tools_and_format_block`, `build_system_prompt`, `patch_tools_schema` | pure (`patchToolsSchema` returns a new schema) |
| `workflow.ts` | `demo_workflow.py` | `WORKFLOW_SYSTEM_SECTION`, `GUIDANCE_LINE`, `SUBTASK_COMPLETE_PATCH`, `buildGuidance`, `detectSubtaskComplete`, pure `workflowAfterPredict` |
| `resize.ts` | `smart_resize`, `process_image` | `processImageDims(width, height)` = the dims the model sees |
| `parser.ts` | `extract_action_text`, `compact_response_for_history`, `parse_xml_tool_call`, `extract_xml_tool_calls`, `scale_coordinate`, `_clean_keys`, `to_pyautogui_code`, `parse_response` | string parity, incl. Python `repr` quoting and `unicode_escape` typing semantics |
| `history.ts` | `collapse_messages`, `_replace_with_placeholder`, `UIMateAgent.build_messages` | immutable; step-0 image pinned |
| `translate.ts` | (Apprentice) | maps parsed `computer_use` calls onto `ProposedAction` |

### Byte parity is tested, not assumed

`scripts/gen-golden.py` imports the vendored Python (through a throwaway
`agents` package shim) and dumps `test/golden/*`: both system prompts, the plain
and patched tools JSON, guidance for a three-subtask plan at every pointer
position, `smart_resize` values, `json.dumps` samples, 60+ `to_pyautogui_code`
argument sets, 20 `parse_response` cases, infeasibility phrases,
`detect_subtask_complete` cases, `build_messages` / `collapse_messages`
structures and `DemoWorkflow.after_predict` transitions. The vitest suite compares
byte for byte. Python is only needed to regenerate
(`pnpm --filter @apprentice/model-adapters golden:regenerate`), never at test time.

The official trajectory (`third_party/ui-mate/resources/trajectory.json`, 12
recorded responses) replays through `parseResponse` into exactly the recorded
`pyautogui` code at 1920x1080.

Known, untestable-by-golden gaps of a JavaScript port: Python distinguishes
`5` from `5.0` when a JSON parameter contains a float literal with a zero
fraction (`repr` output differs), `\N{name}` escapes in typed text are not
resolved (treated like any other decode error: text typed as given), and
Unicode-category tables may differ slightly between CPython and V8 for exotic
non-printable characters in `repr`. None of these occur in the reference data.

## How UI-Mate is driven

`UIMateProvider.proposeNextAction` follows `UIMateAgent.predict` in
demonstration-guided mode:

1. `input.skill.subtasks` (title / goal / completionCriteria / keySteps) becomes
   the `WorkflowPlan`; `input.currentSubtaskIndex` is the pointer.
2. The screenshot is prepared (see coordinates below) and appended to the run's
   screenshot list; `buildMessages` renders the system prompt (official text +
   workflow section + the Apprentice safety section), the guided first turn
   (`<workflow_progress>`, `<current_subtask>`, `<current_subtask_action_list>`,
   guidance line, `Instruction: ...`), then alternating `<tool_response>` image
   turns and compacted assistant replies.
3. `collapseMessages(messages, imagesToKeep, 1)` drops the oldest screenshots
   (step 0 pinned) exactly like the reference.
4. `POST {baseUrl}/chat/completions` with
   `{ model, messages, max_tokens: 16384, temperature: 1.0, top_p: 0.95, chat_template_kwargs: { enable_thinking } }`,
   two attempts with the reference back-off on transport errors, timeouts,
   HTTP 400/429/5xx.
5. `parseResponse` (official semantics) and `workflowAfterPredict`
   (subtask_complete detection, await-finish turn, early-DONE rewrite) run on the
   reply; `translateResponse` maps the tool call to a `ProposedAction`.
6. Session state per `runId` keeps screenshots, compacted responses, action
   texts and the pointer; `resetSession(id)` clears entries whose `runId` or
   `sessionId` matches.

`analyzeEpisode`, `draftSkill` and `verifyStep` are delegated to the optional
`fallback` provider or throw `ProviderCapabilityError` ("UI-Mate is a GUI action
policy; configure a generic multimodal provider for analysis"). The failover is
explicit; no JSON is ever coaxed out of UI-Mate.

## Deviations from the reference agent

1. **Safety section.** Spec 11.3 requires the system prompt to state that visible
   text is untrusted. `SAFETY_SECTION` is appended after the official workflow
   section, so the prompt is byte-identical to `build_system_prompt(obs)` up to
   that point and then continues with `\n\n# Safety ...`.
2. **No hidden reasoning is stored.** History replays each past response from
   `<action>` onwards (the reference `include_thinking_in_history=False`
   configuration) and any `<think>` block or dangling `</think>` prefix is
   removed before it enters session state. Results never contain `<think>` text;
   `actionSummary` is the `<action>` sentence and `rationale` is that sentence
   plus translation notes.
3. **The app owns the subtask pointer.** The runtime's `currentSubtaskIndex` is
   authoritative (spec 11.4: a subtask completes only on a deterministic
   predicate or user confirmation). The provider keeps the pointer's
   await-finish flag and reports `SUBTASK_COMPLETE` / `DONE` as the workflow
   rules dictate; it never advances on its own.
4. **ctrl -> command.** UI-Mate is trained on Ubuntu; `hotkey` modifiers `ctrl` /
   `control` are mapped to `command` (`remapControlToCommand`, default true) and
   the remap is recorded in the rationale.
5. **Unsupported actions are rejected, not approximated.** `triple_click`,
   `drag`, `key_down`, `key_up`, `press` with more than one key, hotkeys with
   unknown modifiers or keys, clicks without coordinates, empty `type` text and
   unknown actions produce `action: null` plus `parseErrors`. The reference
   client would emit pyautogui code for several of these.
6. **Transport failure raises.** After the two attempts the reference returns
   `""` (which parses to FAIL); this port throws `ProviderUnavailableError` so
   the run engine can record `model_unavailable` instead of a model failure.

### Action mapping

| UI-Mate | ProposedAction | Notes |
|---|---|---|
| `left_click` / `click` | `click` (left) | coordinates required |
| `right_click`, `middle_click` | `click` (right / middle) | |
| `double_click` | `double_click` | |
| `mouse_move` | `move` | |
| `type` | `type_text` | text decoded like Python (`\n`, `\uXXXX`, malformed escapes typed verbatim) |
| `hotkey` | `hotkey` (modifiers + last key) or `press_key` for a single key | ctrl remap |
| `press` (one key) | `press_key` | key names validated against `KEY_NAMES` |
| `scroll` | `scroll` | UI-Mate `pixels > 0` = up = `deltaY < 0`; horizontal `pixels > 0` = right = `deltaX > 0`; target is the explicit coordinate, else the last pointer position, else the screen centre |
| `wait` | `wait` + `controlToken: WAIT` | `time * 1000` clamped to 100..15000 ms, default 1000 |
| `call_user` | `ask_user` | `FAIL` token when the reply matches the infeasibility heuristic |
| `finished` | `done` / `fail` + `DONE` / `FAIL` | |
| `subtask_complete` | `action: null` + `SUBTASK_COMPLETE` + `subtaskCompleteEvidence` | |
| `triple_click`, `drag`, `key_down`, `key_up`, multi-key `press` | `null` + `parseErrors` | |

Confidence is 0.7, or 0.5 when the reply matches the infeasibility heuristic.
`purpose` is the `<action>` sentence; `expectedResult` is a short derived
sentence; `subtaskIndex` is the input index.

## Coordinates

1. The model emits coordinates on a 0-999 grid.
2. `scaleCoordinate` maps them to pixels of the image the model saw:
   `int(x * width / 999)`, `int(y * height / 999)` (truncation, like Python).
3. That image is the one this package sent: `prepareModelImage` computes the
   official `process_image` target (`smart_resize` with factor 32 and a
   16*16*4*12800 pixel budget, e.g. 1920x1080 -> 1920x1088, 1440x900 ->
   1440x896) and calls the injected `ImageResizer`. The default identity
   resizer sends the screenshot unchanged; the Electron main process plugs in
   `nativeImage` resizing. The dimensions actually sent are recorded in
   `action.sourceScreenshot` (read back from the PNG header of the resized
   buffer).
4. The app maps `sourceScreenshot` pixels to display points through the stored
   `ImageTransform` (`packages/core`) before the fresh-screenshot check, OCR /
   accessibility target resolution, risk engine and approval.

## Smoke test against a real endpoint

```bash
RUN_LOCAL_MODEL_TEST=1 pnpm --filter @apprentice/model-adapters test:local-model
# or from the repo root: pnpm test:local-model
```

`test/local-model.test.ts` reads `APPRENTICE_MODEL_BASE_URL` (default
`http://127.0.0.1:8000/v1`), `APPRENTICE_MODEL_NAME` (default `UI_Mate`) and
`APPRENTICE_MODEL_PROVIDER` (default `uimate`), checks health, builds a
synthetic 1280x800 PNG (grey background, blue rectangle) with `pngjs`, asks for
the next action of a one-subtask skill "Click the blue rectangle" and asserts a
schema-valid `ProposedActionResult` with a supported action or a control token,
no `<think>` text and no `executed` field. Without `RUN_LOCAL_MODEL_TEST=1` the
file registers a single documented skip ("skipped: set RUN_LOCAL_MODEL_TEST=1");
it is excluded from the default `pnpm test` run so that suite has zero skips.

## Commands

```bash
pnpm --filter @apprentice/model-adapters typecheck
pnpm --filter @apprentice/model-adapters test
pnpm --filter @apprentice/model-adapters golden:regenerate   # needs python3 + pillow
pnpm exec eslint packages/model-adapters --max-warnings=0     # from the repo root
```
