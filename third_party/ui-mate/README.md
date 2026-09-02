# Vendored UI-Mate reference files

Source: https://github.com/Tencent/UI-Mate
Pinned commit: 1cb9e1e44ce856e23b593992b02efbd489943fcb (2026-09-01)
License: Apache-2.0 (see LICENSE in this directory; third-party components keep their own licenses)

Files:
- `ui_mate_agent.py` - official agent: prompt construction, smart_resize, history collapsing, response parser, pyautogui translation.
- `demo_workflow.py` - demonstration-guided workflow prompt fragments and subtask_complete handling.
- `resources/trajectory.json` - official recorded episode with real model responses (used as golden fixtures).
- `resources/examples.json` - official single-step example instructions.
- `resources/task.json` - official demonstration task metadata.

These files are reference material only and are not executed by the product. The TypeScript
port lives in `packages/model-adapters/src/uimate/` and is tested against `resources/trajectory.json`.
